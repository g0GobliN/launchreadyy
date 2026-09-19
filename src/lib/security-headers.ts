/**
 * Security response headers for LaunchReadyy's own responses.
 *
 * Applied to every response from `src/server.ts` (SSR HTML, badge SVGs, API replies).
 *
 * `script-src` keeps `'unsafe-inline'` deliberately: the pre-paint theme script and the
 * JSON-LD block in `src/routes/__root.tsx` are inline, and TanStack Start streams inline
 * hydration scripts whose content is not known ahead of render, so a nonce would have to
 * thread through the streaming SSR pipeline. The directive still pins executable script to
 * `'self'`, which is what blocks the injected-third-party-script case.
 *
 * Everything the app talks to (SQLite, GitHub, E2B, AI) is reached from the server, never
 * from the browser — so `connect-src` stays `'self'`.
 *
 * @see src/lib/security-headers.test.ts
 */

/** Google Fonts (stylesheet vs. font file are different origins). */
const FONT_STYLE_ORIGIN = "https://fonts.googleapis.com";
const FONT_FILE_ORIGINS = ["https://fonts.gstatic.com"];

function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    `style-src 'self' 'unsafe-inline' ${FONT_STYLE_ORIGIN}`,
    `font-src 'self' data: ${FONT_FILE_ORIGINS.join(" ")}`,
    // Repo/user avatars and OG images come from many hosts; images are a low-risk sink.
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Belt-and-braces with X-Frame-Options for browsers that honour only one.
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Header name → value. Callers must not mutate the returned object. */
export function securityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(),
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), interest-cohort=()",
    // Keep cross-origin embedding of badge SVGs working while isolating the app's own docs.
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/**
 * Return `response` with the security headers set, without clobbering headers a handler
 * set deliberately. Streams the original body through — no buffering.
 *
 * Badge SVGs are embedded cross-origin in READMEs, so they opt out of COOP and keep the
 * permissive CORP they need; `frame-ancestors`/`X-Frame-Options` do not affect `<img>`.
 */
export function withSecurityHeaders(response: Response, opts?: { badge?: boolean }): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders())) {
    if (opts?.badge && name === "Cross-Origin-Opener-Policy") continue;
    headers.set(name, value);
  }
  if (opts?.badge) headers.set("Cross-Origin-Resource-Policy", "cross-origin");

  // 304/204 must not carry a body; reusing `response.body` (null) is correct either way.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
