import type { SecurityScanProfileCtx, StackProfile } from "./types";
import { manifestDeclares, sourceOfTypeMatches } from "./evidence";

const corpus = (ctx: SecurityScanProfileCtx) =>
  Object.values(ctx.fileContents).join("\n") + (ctx.sourceContent ?? "");

export const fastapiProfile: StackProfile = {
  id: "fastapi",
  label: "FastAPI",
  // A declared dependency, or a real import in a Python file — not the word in prose.
  match: (ctx) =>
    manifestDeclares(ctx, /^\s*["']?fastapi(\b|[~=<>!])/im) ||
    sourceOfTypeMatches(ctx, [".py"], /\bfrom fastapi\b|\bimport fastapi\b/),
  authDetector: (ctx) =>
    /Depends\s*\(\s*(?:get_current_user|oauth2|HTTPBearer|security)/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "FastAPI Depends auth" }]
      : [],
  corsDetector: (ctx) =>
    /CORSMiddleware/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "FastAPI CORSMiddleware" }]
      : [],
  headersDetector: (ctx) =>
    /SecurityMiddleware|X-Frame-Options|Content-Security-Policy/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "FastAPI security headers" }]
      : [],
  cookieDetector: (ctx) => {
    const c = corpus(ctx);
    if (!/Response\s*\(.*cookie|set_cookie|Cookie\s*\(/i.test(c)) return [];
    const secure = /httponly\s*=\s*True/i.test(c) && /secure\s*=\s*True/i.test(c);
    return secure
      ? [{ kind: "framework_profile", detail: "Secure FastAPI cookies" }]
      : [{ kind: "heuristic", detail: "FastAPI cookies without Secure/HttpOnly" }];
  },
};
