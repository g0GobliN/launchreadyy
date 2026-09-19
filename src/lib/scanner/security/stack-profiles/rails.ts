import type { SecurityScanProfileCtx, StackProfile } from "./types";
import { hasFileMatching, manifestDeclares, sourceOfTypeMatches } from "./evidence";

const corpus = (ctx: SecurityScanProfileCtx) =>
  Object.values(ctx.fileContents).join("\n") + (ctx.sourceContent ?? "");

export const railsProfile: StackProfile = {
  id: "rails",
  label: "Rails",
  // Rails' own layout, a Gemfile entry, or framework identifiers inside real Ruby.
  match: (ctx) =>
    hasFileMatching(ctx, /(^|\/)config\/(application|routes)\.rb$/) ||
    manifestDeclares(ctx, /^\s*gem\s+["']rails["']/m) ||
    sourceOfTypeMatches(ctx, [".rb"], /\bActionController\b|\bRails\.application\b/),
  authDetector: (ctx) =>
    /before_action\s*:authenticate|authenticate_user!|current_user|devise/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "Rails before_action auth" }]
      : [],
  corsDetector: (ctx) =>
    /rack-cors|Rack::Cors|config\.middleware\.insert.*Cors/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "Rails rack-cors" }]
      : [],
  headersDetector: (ctx) =>
    /secure_headers|config\.force_ssl|content_security_policy/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "Rails security headers" }]
      : [],
  cookieDetector: (ctx) => {
    const c = corpus(ctx);
    if (!/cookies\[|session\[|cookie_store/i.test(c)) return [];
    const secure = /secure:\s*true|same_site:\s*:?(?:lax|strict)/i.test(c);
    return secure
      ? [{ kind: "framework_profile", detail: "Secure Rails cookies" }]
      : [{ kind: "heuristic", detail: "Rails cookies without secure/same_site flags" }];
  },
  csrfDetector: (ctx) =>
    /protect_from_forgery|csrf_meta_tags|verified_request/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "Rails CSRF protect_from_forgery" }]
      : [],
};
