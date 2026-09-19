import type { SecurityScanProfileCtx, StackProfile } from "./types";
import { hasFileMatching, manifestDeclares, sourceOfTypeMatches } from "./evidence";

const corpus = (ctx: SecurityScanProfileCtx) =>
  Object.values(ctx.fileContents).join("\n") + (ctx.sourceContent ?? "");

export const djangoProfile: StackProfile = {
  id: "django",
  label: "Django",
  // Structural only. `settings.py` alone is not enough — plenty of Python projects have one —
  // so it has to be paired with the Django-specific setting that every project defines.
  match: (ctx) =>
    hasFileMatching(ctx, /(^|\/)manage\.py$/) ||
    manifestDeclares(ctx, /^\s*["']?[Dd]jango(\b|[~=<>!])/m) ||
    sourceOfTypeMatches(ctx, [".py"], /\bINSTALLED_APPS\b|\bfrom django\b|\bimport django\b/),
  authDetector: (ctx) =>
    /login_required|LoginRequiredMixin|PermissionRequiredMixin|@permission_required/i.test(
      corpus(ctx),
    )
      ? [{ kind: "framework_profile", detail: "Django auth decorators/mixins" }]
      : [],
  corsDetector: (ctx) =>
    /corsheaders|django-cors-headers|CORS_ALLOWED_ORIGINS/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "django-cors-headers" }]
      : [],
  headersDetector: (ctx) =>
    /SecurityMiddleware|SECURE_HSTS|SECURE_SSL_REDIRECT|CSP_/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "Django SecurityMiddleware" }]
      : [],
  cookieDetector: (ctx) => {
    const c = corpus(ctx);
    if (!/SESSION_COOKIE|set_cookie|HttpResponse.*cookie/i.test(c)) return [];
    const secure =
      /SESSION_COOKIE_SECURE\s*=\s*True/i.test(c) &&
      /SESSION_COOKIE_HTTPONLY\s*=\s*True/i.test(c) &&
      /SESSION_COOKIE_SAMESITE/i.test(c);
    return secure
      ? [{ kind: "framework_profile", detail: "Secure Django session cookies" }]
      : [{ kind: "heuristic", detail: "Django cookies without full Secure/HttpOnly/SameSite" }];
  },
  csrfDetector: (ctx) =>
    /CsrfViewMiddleware|csrf_exempt|csrf_protect|{%\s*csrf_token\s*%}/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "Django CSRF middleware" }]
      : [],
};
