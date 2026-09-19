import type { SecurityScanProfileCtx, StackProfile } from "./types";

const corpus = (ctx: SecurityScanProfileCtx) =>
  Object.values(ctx.fileContents).join("\n") + (ctx.sourceContent ?? "");

export const goProfile: StackProfile = {
  id: "go",
  label: "Go",
  match: (ctx) => ctx.files.some((f) => f.endsWith(".go") || f === "go.mod"),
  authDetector: (ctx) =>
    /middleware\.Auth|RequireAuth|jwt\.Parse|Authorization/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "Go auth middleware" }]
      : [],
  corsDetector: (ctx) =>
    /rs\/cors|AllowOrigins|gin\.CORS|cors\.Handler/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "Go CORS" }]
      : [],
  headersDetector: (ctx) =>
    /SecureMiddleware|X-Frame-Options|X-Content-Type-Options/i.test(corpus(ctx))
      ? [{ kind: "framework_profile", detail: "Go security headers" }]
      : [],
  cookieDetector: (ctx) => {
    const c = corpus(ctx);
    if (!/http\.Cookie|SetCookie|gorilla\/sessions/i.test(c)) return [];
    const secure = /HttpOnly:\s*true/i.test(c) && /Secure:\s*true/i.test(c);
    return secure
      ? [{ kind: "framework_profile", detail: "Secure Go cookies" }]
      : [{ kind: "heuristic", detail: "Go cookies without Secure/HttpOnly" }];
  },
};
