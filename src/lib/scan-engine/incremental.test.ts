import { describe, expect, it } from "vitest";
import {
  changedPaths,
  diffChangedFiles,
  globToRegExp,
  hashContent,
  matchesGlob,
  mergeCarryForward,
  requiresFullRescan,
  selectRulesToRerun,
  type RuleInputSpec,
} from "./incremental";
import { DEFAULT_SCAN_RULE_MANIFEST } from "./rule-manifest";

describe("hashContent", () => {
  it("is stable and distinguishes different content", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
    expect(hashContent("hello")).not.toBe(hashContent("hello!"));
    expect(hashContent("")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("diffChangedFiles", () => {
  it("classifies added/modified/removed/unchanged", () => {
    const prev = { "a.ts": "1", "b.ts": "2", "c.ts": "3" };
    const current = { "a.ts": "1", "b.ts": "changed", "d.ts": "4" };
    const diff = diffChangedFiles(prev, current);
    expect(diff.unchanged).toEqual(["a.ts"]);
    expect(diff.modified).toEqual(["b.ts"]);
    expect(diff.added).toEqual(["d.ts"]);
    expect(diff.removed).toEqual(["c.ts"]);
    expect(changedPaths(diff).sort()).toEqual(["b.ts", "c.ts", "d.ts"]);
  });
});

describe("globToRegExp / matchesGlob", () => {
  it("handles ** across directories and * within a segment", () => {
    expect(matchesGlob("src/api/users.ts", "src/**/*.ts")).toBe(true);
    expect(matchesGlob("src/users.ts", "src/**/*.ts")).toBe(true); // **/ matches zero dirs
    expect(matchesGlob("src/api/users.js", "src/**/*.ts")).toBe(false);
    expect(matchesGlob("app.ts", "*.ts")).toBe(true);
    expect(matchesGlob("src/app.ts", "*.ts")).toBe(false); // * does not cross /
  });

  it("escapes regex metacharacters in the glob", () => {
    expect(globToRegExp("a.b.ts").test("aXbXts")).toBe(false);
    expect(matchesGlob("a.b.ts", "a.b.ts")).toBe(true);
  });

  /**
   * Regression: braces were escaped as literals, so `**\/*.{ts,tsx,js}` compiled to a pattern that
   * only matched a file *named* `.{ts,tsx,js}`. Nearly every rule in the manifest is written that
   * way, so on an incremental scan those rules never re-ran and their findings were carried
   * forward untouched — a newly added secret was never reported, a fixed one never cleared.
   */
  it("expands brace alternation", () => {
    expect(matchesGlob("src/config.ts", "**/*.{ts,tsx,js}")).toBe(true);
    expect(matchesGlob("src/App.tsx", "**/*.{ts,tsx,js}")).toBe(true);
    expect(matchesGlob("app.js", "**/*.{ts,tsx,js}")).toBe(true);
    expect(matchesGlob("main.py", "**/*.{ts,tsx,js}")).toBe(false);
    expect(matchesGlob("a/b/c.ts", "**/*.{ts,tsx,js}")).toBe(true);
  });

  it("expands braces in the middle of a segment", () => {
    expect(matchesGlob("api.test.ts", "**/*.{test,spec}.{ts,tsx,js}")).toBe(true);
    expect(matchesGlob("api.spec.js", "**/*.{test,spec}.{ts,tsx,js}")).toBe(true);
    expect(matchesGlob("api.ts", "**/*.{test,spec}.{ts,tsx,js}")).toBe(false);
  });

  it("treats an unbalanced brace as a literal instead of swallowing the pattern", () => {
    expect(matchesGlob("a{b.ts", "a{b.ts")).toBe(true);
    expect(matchesGlob("ab.ts", "a{b.ts")).toBe(false);
  });

  /** A leading globstar spans whole directories, so it must not match a partial filename. */
  it("anchors **/ at a path separator", () => {
    expect(matchesGlob("a/foo.ts", "**/foo.ts")).toBe(true);
    expect(matchesGlob("foo.ts", "**/foo.ts")).toBe(true);
    expect(matchesGlob("barfoo.ts", "**/foo.ts")).toBe(false);
    expect(matchesGlob("apps/web/package.json", "**/package.json")).toBe(true);
    expect(matchesGlob("mypackage.json", "**/package.json")).toBe(false);
  });
});

/**
 * The manifest is the thing the bug actually broke, so assert against it directly rather than
 * against hand-written globs — a future entry using syntax globToRegExp doesn't support fails here
 * instead of silently freezing that rule's findings.
 */
describe("DEFAULT_SCAN_RULE_MANIFEST wiring", () => {
  it("re-runs the security rules when a source file changes", () => {
    const rerun = selectRulesToRerun(["src/routes/auth.ts"], DEFAULT_SCAN_RULE_MANIFEST);
    for (const ruleId of [
      "security-hardcoded-secret",
      "security-secret-heuristic",
      "security-unsafe-api",
      "security-auth-guard",
    ]) {
      expect(rerun).toContain(ruleId);
    }
  });

  it("re-runs dependency-shaped rules when a nested manifest changes", () => {
    const rerun = selectRulesToRerun(["apps/web/package.json"], DEFAULT_SCAN_RULE_MANIFEST);
    expect(rerun).toContain("helmet");
    expect(rerun).toContain("osv-vuln");
  });

  it("has no glob that matches nothing at all", () => {
    const dead: string[] = [];
    for (const spec of DEFAULT_SCAN_RULE_MANIFEST) {
      if (spec.inputs === "repo-wide") continue;
      for (const glob of spec.inputs) {
        // A glob compiling to a pattern requiring a literal "{" can never match a real path.
        if (globToRegExp(glob).source.includes("\\{")) dead.push(`${spec.ruleId}: ${glob}`);
      }
    }
    expect(dead).toEqual([]);
  });
});

describe("selectRulesToRerun", () => {
  const manifest: RuleInputSpec[] = [
    { ruleId: "has-ci", inputs: "repo-wide" },
    { ruleId: "unsafe-api", inputs: ["src/**/*.ts", "src/**/*.js"] },
    { ruleId: "readme", inputs: ["README.md"] },
  ];

  it("reruns repo-wide rules on any change, glob rules only on matches", () => {
    const rerun = selectRulesToRerun(["src/api/x.ts"], manifest);
    expect(rerun).toContain("has-ci");
    expect(rerun).toContain("unsafe-api");
    expect(rerun).not.toContain("readme");
  });

  it("reruns nothing when nothing changed", () => {
    expect(selectRulesToRerun([], manifest)).toEqual([]);
  });

  it("reruns the readme rule only when README changes", () => {
    expect(selectRulesToRerun(["README.md"], manifest)).toEqual(["has-ci", "readme"]);
  });
});

describe("requiresFullRescan", () => {
  it("forces a full rescan on dependency/config/CI changes", () => {
    expect(requiresFullRescan(["package.json"])).toBe(true);
    expect(requiresFullRescan(["pnpm-lock.yaml"])).toBe(true);
    expect(requiresFullRescan([".github/workflows/ci.yml"])).toBe(true);
    expect(requiresFullRescan(["tsconfig.json"])).toBe(true);
  });

  it("allows incremental for ordinary source edits", () => {
    expect(requiresFullRescan(["src/app.ts", "README.md"])).toBe(false);
  });
});

describe("mergeCarryForward", () => {
  it("keeps findings from non-rerun rules and replaces rerun ones (even with empty results)", () => {
    const prev = [
      { ruleId: "unsafe-api", title: "old eval" },
      { ruleId: "has-ci", title: "no CI" },
    ];
    const reran = [{ ruleId: "unsafe-api", title: "new eval" }];
    const merged = mergeCarryForward(prev, reran, ["unsafe-api"]);
    expect(merged).toEqual([
      { ruleId: "has-ci", title: "no CI" },
      { ruleId: "unsafe-api", title: "new eval" },
    ]);
  });

  it("dropping a rerun rule's finding (fixed issue) removes it from the merged set", () => {
    const prev = [{ ruleId: "unsafe-api", title: "old eval" }];
    const merged = mergeCarryForward(prev, [], ["unsafe-api"]);
    expect(merged).toEqual([]);
  });
});
