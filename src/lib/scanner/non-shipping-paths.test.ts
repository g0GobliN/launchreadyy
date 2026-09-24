import { describe, expect, it } from "vitest";
import { NON_SHIPPING_GLOBS, isNonShippingPath, shippingContents } from "./non-shipping-paths";

/**
 * The matcher compares strings — a `*.ext` glob is a file-name suffix, anything else is an exact
 * name — rather than building a RegExp out of the glob text. These cases pin the behaviours that
 * make that safe, because the failure it replaced was silent: a glob interpolated into a pattern
 * matches nothing once it contains a metacharacter nobody escaped.
 */
describe("isNonShippingPath", () => {
  it("treats a `*.ext` glob as a file-name suffix", () => {
    expect(isNonShippingPath("src/lib/thing.test.ts")).toBe(true);
    expect(isNonShippingPath("app/utils.spec.jsx")).toBe(true);
    expect(isNonShippingPath("public/app.min.js")).toBe(true);
    expect(isNonShippingPath("styles/site.min.css")).toBe(true);
  });

  it("matches the suffix against the whole name, not a substring of it", () => {
    // `attest.ts` ends in "est.ts" but is not a test file; `.test.ts.bak` is a backup of one.
    expect(isNonShippingPath("src/lib/attest.ts")).toBe(false);
    expect(isNonShippingPath("src/lib/thing.test.ts.bak")).toBe(false);
    expect(isNonShippingPath("src/detest.ts")).toBe(false);
  });

  it("matches a directory segment anywhere in the path", () => {
    expect(isNonShippingPath("node_modules/left-pad/index.js")).toBe(true);
    expect(isNonShippingPath("fixtures/minimal/express/server.js")).toBe(true);
    expect(isNonShippingPath("packages/web/dist/bundle.js")).toBe(true);
  });

  it("does not match a directory name that only looks similar", () => {
    // Neither of these is in NON_SHIPPING_DIRS or DEV_TOOLING_DIRS: a prefix of a listed name
    // (`node_modulesx`) and a near-miss (`builds`) must both stay in scope, or a real source
    // directory silently drops out of every analyzer.
    expect(isNonShippingPath("node_modulesx/index.js")).toBe(false);
    expect(isNonShippingPath("builds/index.js")).toBe(false);
    expect(isNonShippingPath("src/build/index.js")).toBe(true);
  });

  it("keeps the glob list in the shape the matcher understands", () => {
    // A star anywhere but the front (`src/*.ts`) has no defined meaning here and would be treated
    // as literal text, silently matching nothing.
    for (const glob of NON_SHIPPING_GLOBS) {
      expect(glob.startsWith("*") || !glob.includes("*")).toBe(true);
    }
  });

  it("shippingContents drops non-shipping paths and keeps the rest", () => {
    const contents = {
      "src/app.ts": "a",
      "src/app.test.ts": "b",
      "node_modules/left-pad/index.js": "c",
      Dockerfile: "d",
    };

    expect(Object.keys(shippingContents(contents))).toEqual(["src/app.ts", "Dockerfile"]);
  });
});
