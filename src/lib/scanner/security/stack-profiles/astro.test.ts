import { describe, expect, it } from "vitest";
import { astroProfile } from "./astro";
import { expressProfile } from "./express";
import { pickStackProfile } from "./types";
import type { SecurityScanProfileCtx } from "./types";

function ctx(partial: Partial<SecurityScanProfileCtx>): SecurityScanProfileCtx {
  return {
    files: [],
    fileContents: {},
    deps: {},
    ...partial,
  };
}

describe("astro stack profile", () => {
  it("matches Astro deps and is preferred over Express fallthrough", () => {
    const c = ctx({
      deps: { astro: "^4.0.0", typescript: "^5" },
      files: ["astro.config.mjs", "src/pages/index.astro"],
      sourceContent: `import { defineConfig } from "astro/config"`,
    });
    expect(astroProfile.match(c)).toBe(true);
    expect(expressProfile.match(c)).toBe(false);
    const picked = pickStackProfile([astroProfile, expressProfile], c);
    expect(picked?.id).toBe("astro");
  });

  it("does not match Express-only repos", () => {
    const c = ctx({
      deps: { express: "^4" },
      sourceContent: `import express from "express"`,
    });
    expect(astroProfile.match(c)).toBe(false);
  });
});
