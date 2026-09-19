export const SECURITY_HEADERS_FETCH = `export const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "X-XSS-Protection": "0",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

/** Wraps a fetch Response with security headers. */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
`;

export const RATE_LIMITER_FETCH = `const WINDOW_MS = 15 * 60 * 1000;
export const MAX_REQUESTS = 100;

export interface RateLimitEntry { count: number; reset: number }
export const _store = new Map<string, RateLimitEntry>();

export function checkRateLimit(
  ip: string,
): { allowed: boolean; remaining: number; retryAfter?: number } {
  const now = Date.now();
  let entry = _store.get(ip);
  if (!entry || now > entry.reset) {
    entry = { count: 1, reset: now + WINDOW_MS };
    _store.set(ip, entry);
    return { allowed: true, remaining: MAX_REQUESTS - 1 };
  }
  if (entry.count >= MAX_REQUESTS) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.reset - now) / 1000) };
  }
  entry.count++;
  return { allowed: true, remaining: MAX_REQUESTS - entry.count };
}

export function rateLimitResponse(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
  });
}
`;

export const CORS_FETCH = `const _allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    _allowedOrigins.includes("*") || (origin !== null && _allowedOrigins.includes(origin))
      ? (origin ?? "*")
      : (_allowedOrigins[0] ?? "*");
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

/** Returns a preflight response for OPTIONS requests, or null for other methods. */
export function handleCorsPreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
}
`;

export const SECURE_COOKIES_FETCH = `function fixCookieAttributes(cookie: string): string {
  const attrs = cookie
    .split(";")
    .slice(1)
    .map((p) => p.trim().toLowerCase());
  let result = cookie;
  if (!attrs.includes("httponly")) result += "; HttpOnly";
  if (!attrs.includes("secure")) result += "; Secure";
  if (!attrs.some((a) => a.startsWith("samesite"))) result += "; SameSite=Lax";
  return result;
}

/** Wraps a fetch Response, adding missing Secure/HttpOnly/SameSite attributes to Set-Cookie headers. */
export function withSecureCookies(response: Response): Response {
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length === 0) return response;
  const headers = new Headers(response.headers);
  headers.delete("Set-Cookie");
  for (const cookie of cookies) headers.append("Set-Cookie", fixCookieAttributes(cookie));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
`;

export const HTTPS_REDIRECT_FETCH = `/** Redirects to HTTPS when the request did not arrive over TLS. Trusts X-Forwarded-Proto (set by the edge/proxy) first, falling back to the request's own protocol. */
export function httpsRedirectResponse(request: Request): Response | null {
  const forwardedProto = request.headers.get("X-Forwarded-Proto");
  const isHttps = forwardedProto
    ? forwardedProto.split(",")[0].trim().toLowerCase() === "https"
    : new URL(request.url).protocol === "https:";
  if (isHttps) return null;
  const url = new URL(request.url);
  url.protocol = "https:";
  return new Response(null, { status: 301, headers: { Location: url.toString() } });
}
`;

export const LOGGER_FETCH = `type Level = "debug" | "info" | "warn" | "error";
export type LogData = Record<string, unknown>;

export function _log(level: Level, message: string, data?: LogData): void {
  const entry = JSON.stringify({ level, ts: new Date().toISOString(), message, ...data });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

export const logger = {
  debug: (msg: string, data?: LogData) => _log("debug", msg, data),
  info: (msg: string, data?: LogData) => _log("info", msg, data),
  warn: (msg: string, data?: LogData) => _log("warn", msg, data),
  error: (msg: string, data?: LogData) => _log("error", msg, data),
};
`;
