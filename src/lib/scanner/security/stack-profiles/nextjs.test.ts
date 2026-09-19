import { describe, expect, it } from "vitest";
import { nextProfile } from "./nextjs";
import type { SecurityScanProfileCtx } from "./types";

function ctx(fileContents: Record<string, string>, files: string[] = []): SecurityScanProfileCtx {
  return { files, fileContents, deps: { next: "^15.0.0" } };
}

const detected = (signals: { kind: string }[]) => signals.length > 0;

describe("nextjs headersDetector", () => {
  /**
   * Regression: the pattern accepted `NextResponse.next`, which is the canonical middleware
   * pass-through — `export function middleware() { return NextResponse.next(); }` appears in
   * virtually every Next.js app that has a middleware file and sets no header at all. The
   * security-headers check therefore passed on apps that had none, on this product's most common
   * stack.
   */
  it("does not accept the middleware pass-through as a security header", () => {
    const c = ctx({
      "middleware.ts": "export function middleware() {\n  return NextResponse.next();\n}",
    });
    expect(detected(nextProfile.headersDetector!(c))).toBe(false);
  });

  /** `headers()` from next/headers reads request headers; it never sets one. */
  it("does not accept reading request headers as setting them", () => {
    const c = ctx({
      "app/page.tsx": 'import { headers } from "next/headers";\nconst h = headers();\nh.get("x");',
    });
    expect(detected(nextProfile.headersDetector!(c))).toBe(false);
  });

  it("detects the next.config headers block", () => {
    const c = ctx({
      "next.config.js": [
        "module.exports = {",
        "  async headers() {",
        "    return [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }];",
        "  },",
        "};",
      ].join("\n"),
    });
    expect(detected(nextProfile.headersDetector!(c))).toBe(true);
  });

  it("detects headers set in middleware", () => {
    const c = ctx({
      "middleware.ts": [
        "const res = NextResponse.next();",
        'res.headers.set("Referrer-Policy", "no-referrer");',
        "return res;",
      ].join("\n"),
    });
    expect(detected(nextProfile.headersDetector!(c))).toBe(true);
  });

  it.each([
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "Permissions-Policy",
  ])("detects a %s header by name", (header) => {
    expect(
      detected(nextProfile.headersDetector!(ctx({ "app/route.ts": `"${header}": "x"` }))),
    ).toBe(true);
  });

  it("reports a bare app with nothing configured", () => {
    const c = ctx({ "app/page.tsx": "export default function P() { return null; }" });
    expect(detected(nextProfile.headersDetector!(c))).toBe(false);
  });
});

describe("nextjs authDetector", () => {
  /**
   * Regression: a `middleware.ts` file counted as auth purely by existing. Middleware is just as
   * often i18n, redirects or logging, so an app with no auth anywhere passed the check.
   */
  it("does not accept a sampled middleware file that contains no auth", () => {
    const c = ctx(
      { "middleware.ts": "export function middleware() { return NextResponse.next(); }" },
      ["middleware.ts"],
    );
    expect(detected(nextProfile.authDetector!(c))).toBe(false);
  });

  /**
   * Once middleware is judged on its contents, an auth idiom missing from NEXT_AUTH becomes a
   * false "no auth" finding — so the common ones are pinned here.
   */
  it.each([
    ["NextAuth v5 middleware export", "export { auth as middleware } from './auth';"],
    ["Clerk v5", "export default clerkMiddleware();"],
    ["Clerk v4", "export default authMiddleware({});"],
    ["NextAuth v4", "const session = await getServerSession(authOptions);"],
    ["better-auth", 'import { betterAuth } from "better-auth";'],
  ])("detects %s in the sampled middleware", (_label, source) => {
    const c = ctx({ "middleware.ts": source }, ["middleware.ts"]);
    expect(detected(nextProfile.authDetector!(c))).toBe(true);
  });

  it("detects auth anywhere in the sampled corpus", () => {
    const c = ctx({ "app/api/me/route.ts": "const session = await getServerSession();" });
    expect(detected(nextProfile.authDetector!(c))).toBe(true);
  });

  /**
   * The file-existence fallback is kept for exactly one case: middleware that exists but fell
   * outside the content sample. Reporting "no auth" there would be a false positive.
   */
  it("stays quiet when middleware exists but was not sampled", () => {
    const c = ctx({ "app/page.tsx": "export default function P() { return null; }" }, [
      "middleware.ts",
    ]);
    expect(detected(nextProfile.authDetector!(c))).toBe(true);
    expect(nextProfile.authDetector!(c)[0]!.kind).toBe("heuristic");
  });

  it("reports an app with no auth and no middleware at all", () => {
    const c = ctx({ "app/page.tsx": "export default function P() { return null; }" }, [
      "app/page.tsx",
    ]);
    expect(detected(nextProfile.authDetector!(c))).toBe(false);
  });
});

describe("nextjs profile shape", () => {
  /** cors.ts skips any stack without a corsDetector; its docs must match what exists here. */
  it("has no corsDetector, matching what cors.ts documents", () => {
    expect(nextProfile.corsDetector).toBeUndefined();
  });
});
