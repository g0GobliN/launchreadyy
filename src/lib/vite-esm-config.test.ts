import { describe, expect, it } from "vitest";
import {
  migrateViteConfigContentToEsm,
  patchPackageJsonTypeModule,
  usesEsmSyntax,
  viteConfigNeedsEsmFix,
} from "./vite-esm-config";

describe("viteConfigNeedsEsmFix", () => {
  it("flags vite.config.js with vitest dep", () => {
    expect(
      viteConfigNeedsEsmFix(
        "vite.config.js",
        "import { defineConfig } from 'vitest/config'\nexport default defineConfig({})",
        undefined,
        { vitest: "^3.0.0", vite: "^6.0.0" },
      ),
    ).toBe(true);
  });

  it("skips when type is already module", () => {
    expect(
      viteConfigNeedsEsmFix("vite.config.js", "export default {}", "module", { vitest: "^3.0.0" }),
    ).toBe(false);
  });
});

describe("usesEsmSyntax", () => {
  it("detects import/export", () => {
    expect(usesEsmSyntax("import x from 'vite'\nexport default {}")).toBe(true);
    expect(usesEsmSyntax("const x = require('vite')")).toBe(false);
  });
});

describe("migrateViteConfigContentToEsm", () => {
  it("converts module.exports", () => {
    expect(migrateViteConfigContentToEsm("module.exports = { foo: 1 }")).toContain(
      "export default",
    );
  });
});

describe("patchPackageJsonTypeModule", () => {
  it("adds type module", () => {
    const out = patchPackageJsonTypeModule('{\n  "name": "app"\n}\n');
    expect(out).toContain('"type": "module"');
  });
});
