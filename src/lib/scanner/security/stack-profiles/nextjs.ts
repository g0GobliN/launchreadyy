import type { StackProfile } from "./types";

/**
 * Auth idioms across the libraries a Next.js app actually uses.
 *
 * Completeness matters more here than it used to: while a bare `middleware.ts` counted as auth,
 * a missing pattern was harmless. Now that the detector judges middleware on its contents, any
 * idiom absent from this list turns into a false "no auth" finding. `auth as middleware` is
 * NextAuth v5's documented middleware export and `authMiddleware` is Clerk v4's — both would
 * otherwise have been missed.
 */
const NEXT_AUTH =
  /\b(?:getServerSession|auth\(\)|auth\s+as\s+middleware|clerkMiddleware|authMiddleware|withAuth|next-auth|better-auth|lucia|@clerk\/nextjs)\b/i;
/**
 * Signals that a security header is actually *set*.
 *
 * The previous pattern accepted `NextResponse.next` and `headers()`. Neither sets a header:
 * `return NextResponse.next()` is the canonical middleware pass-through, present in virtually
 * every Next.js app that has a middleware file, and `headers()` from `next/headers` *reads*
 * request headers. So the check passed on apps with no security headers at all — on what is
 * likely this product's most common stack. (`headers()` was additionally dead: the pattern's
 * trailing `\b` cannot match after `)`, which is always followed by a non-word character.)
 *
 * Matches the two places Next.js really sets them — the `async headers()` block in next.config,
 * and `headers.set(...)` in middleware or a route handler — plus the header names themselves.
 */
const NEXT_HEADERS =
  /Content-Security-Policy|Strict-Transport-Security|X-Frame-Options|X-Content-Type-Options|Referrer-Policy|Permissions-Policy|headers\.set\s*\(|async\s+headers\s*\(\s*\)/i;
const NEXT_COOKIE = /\bcookies\(\)|setCookie|httpOnly|sameSite|secure:\s*true/i;

export const nextProfile: StackProfile = {
  id: "nextjs",
  label: "Next.js",
  match: (ctx) =>
    Boolean(ctx.deps["next"]) ||
    ctx.files.some(
      (f) => f === "next.config.js" || f === "next.config.mjs" || f === "next.config.ts",
    ),
  /**
   * A `middleware.ts` file used to count as auth on its own, but middleware is just as often
   * i18n, redirects or logging — so its mere existence said nothing, and an app with no auth at
   * all passed.
   *
   * Dropping that fallback outright would trade the false negative for a false positive, because
   * middleware may sit outside the ~35-file content sample and auth wired there would look
   * missing. So the file's existence only counts when we could not read it: if the file was
   * sampled and shows no auth, that is evidence of absence and the finding should fire.
   */
  authDetector: (ctx) => {
    const corpus = `${Object.values(ctx.fileContents).join("\n")}\n${ctx.sourceContent ?? ""}`;
    if (NEXT_AUTH.test(corpus)) {
      return [{ kind: "framework_profile", detail: "Next.js auth detected" }];
    }
    const middleware = ctx.files.filter((f) => /(^|\/)middleware\.(ts|js|mjs)$/.test(f));
    if (middleware.length === 0) return [];
    const readable = middleware.some((f) => f in ctx.fileContents);
    return readable
      ? []
      : [{ kind: "heuristic", detail: "middleware present but outside the sampled files" }];
  },
  headersDetector: (ctx) =>
    NEXT_HEADERS.test(Object.values(ctx.fileContents).join("\n"))
      ? [{ kind: "framework_profile", detail: "Next.js headers / CSP signals" }]
      : [],
  cookieDetector: (ctx) => {
    const corpus = Object.values(ctx.fileContents).join("\n");
    if (!NEXT_COOKIE.test(corpus)) return [];
    const secure =
      /sameSite\s*:\s*['"](?:strict|lax)['"]/i.test(corpus) && /httpOnly\s*:\s*true/i.test(corpus);
    return secure
      ? [{ kind: "framework_profile", detail: "Next.js secure cookie flags" }]
      : [{ kind: "heuristic", detail: "Cookie usage without full secure flags" }];
  },
};
