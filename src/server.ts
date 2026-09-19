// Node 20 has no native WebSocket — polyfill before any module uses it.
if (!globalThis.WebSocket) {
  const ws = await import("ws");
  (globalThis as unknown as Record<string, unknown>).WebSocket = ws.default || ws;
}

import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { startBackgroundServices } from "./lib/background-services.server";
import { renderErrorPage } from "./lib/error-page";
import { withSecurityHeaders } from "./lib/security-headers";
import { enforceRequestSizeLimit, tooLargeResponse } from "./lib/request-limits";
import { isProcessEntry } from "./lib/node-server.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  requestUrl: URL,
): Promise<Response> {
  if (response.status === 500 && requestUrl.pathname.startsWith("/r/")) {
    const body = await response.clone().text();
    if (body.includes("Report unavailable")) {
      return new Response(body, {
        status: 404,
        headers: response.headers,
      });
    }
  }

  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function handleBadgeRequest(url: URL): Promise<Response | null> {
  const scoreMatch = url.pathname.match(/^\/api\/badge\/score\/(\d{1,3})\.svg$/);
  if (scoreMatch) {
    const { scoreBadgeSvg, badgeSvgResponse } = await import("./lib/badge.server");
    const score = Math.min(100, parseInt(scoreMatch[1]!, 10));
    return badgeSvgResponse(scoreBadgeSvg(score));
  }

  const repoMatch = url.pathname.match(/^\/api\/badge\/repo\/([a-f0-9-]{36})\.svg$/i);
  if (repoMatch) {
    const { scoreBadgeSvg, badgeSvgResponse } = await import("./lib/badge.server");
    const { getDataStore } = await import("./lib/data-store.server");
    const db = getDataStore();
    const { data: scan } = await db
      .from("scans")
      .select("score")
      .eq("repo_id", repoMatch[1]!)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const score = scan?.score ?? 0;
    return badgeSvgResponse(scoreBadgeSvg(score));
  }

  return null;
}

/**
 * Request pipeline for the local Node server.
 *
 * Community runs as one Node process containing the web server, job worker, and
 * scheduler. Every request runs inside the request-scoped context below so IP
 * logging and per-request caches keep working.
 *
 * This module is also the built server's entry point: `node dist/server/server.js`
 * starts the HTTP listener at the bottom of this file, while `vite dev` merely
 * imports it for the request pipeline.
 */
export async function handleRequest(request: Request): Promise<Response> {
  // One Node process runs web + worker + scheduler; first request boots the
  // background halves. Idempotent, so this is a no-op from the second call on.
  startBackgroundServices();

  const { runWithRequestContext } = await import("./lib/request-context.server");
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  // Before any handler touches the body — a rejection here costs nothing; a parse does not.
  const sizeCheck = await enforceRequestSizeLimit(request);
  if (sizeCheck.oversize) {
    console.warn(
      `[request-limit] rejected oversized ${request.method} ${new URL(request.url).pathname} from ${clientIp}`,
    );
    return withSecurityHeaders(tooLargeResponse());
  }
  // May be a rebuilt copy when the body had no content-length; see enforceRequestSizeLimit.
  request = sizeCheck.request;
  // Badge SVGs are hotlinked from third-party READMEs, so they need a laxer
  // cross-origin posture than the app shell — decided before the handler runs.
  const isBadgeRequest = new URL(request.url).pathname.startsWith("/api/badge/");

  const response = await runWithRequestContext({ clientIp }, async () => {
    // Opportunistic fallback drain.
    void import("./lib/jobs.server").then(({ scheduleDurableJobDrain }) => {
      scheduleDurableJobDrain();
    });

    const url = new URL(request.url);

    // README / shields-style score badges
    if (request.method === "GET" && url.pathname.startsWith("/api/badge/")) {
      try {
        const badge = await handleBadgeRequest(url);
        if (badge) return badge;
      } catch (error) {
        console.error("[badge] unhandled error:", error);
        return new Response("Badge error", { status: 500 });
      }
    }

    try {
      const handler = await getServerEntry();
      const ssrResponse = await handler.fetch(request, undefined, undefined);
      const normalized = await normalizeCatastrophicSsrResponse(ssrResponse, url);
      const contentType = normalized.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        const headers = new Headers(normalized.headers);
        const cc = normalized.headers.get("cache-control");
        headers.set("cache-control", cc ? `${cc}, no-transform` : "no-transform");
        return new Response(normalized.body, { status: normalized.status, headers });
      }
      return normalized;
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  });

  // Single choke point: every response leaves with security headers.
  return withSecurityHeaders(response, { badge: isBadgeRequest });
}

/**
 * Boot the HTTP listener when this file is the process entry (`node dist/server/server.js`,
 * which is what `npm start` and `launchreadyy start` run). Imported by `vite dev`, it stays a
 * plain module — otherwise development would try to bind the port Vite already owns.
 */
if (isProcessEntry(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT ?? "5174", 10);
  const host = process.env.HOST ?? "localhost";
  const { startNodeServer } = await import("./lib/node-server.server");

  const handle = await startNodeServer({
    handleRequest,
    port: Number.isFinite(port) ? port : 5174,
    host,
  });
  console.log(`LaunchReadyy Community listening on ${handle.url}`);

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received — shutting down.`);
    void handle.close().then(() => process.exit(0));
    // A hung connection must not keep the process alive past a container's grace period.
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
