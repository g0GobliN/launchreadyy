/**
 * Node.js HTTP front end for the produced build.
 *
 * The production build runs as a plain Node process, so it supplies both the listener and the
 * static-asset handler. Without them `npm start` evaluates
 * the bundle, exits 0, and never answers a request.
 *
 * Two responsibilities, one process:
 *   1. Serve `dist/client` for GET/HEAD when the file exists (immutable caching for hashed
 *      `/assets/`, no-store otherwise), refusing anything outside the directory.
 *   2. Hand everything else to the SSR pipeline in `src/server.ts`.
 *
 * Built-in `node:http` only — no framework and no extra dependency for what is a few dozen
 * lines of well-defined plumbing.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

/** Content type from the file extension; unknown extensions are served as bytes. */
export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Where the built client bundle lives.
 *
 * LAUNCHREADYY_CLIENT_DIR wins when set. Otherwise `dist/client` relative to the working
 * directory is preferred (that is how the CLI and `npm start` run), falling back to a
 * bundle-relative path so a service manager that chose another cwd still works.
 */
export function resolveClientDir(): string {
  if (process.env.LAUNCHREADYY_CLIENT_DIR) return process.env.LAUNCHREADYY_CLIENT_DIR;
  const candidates = [path.resolve(process.cwd(), "dist", "client"), ...bundleRelativeCandidates()];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return candidates[0]!;
}

/**
 * `dist/client` derived from this module's own URL, for both shapes the bundler can produce:
 * `dist/server/server.js` (two levels up) and `dist/server/assets/<chunk>.js` (three).
 */
function bundleRelativeCandidates(): string[] {
  const here = fileURLToPath(import.meta.url);
  return [path.resolve(here, "..", "..", "client"), path.resolve(here, "..", "..", "..", "client")];
}

export type NodeServerHandle = {
  url: string;
  port: number;
  host: string;
  close: () => Promise<void>;
};

/**
 * Start the HTTP server.
 *
 * `handleRequest` is injected rather than imported so this module stays free of the SSR
 * pipeline (and therefore unit-testable on its own).
 */
export async function startNodeServer(opts: {
  handleRequest: (request: Request) => Promise<Response>;
  port: number;
  host: string;
  clientDir?: string;
}): Promise<NodeServerHandle> {
  const clientDir = opts.clientDir ?? resolveClientDir();

  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        // Prefer the incoming Host header so a reverse proxy keeps the public origin
        // (scheme stays http — TLS is the proxy's job, which is the documented deployment).
        const hostHeader = req.headers.host ?? `${opts.host}:${opts.port}`;
        const requestOrigin = `http://${hostHeader}`;
        const url = new URL(req.url ?? "/", requestOrigin);
        const method = (req.method ?? "GET").toUpperCase();

        // Static first: an existing file is always the right answer, and it never needs the
        // SSR pipeline (or the database) to be up.
        if (method === "GET" || method === "HEAD") {
          const file = await resolveStaticFile(url.pathname, clientDir);
          if (file) {
            res.statusCode = 200;
            res.setHeader("content-type", contentTypeFor(file));
            res.setHeader("cache-control", cacheControlFor(url.pathname));
            if (method === "HEAD") {
              res.end();
              return;
            }
            await new Promise<void>((resolve, reject) => {
              const stream = createReadStream(file);
              stream.on("error", reject);
              res.on("close", () => stream.destroy());
              stream.pipe(res);
              res.on("finish", () => resolve());
            });
            return;
          }
        }

        const response = await opts.handleRequest(toWebRequest(req, requestOrigin));
        await writeWebResponse(res, response);
      } catch (error) {
        console.error("[node-server] request failed:", error);
        if (!res.headersSent) res.statusCode = 500;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("Internal Server Error");
      }
    })();
  });

  // A reverse proxy needs headroom before Node closes an idle keep-alive socket, or it will
  // occasionally serve a 502 on a connection Node just retired.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  // Port 0 means "any free port" — report the one the OS actually chose.
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : opts.port;
  const url = `http://${opts.host}:${boundPort}`;

  return {
    url,
    port: boundPort,
    host: opts.host,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * Whether `moduleUrl` is the process entry — i.e. the built bundle was executed
 * (`node dist/server/server.js`) rather than imported by `vite dev`.
 *
 * Takes the caller's own `import.meta.url` rather than reading it here: Rollup/Vite code-split
 * this function into its own chunk in the production build, so `import.meta.url` measured
 * inside this file resolves to that chunk's path, never to `dist/server/server.js` — the check
 * always failed silently, the HTTP listener never started, and `node dist/server/server.js`
 * exited 0 having done nothing. Comparing against the *caller's* URL (server.ts's own entry
 * module) is the only measurement that can actually equal `process.argv[1]`.
 *
 * This is what keeps a development server from opening a second listener on the port Vite
 * already owns.
 */
export function isProcessEntry(moduleUrl: string): boolean {
  if (process.env.LAUNCHREADYY_SERVE === "1") return true;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === moduleUrl;
  } catch {
    return false;
  }
}

/**
 * Map a request path to a file inside `root`, or null when it is not a servable static file.
 *
 * Rejects traversal explicitly rather than relying on `path.resolve` normalisation alone: a
 * decoded `%2e%2e%2f` must not be able to read outside the directory.
 */
export async function resolveStaticFile(pathname: string, root: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes("\0")) return null;

  const relative = decoded.replace(/^\/+/, "");
  if (relative === "") return null;

  const target = path.resolve(root, relative);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(rootWithSep)) return null;

  try {
    const info = await stat(target);
    return info.isFile() ? target : null;
  } catch {
    return null;
  }
}

/** Cache policy: hashed asset filenames are immutable, everything else revalidates. */
export function cacheControlFor(pathname: string): string {
  return pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store";
}

type RequestInitWithDuplex = RequestInit & { duplex?: "half" };

/** Adapt a Node request to a web `Request`, streaming the body rather than buffering it. */
export function toWebRequest(req: IncomingMessage, origin: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else if (value !== undefined) headers.set(key, value);
  }

  const method = (req.method ?? "GET").toUpperCase();
  const url = new URL(req.url ?? "/", origin);
  const init: RequestInitWithDuplex = { method, headers };

  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as ReadableStream;
    // Required by Node's fetch when the request body is a stream.
    init.duplex = "half";
  }
  return new Request(url, init);
}

/** Write a web `Response` back to a Node response, preserving status, headers and cookies. */
export async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;

  // `Headers.forEach` folds repeated `set-cookie` into one comma-joined value, which would
  // corrupt multi-cookie responses — take those from getSetCookie() instead.
  const setCookies =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    res.setHeader(key, value);
  });
  if (setCookies.length > 0) res.setHeader("set-cookie", setCookies);

  // A body is forbidden for these — Node throws if one is written.
  if (res.statusCode === 204 || res.statusCode === 304 || response.body === null) {
    res.end();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    stream.on("error", reject);
    res.on("error", reject);
    res.on("close", () => stream.destroy());
    stream.pipe(res);
    res.on("finish", () => resolve());
  });
}
