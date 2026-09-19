import { describe, expect, it } from "vitest";
import {
  checkDockerfile,
  dedupeIssues,
  hasE2ETests,
  hasPlatformDeployConfig,
} from "./scanner-rules";
import type { IssueInput } from "./scanner-rules";

describe("hasE2ETests", () => {
  it("accepts the playwright package, not just @playwright/test", () => {
    expect(hasE2ETests({ playwright: "^1.61.1" }, [])).toBe(true);
    expect(hasE2ETests({ "@playwright/test": "^1.61.1" }, [])).toBe(true);
  });

  it("accepts other runners", () => {
    expect(hasE2ETests({ cypress: "^13" }, [])).toBe(true);
    expect(hasE2ETests({ webdriverio: "^9" }, [])).toBe(true);
  });

  it("accepts config files and e2e directories when no dependency is declared", () => {
    expect(hasE2ETests({}, ["playwright.config.ts"])).toBe(true);
    expect(hasE2ETests({}, ["cypress.config.js"])).toBe(true);
    expect(hasE2ETests({}, ["e2e/smoke.spec.ts"])).toBe(true);
  });

  it("stays false for a project with no end-to-end setup at all", () => {
    expect(hasE2ETests({ vitest: "^4" }, ["src/app.ts", "vite.config.ts"])).toBe(false);
  });
});

describe("checkDockerfile deployment-aware", () => {
  it("skips when vercel.json present", () => {
    const issues: IssueInput[] = [];
    checkDockerfile(["package.json", "vercel.json", "src/App.tsx"], issues, ["Vercel"]);
    expect(issues).toHaveLength(0);
  });

  it("skips when deploy target is Railway", () => {
    const issues: IssueInput[] = [];
    checkDockerfile(["package.json", "server.ts"], issues, ["Railway"]);
    expect(issues).toHaveLength(0);
  });

  it("flags when no docker and no platform config", () => {
    const issues: IssueInput[] = [];
    checkDockerfile(["package.json", "src/index.ts"], issues, []);
    expect(issues.some((i) => i.fixId === "dockerfile")).toBe(true);
  });

  it("hasPlatformDeployConfig detects netlify.toml", () => {
    expect(hasPlatformDeployConfig(["netlify.toml", "package.json"])).toBe(true);
  });
});

describe("dedupeIssues", () => {
  const issue = (over: Partial<IssueInput> = {}): IssueInput => ({
    category: "Security",
    title: "Something",
    severity: "medium",
    why: "x",
    timeSaved: "1h",
    fixId: "helmet",
    ...over,
  });

  it("keeps one row per fixId, since the UI offers one fix per id", () => {
    const out = dedupeIssues([issue(), issue(), issue({ fixId: "cors" })]);
    expect(out.map((i) => i.fixId)).toEqual(["helmet", "cors"]);
  });

  it("preserves first-appearance order", () => {
    const out = dedupeIssues([issue({ fixId: "a" }), issue({ fixId: "b" }), issue({ fixId: "a" })]);
    expect(out.map((i) => i.fixId)).toEqual(["a", "b"]);
  });

  /**
   * Regression: collisions were dropped outright, so every check that could locate more than one
   * instance of a problem silently reported one — five vulnerable dependencies became one CVE,
   * several unguarded API routes became one route. Those checks sort worst-first, so the surviving
   * row always looked plausible while the count was wrong. Merging keeps one fix per id without
   * throwing away what was found.
   */
  it("merges evidence instead of discarding the collision", () => {
    const out = dedupeIssues([
      issue({ foundEvidence: "GHSA-1 in lodash" }),
      issue({ foundEvidence: "GHSA-2 in axios" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.foundEvidence).toContain("GHSA-1");
    expect(out[0]!.foundEvidence).toContain("GHSA-2");
  });

  it("adopts the worst severity across a collision", () => {
    const out = dedupeIssues([
      issue({ severity: "medium", title: "medium one" }),
      issue({ severity: "critical", title: "critical one" }),
    ]);
    expect(out[0]!.severity).toBe("critical");
    // The headline follows the worst instance, not merely the first seen.
    expect(out[0]!.title).toBe("critical one");
  });

  it("keeps the earlier issue when severities tie", () => {
    const out = dedupeIssues([issue({ title: "first" }), issue({ title: "second" })]);
    expect(out[0]!.title).toBe("first");
  });

  it("unions checkedFor so no disclosure is lost", () => {
    const out = dedupeIssues([
      issue({ checkedFor: ["a", "shared"] }),
      issue({ checkedFor: ["b", "shared"] }),
    ]);
    expect([...out[0]!.checkedFor!].sort()).toEqual(["a", "b", "shared"]);
  });

  it("does not repeat identical evidence", () => {
    const out = dedupeIssues([issue({ foundEvidence: "same" }), issue({ foundEvidence: "same" })]);
    expect(out[0]!.foundEvidence).toBe("same");
  });

  it("passes an empty list through", () => {
    expect(dedupeIssues([])).toEqual([]);
  });
});
