import type { SecurityScanProfileCtx, StackProfile } from "./types";

const ASTRO_AUTH = /\b(?:getSession|Auth\.|lucia|better-auth|clerk|supabase\.auth|astro-auth)\b/i;
const ASTRO_HEADERS =
  /\b(?:Content-Security-Policy|X-Frame-Options|Strict-Transport-Security|helmet)\b/i;
const ASTRO_CSRF = /\b(?:csrf|double.?csrf|origin.?check)\b/i;

/**
 * Astro stack profile — prevents fallthrough to Express-shaped heuristics
 * when `astro` is present (the motivating sandbox-detection bug).
 */
export const astroProfile: StackProfile = {
  id: "astro",
  label: "Astro",
  match: (ctx) =>
    Boolean(ctx.deps["astro"]) ||
    ctx.files.some((f) => /(^|\/)astro\.config\.(m?js|ts|mjs|cjs)$/.test(f)) ||
    /\bfrom ['"]astro(:|$)|import\.meta\.env/.test(ctx.sourceContent ?? ""),
  authDetector: (ctx) => {
    const corpus = Object.values(ctx.fileContents).join("\n") + (ctx.sourceContent ?? "");
    return ASTRO_AUTH.test(corpus)
      ? [{ kind: "framework_profile", detail: "Astro auth integration detected" }]
      : [];
  },
  headersDetector: (ctx) => {
    const corpus = Object.values(ctx.fileContents).join("\n") + (ctx.sourceContent ?? "");
    // Astro middleware / adapter security headers, or Cloudflare/Vercel headers config.
    if (
      ASTRO_HEADERS.test(corpus) ||
      ctx.files.some((f) => /^(public\/)?_headers$|vercel\.json|wrangler\.toml/.test(f))
    ) {
      return [
        { kind: "framework_profile", detail: "Security headers configured for Astro deploy" },
      ];
    }
    return [];
  },
  cookieDetector: (ctx: SecurityScanProfileCtx) => {
    const corpus = Object.values(ctx.fileContents).join("\n") + (ctx.sourceContent ?? "");
    if (!/Astro\.cookies|cookies\.set|Set-Cookie/i.test(corpus)) return [];
    const secure =
      /httpOnly\s*:\s*true/i.test(corpus) &&
      /secure\s*:\s*true/i.test(corpus) &&
      /sameSite/i.test(corpus);
    return secure
      ? [{ kind: "framework_profile", detail: "Secure Astro cookie flags present" }]
      : [{ kind: "heuristic", detail: "Astro cookies without full Secure/HttpOnly/SameSite set" }];
  },
  csrfDetector: (ctx) => {
    const corpus = Object.values(ctx.fileContents).join("\n") + (ctx.sourceContent ?? "");
    return ASTRO_CSRF.test(corpus)
      ? [{ kind: "framework_profile", detail: "CSRF / origin check detected" }]
      : [];
  },
};
