import type { SecurityScanProfileCtx, StackProfile } from "./types";

const corpus = (ctx: SecurityScanProfileCtx) =>
  Object.values(ctx.fileContents).join("\n") + (ctx.sourceContent ?? "");

export const viteProfile: StackProfile = {
  id: "vite",
  label: "Vite",
  match: (ctx) =>
    Boolean(ctx.deps["vite"]) && !ctx.deps["next"] && !ctx.deps["express"] && !ctx.deps["astro"],
  cookieDetector: (ctx) => {
    const c = corpus(ctx);
    if (!/document\.cookie|js-cookie|Cookies\.set/i.test(c)) return [];
    return /secure|sameSite|httpOnly/i.test(c)
      ? [{ kind: "framework_profile", detail: "Client cookie flags mentioned" }]
      : [{ kind: "heuristic", detail: "Client-side cookies without Secure/SameSite" }];
  },
};
