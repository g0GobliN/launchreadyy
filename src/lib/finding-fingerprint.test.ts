import { describe, expect, it } from "vitest";
import {
  buildCategoryTrend,
  diffFindingsByFingerprint,
  findingFingerprint,
} from "./finding-fingerprint";
import type { Issue } from "./mock-data";

const issue = (overrides: Partial<Issue> & Pick<Issue, "id" | "fixId" | "title">): Issue => ({
  category: "Security",
  severity: "high",
  why: "x",
  timeSaved: "1h",
  ...overrides,
});

describe("findingFingerprint", () => {
  it("is stable for same fixId + evidence", () => {
    const a = findingFingerprint({
      fixId: "security-hardcoded-secret",
      foundEvidence: "Found: key in a.ts:1",
    });
    const b = findingFingerprint({
      fixId: "security-hardcoded-secret",
      foundEvidence: "Found: key in a.ts:1",
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(24);
  });

  it("normalizes digits so line numbers don't thrash identity", () => {
    const a = findingFingerprint({ fixId: "x", foundEvidence: "line 12" });
    const b = findingFingerprint({ fixId: "x", foundEvidence: "line 99" });
    expect(a).toBe(b);
  });
});

describe("diffFindingsByFingerprint", () => {
  it("classifies resolved and new", () => {
    const prev = [issue({ id: "1", fixId: "a", title: "Old", foundEvidence: "old" })];
    const next = [issue({ id: "2", fixId: "b", title: "New", foundEvidence: "new" })];
    const diff = diffFindingsByFingerprint(prev, next);
    expect(diff.resolved).toHaveLength(1);
    expect(diff.newFindings).toHaveLength(1);
  });
});

describe("buildCategoryTrend", () => {
  it("computes delta and improvement labels", () => {
    const prev = [
      issue({
        id: "1",
        fixId: "secret",
        title: "Secret removed later",
        foundEvidence: "s",
        readinessCategory: "Security",
      }),
    ];
    const next = [
      issue({
        id: "2",
        fixId: "cors",
        title: "New CORS issue",
        foundEvidence: "c",
        readinessCategory: "Security",
      }),
    ];
    const trend = buildCategoryTrend("Security", 90, 80, prev, next);
    expect(trend.delta).toBe(10);
    expect(trend.topImprovement).toContain("Secret");
    expect(trend.topRegression).toContain("CORS");
  });
});
