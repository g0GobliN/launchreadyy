import { describe, expect, it } from "vitest";
import { pickCiNodeVersion } from "./helpers";

/**
 * The sandbox preferred `.nvmrc` (resolveSandboxNodeVersion) but the CI generator read only
 * `engines.node`, so a repo pinned the ordinary nvm way sandbox-verified on its real Node and
 * then got a CI workflow hardcoded to the "20" fallback. Observed on a real PR: an Astro repo
 * with `.nvmrc` = 22.23.1 had every CI job die on
 * "Node.js v20.20.2 is not supported by Astro! … requires >=22.12.0".
 */
describe("pickCiNodeVersion", () => {
  it("prefers .nvmrc over engines.node", () => {
    expect(pickCiNodeVersion("22.23.1\n", ">=18")).toBe("22");
  });

  it("accepts a v-prefixed .nvmrc", () => {
    expect(pickCiNodeVersion("v20.11.0", undefined)).toBe("20");
  });

  it("falls back to engines.node when there is no .nvmrc", () => {
    expect(pickCiNodeVersion(null, "^22.12.0")).toBe("22");
  });

  it("defaults to 20 when neither is present", () => {
    expect(pickCiNodeVersion(null, undefined)).toBe("20");
  });

  it("ignores an empty or junk .nvmrc and uses engines", () => {
    expect(pickCiNodeVersion("   \n", ">=22.12.0")).toBe("22");
    expect(pickCiNodeVersion("lts/hydrogen", ">=18.0.0")).toBe("18");
  });
});
