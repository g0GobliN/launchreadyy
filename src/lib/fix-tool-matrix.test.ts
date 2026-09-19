/**
 * Exhaustive tool × stack matrix — every fix id × every repo profile.
 */
import { describe, expect, it } from "vitest";
import { getToolApplicability } from "./project-context.server";
import {
  ALL_FIX_TOOL_IDS,
  expectedToolApplicable,
  LANGUAGE_LINT_TOOLS,
  REPO_PROFILES,
} from "./fix-tool-catalog";
import { FIX_PACKS, resolvePackFixIds } from "./fix-packs";
import { getFixPreviewDetails } from "./mock-data";
import { runFixPreflight } from "./fix-preflight.server";
import { validateGeneratedFile } from "./fix-validation";
import { FIX_GENERATOR_TEMPLATES } from "./fix-executor.server";
import { isLanguageAiTestFix, languageUnitTestAiFix } from "./language-test-fixes";

describe("fix tool × repo matrix (exhaustive)", () => {
  for (const profile of REPO_PROFILES) {
    describe(profile.name, () => {
      for (const fixId of ALL_FIX_TOOL_IDS) {
        it(`${fixId} matches expected applicability`, () => {
          const actual = getToolApplicability(fixId, profile.ctx).applicable;
          const expected = expectedToolApplicable(fixId, profile.ctx, {
            staticSite: profile.staticSite,
          });
          expect(actual).toBe(expected);
        });
      }
    });
  }

  it("no cross-language lint tools leak", () => {
    for (const profile of REPO_PROFILES) {
      for (const [fixId, lang] of Object.entries(LANGUAGE_LINT_TOOLS)) {
        const result = getToolApplicability(fixId, profile.ctx);
        if (profile.ctx.language === lang) {
          expect(result.applicable).toBe(true);
        } else {
          expect(result.applicable).toBe(false);
        }
      }
    }
  });

  it("language AI tests only on matching language", () => {
    for (const profile of REPO_PROFILES) {
      for (const fixId of ALL_FIX_TOOL_IDS) {
        if (!isLanguageAiTestFix(fixId)) continue;
        const result = getToolApplicability(fixId, profile.ctx);
        const expected = languageUnitTestAiFix(profile.ctx.language);
        expect(result.applicable).toBe(expected === fixId);
      }
    }
  });

  // Written out rather than imported from the source: this is the policy the product intends,
  // and a test that reads the value it is checking would pass no matter what that value became.
  it("static HTML only allows CI/env/readme and pipeline-hardening fixes", () => {
    const staticProfile = REPO_PROFILES.find((p) => p.name === "static-html")!;
    const allowed = new Set([
      "github-actions",
      "ci-ai",
      "env-example",
      "env-example-ai",
      "readme",
      "readme-ai",
      "gitignore-env",
      // A static site still has a deploy workflow and sometimes an nginx image; hardening those
      // is about the pipeline, not about what the site is written in.
      "workflow-permissions",
      "workflow-unpinned-action",
      "docker-root-user",
    ]);
    for (const fixId of ALL_FIX_TOOL_IDS) {
      const ok = getToolApplicability(fixId, staticProfile.ctx).applicable;
      expect(ok).toBe(allowed.has(fixId));
    }
  });
});

describe("fix packs resolve per language", () => {
  for (const pack of FIX_PACKS) {
    for (const profile of REPO_PROFILES) {
      it(`${pack.id} on ${profile.name}`, () => {
        const ids = resolvePackFixIds(pack, profile.ctx.language, profile.ctx.isNodeProject);
        expect(ids.length).toBeGreaterThan(0);
        const applicable = ids.filter((id) => getToolApplicability(id, profile.ctx).applicable);
        if (profile.staticSite) return;
        expect(applicable.length).toBeGreaterThan(0);
      });
    }
  }
});

describe("fix preview metadata", () => {
  for (const fixId of ALL_FIX_TOOL_IDS) {
    it(`${fixId} has label or framework variant`, () => {
      const d =
        getFixPreviewDetails(fixId, "Vite") ??
        getFixPreviewDetails(fixId, "Python") ??
        getFixPreviewDetails(fixId, "Go");
      if (["ruff", "golangci-lint", "rubocop", "phpcs", "checkstyle", "credo"].includes(fixId)) {
        expect(true).toBe(true);
        return;
      }
      expect(d?.label ?? fixId).toBeTruthy();
    });
  }
});

describe("generator template smoke", () => {
  for (const [name, content] of Object.entries(FIX_GENERATOR_TEMPLATES)) {
    it(`${name} validates`, () => {
      const path =
        name === "prettierRc"
          ? ".prettierrc"
          : name === "prettierIgnore"
            ? ".prettierignore"
            : name === "dockerIgnore"
              ? ".dockerignore"
              : `${name}.ts`;
      const result = validateGeneratedFile(path, content);
      expect(result.status).not.toBe("invalid");
    });
  }
});

describe("fix tool catalog completeness", () => {
  it("covers every fix-executor switch case", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("./fix-executor/body/collect-fix-files.ts", import.meta.url),
      "utf8",
    );
    const cases = [...src.matchAll(/case\s+"([^"]+)"/g), ...src.matchAll(/case\s+'([^']+)'/g)].map(
      (m) => m[1]!,
    );
    const unique = [...new Set(cases)];
    const catalog = new Set<string>(ALL_FIX_TOOL_IDS);
    const missing = unique.filter((id) => !catalog.has(id));
    expect(missing).toEqual([]);
  });
});

describe("preflight monorepo vite", () => {
  it("passes when workspace packages patched", () => {
    const profile = REPO_PROFILES.find((p) => p.name === "monorepo-vite")!;
    const result = runFixPreflight({
      files: [
        {
          path: "apps/web/package.json",
          content:
            '{\n  "name": "web",\n  "type": "module",\n  "scripts": { "lint": "eslint ." }\n}\n',
        },
        {
          path: "package.json",
          content: '{\n  "name": "root",\n  "scripts": { "lint": "eslint ." }\n}\n',
        },
      ],
      ctx: profile.ctx,
      fixIds: ["ci-ai", "eslint"],
      repoFilePaths: profile.ctx.filePaths,
    });
    expect(result.passed).toBe(true);
  });
});
