import type { SecurityScanProfileCtx, StackProfile } from "./types";
import { hasFileMatching, manifestDeclares, sourceOfTypeMatches } from "./evidence";

const corpus = (ctx: SecurityScanProfileCtx) =>
  Object.values(ctx.fileContents).join("\n") + (ctx.sourceContent ?? "");

export const laravelProfile: StackProfile = {
  id: "laravel",
  label: "Laravel",
  // The framework's own entrypoint files, a composer requirement, or an Illuminate import in
  // actual PHP — the bare word "laravel" in prose no longer counts.
  match: (ctx) =>
    hasFileMatching(ctx, /(^|\/)artisan$|(^|\/)app\/Http\/Kernel\.php$/) ||
    manifestDeclares(ctx, /"laravel\/framework"|"illuminate\//i) ||
    sourceOfTypeMatches(ctx, [".php"], /\buse Illuminate\\/),
  authDetector: (ctx) =>
    /auth:sanctum|auth:api|middleware\(\s*['"]auth|Auth::/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "Laravel auth middleware" }]
      : [],
  corsDetector: (ctx) =>
    /HandleCors|fruitcake|config\/cors\.php/i.test(corpus(ctx)) ||
    ctx.files.some((f) => f.includes("config/cors.php"))
      ? [{ kind: "framework_profile", detail: "Laravel CORS" }]
      : [],
  headersDetector: (ctx) =>
    /SecurityHeaders|X-Frame-Options|Spatie\\\\Csp/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "Laravel security headers" }]
      : [],
  cookieDetector: (ctx) => {
    const c = corpus(ctx);
    if (!/cookie\(|Cookie::|SESSION_/i.test(c)) return [];
    return /http_only|same_site|secure/i.test(c)
      ? [{ kind: "framework_profile", detail: "Laravel cookie flags present" }]
      : [{ kind: "heuristic", detail: "Laravel cookies without clear Secure/HttpOnly/SameSite" }];
  },
  csrfDetector: (ctx) =>
    /VerifyCsrfToken|csrf_token\(|@csrf/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "Laravel CSRF" }]
      : [],
};
