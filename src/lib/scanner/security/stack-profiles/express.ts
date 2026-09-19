import type { SecurityScanProfileCtx, StackProfile } from "./types";

const EXPRESS_AUTH =
  /\b(?:passport|express-session|requireAuth|isAuthenticated|ensureAuthenticated)\b/i;

/**
 * These match an *invocation*, not an identifier, and are searched across the sampled corpus
 * rather than the entry file alone.
 *
 * The previous versions fell back to `Boolean(ctx.deps[...])`, so a package listed in
 * package.json counted as the control being configured. Installing helmet from a tutorial and
 * never calling `app.use(helmet())` is an ordinary thing to do, and it made the scan report
 * security headers, CORS and CSRF as all present on an app that had none of them — the failure
 * direction that matters most, because the user is told the area is fine.
 *
 * An invocation is the earliest point where the middleware is actually built, so this still
 * matches `app.use(cors())`, `router.use(helmet())` and `[cors(), helmet()]`, while an import on
 * its own no longer counts.
 */
const EXPRESS_CORS_USED = /\bcors\s*\(/;
const EXPRESS_HEADERS_USED = /\bhelmet\s*\(/;
const EXPRESS_CSRF_USED = /\bcsurf\s*\(|\bdoubleCsrf\s*\(|\bcsrfProtection\b/i;

/** Entry file plus the sampled files — middleware is frequently wired outside the entry point. */
function corpusOf(ctx: SecurityScanProfileCtx): string {
  return `${Object.values(ctx.fileContents).join("\n")}\n${ctx.sourceContent ?? ""}`;
}

export const expressProfile: StackProfile = {
  id: "express",
  label: "Express",
  match: (ctx) =>
    Boolean(ctx.deps["express"]) ||
    /\bfrom ['"]express['"]|require\(['"]express['"]\)/.test(ctx.sourceContent ?? ""),
  authDetector: (ctx) =>
    EXPRESS_AUTH.test(Object.values(ctx.fileContents).join("\n"))
      ? [{ kind: "framework_profile", detail: "Express auth middleware detected" }]
      : [],
  corsDetector: (ctx) =>
    EXPRESS_CORS_USED.test(corpusOf(ctx))
      ? [{ kind: "framework_profile", detail: "Express cors middleware applied" }]
      : [],
  headersDetector: (ctx) =>
    EXPRESS_HEADERS_USED.test(corpusOf(ctx))
      ? [{ kind: "framework_profile", detail: "Helmet middleware applied" }]
      : [],
  cookieDetector: (ctx: SecurityScanProfileCtx) => {
    const corpus = Object.values(ctx.fileContents).join("\n") + (ctx.sourceContent ?? "");
    if (!/res\.cookie\s*\(|cookie-parser/.test(corpus)) return [];
    const secure =
      /sameSite\s*:\s*['"](?:strict|lax)['"]/i.test(corpus) &&
      /httpOnly\s*:\s*true/i.test(corpus) &&
      /secure\s*:\s*true/i.test(corpus);
    return secure
      ? [{ kind: "framework_profile", detail: "Secure cookie flags present" }]
      : [{ kind: "heuristic", detail: "Cookie usage without full Secure/HttpOnly/SameSite set" }];
  },
  csrfDetector: (ctx) =>
    EXPRESS_CSRF_USED.test(corpusOf(ctx))
      ? [{ kind: "framework_profile", detail: "CSRF middleware applied" }]
      : [],
};
