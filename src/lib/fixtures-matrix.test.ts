/**
 * Detection + expected fix-tool coverage for fixtures/minimal/* stacks.
 * Keeps the production language matrix honest in CI without Docker.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectFramework, detectLanguage } from "./scanner-rules";
import { ALL_FIX_TOOL_IDS, REPO_PROFILES } from "./fix-tool-catalog";

const FIXTURES_ROOT = join(process.cwd(), "fixtures/minimal");

function listFilesRecursive(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...listFilesRecursive(full, rel));
    else out.push(rel);
  }
  return out;
}

const EXPECTED: Record<string, { language?: string; framework?: string }> = {
  express: { framework: "Express" },
  nextjs: { framework: "Next.js" },
  "vite-react": { framework: "Vite" },
  astro: { framework: "Astro" },
  python: { language: "Python" },
  fastapi: { language: "Python" },
  django: { language: "Python" },
  go: { language: "Go" },
  echo: { language: "Go" },
  ruby: { language: "Ruby" },
  rails: { language: "Ruby" },
  php: { language: "PHP" },
  laravel: { language: "PHP" },
  java: { language: "Java" },
  kotlin: { language: "Kotlin" },
  rust: { language: "Rust" },
  csharp: { language: "C#" },
  elixir: { language: "Elixir" },
  flutter: { language: "Flutter" },
  swift: { language: "Swift" },
};

describe("fixtures/minimal language detection", () => {
  const stacks = readdirSync(FIXTURES_ROOT).filter((n) =>
    statSync(join(FIXTURES_ROOT, n)).isDirectory(),
  );

  it("covers expected stacks", () => {
    for (const key of Object.keys(EXPECTED)) {
      expect(stacks, `missing fixture ${key}`).toContain(key);
    }
  });

  for (const stack of stacks) {
    const expected = EXPECTED[stack];
    if (!expected) continue;
    it(`detects ${stack}`, async () => {
      const files = listFilesRecursive(join(FIXTURES_ROOT, stack));
      if (expected.language) {
        expect(detectLanguage(files)).toBe(expected.language);
      }
      if (expected.framework) {
        const pkgPath = files.find((f) => f === "package.json" || f.endsWith("/package.json"));
        if (pkgPath) {
          const raw = await import("node:fs").then((fs) =>
            fs.readFileSync(join(FIXTURES_ROOT, stack, "package.json"), "utf8"),
          );
          const pkg = JSON.parse(raw) as Record<string, unknown>;
          expect(detectFramework(pkg)).toBe(expected.framework);
        }
      }
    });
  }
});

describe("fix-tool catalog", () => {
  it("includes security-csrf", () => {
    expect(ALL_FIX_TOOL_IDS).toContain("security-csrf");
  });

  it("REPO_PROFILES cover major languages", () => {
    const langs = new Set(REPO_PROFILES.map((p) => p.ctx.language));
    for (const lang of [
      "node",
      "python",
      "go",
      "ruby",
      "php",
      "java",
      "kotlin",
      "rust",
      "csharp",
      "elixir",
      "dart",
      "swift",
    ] as const) {
      expect(langs.has(lang), `missing profile language ${lang}`).toBe(true);
    }
  });
});
