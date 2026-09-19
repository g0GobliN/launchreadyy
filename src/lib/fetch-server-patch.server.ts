import type { ProjectContext } from "./project-context.server";

const FETCH_MIDDLEWARE_IDS = ["helmet", "cors", "rate-limit", "logger"] as const;

export function isTanStackStart(ctx: ProjectContext): boolean {
  return (
    !!ctx.mergedDeps["@tanstack/start"] ||
    !!ctx.mergedDeps["@tanstack/react-start"] ||
    ctx.filePaths.some((f) => f === "app.config.ts")
  );
}

export function isFetchBasedServer(ctx: ProjectContext): boolean {
  if (ctx.hasExpress) return false;
  return (
    isTanStackStart(ctx) || ctx.filePaths.some((f) => f === "src/server.ts" || f === "server.ts")
  );
}

export function fetchServerEntryPath(ctx: ProjectContext): string | null {
  if (ctx.filePaths.includes("src/server.ts")) return "src/server.ts";
  if (ctx.filePaths.includes("server.ts")) return "server.ts";
  return null;
}

/** Composable fetch-handler pipeline (security headers, CORS, rate limit, logging). */
export function buildRequestPipelineContent(fixIds: string[]): string {
  const useHelmet = fixIds.includes("helmet");
  const useCors = fixIds.includes("cors");
  const useRateLimit = fixIds.includes("rate-limit");
  const useLogger = fixIds.includes("logger");
  const useSecureCookies = fixIds.includes("security-cookie-flags");
  const useHttpsRedirect = fixIds.includes("https-redirect");

  const imports: string[] = [];
  if (useHttpsRedirect) imports.push(`import { httpsRedirectResponse } from "./https-redirect";`);
  if (useHelmet) imports.push(`import { withSecurityHeaders } from "./security-headers";`);
  if (useCors) imports.push(`import { corsHeaders, handleCorsPreflight } from "./cors";`);
  if (useRateLimit)
    imports.push(`import { checkRateLimit, rateLimitResponse } from "./rate-limit";`);
  if (useLogger) imports.push(`import { logger } from "./logger";`);
  if (useSecureCookies) imports.push(`import { withSecureCookies } from "./secure-cookies";`);

  const pre: string[] = [];
  // https-redirect must be the first pre-array push — short-circuits before CORS preflight or
  // anything else runs.
  if (useHttpsRedirect) {
    pre.push(`  const _httpsRedirect = httpsRedirectResponse(request);
  if (_httpsRedirect) return _httpsRedirect;`);
  }
  if (useCors) {
    pre.push(`  const _preflight = handleCorsPreflight(request);
  if (_preflight) return _preflight;`);
  }
  if (useRateLimit) {
    pre.push(`  const _ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const _rl = checkRateLimit(_ip);
  if (!_rl.allowed) return finalizeResponse(request, rateLimitResponse(_rl.retryAfter ?? 60));`);
  }
  if (useLogger) pre.push(`  const _started = Date.now();`);

  const logSuccess = useLogger
    ? `    logger.info("request", {
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      ms: Date.now() - _started,
    });`
    : "";

  const logError = useLogger
    ? `    logger.error("request_failed", {
      method: request.method,
      path: new URL(request.url).pathname,
      ms: Date.now() - _started,
      error: String(err),
    });`
    : "";

  // Composable response wrapper names — withSecurityHeaders and withSecureCookies touch
  // disjoint headers, so nesting order between them doesn't matter functionally; this must stay
  // byte-identical to the old single-ternary output when only helmet (or neither) is selected.
  const wrapperNames: string[] = [];
  if (useHelmet) wrapperNames.push("withSecurityHeaders");
  if (useSecureCookies) wrapperNames.push("withSecureCookies");
  const wrapReturn = wrapperNames.reduce((expr, name) => `${name}(${expr})`, "wrapped");

  const finalizeFn =
    useHelmet || useCors || useSecureCookies
      ? `function finalizeResponse(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);${
    useCors
      ? `
  for (const [k, v] of Object.entries(corsHeaders(request.headers.get("Origin")))) headers.set(k, v);`
      : ""
  }
  const wrapped = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  return ${wrapReturn};
}`
      : `function finalizeResponse(_request: Request, response: Response): Response {
  return response;
}`;

  return `${imports.join("\n")}

${finalizeFn}

/** Wraps a fetch handler with LaunchReadyy middleware. */
export async function runRequestPipeline(
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
${pre.join("\n")}
  try {
    const response = await handler();
${logSuccess}
    return finalizeResponse(request, response);
  } catch (err) {
${logError}
    throw err;
  }
}
`;
}

/** Wraps TanStack fetch handlers with the request pipeline. */
export function patchFetchServerFile(content: string): string | null {
  if (content.includes("runRequestPipeline")) return content;
  if (!/async\s+fetch\s*\(/.test(content)) return null;

  let lines = content.split("\n");

  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("import ")) lastImportIdx = i;
  }
  if (lastImportIdx >= 0 && !content.includes('from "./lib/request-pipeline"')) {
    lines = [
      ...lines.slice(0, lastImportIdx + 1),
      `import { runRequestPipeline } from "./lib/request-pipeline";`,
      ...lines.slice(lastImportIdx + 1),
    ];
  }

  const runWithIdx = lines.findIndex((l) => l.includes("return runWithCfContext("));
  if (runWithIdx !== -1) {
    lines[runWithIdx] = lines[runWithIdx].replace(
      "return runWithCfContext(",
      "return runRequestPipeline(request, async () => runWithCfContext(",
    );
    const endIdx = lines.findIndex((l) => l.includes("end runWithCfContext"));
    if (endIdx !== -1) {
      lines[endIdx] = lines[endIdx].replace(/\}\);(\s*\/\/.*)?$/, "}));$1");
    }
    return lines.join("\n");
  }

  return null;
}
