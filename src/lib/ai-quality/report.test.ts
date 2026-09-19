import { describe, expect, it } from "vitest";
import { formatReport, summarise, type Attempt } from "./report";

const pass = (repo: string, fixId: string): Attempt => ({
  repo,
  fixId,
  outcome: { status: "passed" },
});
const fail = (repo: string, fixId: string, category = "source"): Attempt => ({
  repo,
  fixId,
  outcome: { status: "failed", category },
});
const skip = (repo: string, fixId: string, detail = "no provider"): Attempt => ({
  repo,
  fixId,
  outcome: { status: "skipped", detail },
});

describe("summarise", () => {
  it("rates against conclusive attempts only", () => {
    // 2 passed, 1 failed, 3 inconclusive → 2/3, not 2/6. Counting a sandbox that never ran as a
    // model failure would make the published number track harness flakiness instead of quality.
    const s = summarise([
      pass("a", "ci-ai"),
      pass("b", "ci-ai"),
      fail("c", "ci-ai"),
      skip("d", "ci-ai"),
      { repo: "e", fixId: "ci-ai", outcome: { status: "error", detail: "boom" } },
      {
        repo: "f",
        fixId: "ci-ai",
        outcome: { status: "no_output", detail: "model returned none" },
      },
    ]);
    expect(s.attempts).toBe(6);
    expect(s.passed).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.inconclusive).toBe(3);
    expect(s.passRate).toBeCloseTo(2 / 3);
  });

  it("reports null — not zero — when nothing conclusive ran", () => {
    // 0 would render as "0%", i.e. "every patch failed", which is the opposite of "we learned
    // nothing". This distinction is the whole reason the field is nullable.
    const s = summarise([skip("a", "ci-ai"), skip("b", "vitest-ai")]);
    expect(s.passRate).toBeNull();
    expect(s.byFix.every((f) => f.passRate === null)).toBe(true);
  });

  it("is empty-safe", () => {
    const s = summarise([]);
    expect(s).toMatchObject({ attempts: 0, passed: 0, failed: 0, passRate: null });
    expect(s.byFix).toEqual([]);
  });

  it("breaks down per fix, sorted by id", () => {
    const s = summarise([
      pass("a", "vitest-ai"),
      fail("a", "ci-ai"),
      pass("b", "ci-ai"),
      skip("c", "ci-ai"),
    ]);
    expect(s.byFix.map((f) => f.fixId)).toEqual(["ci-ai", "vitest-ai"]);
    expect(s.byFix[0]).toMatchObject({ fixId: "ci-ai", passed: 1, failed: 1, inconclusive: 1 });
    expect(s.byFix[0]!.passRate).toBeCloseTo(0.5);
    expect(s.byFix[1]!.passRate).toBe(1);
  });

  it("ranks failure categories by frequency, ties alphabetical", () => {
    const s = summarise([
      fail("a", "ci-ai", "source"),
      fail("b", "ci-ai", "source"),
      fail("c", "ci-ai", "dependency"),
      fail("d", "ci-ai", "env"),
    ]);
    expect(s.failureCategories).toEqual([
      { category: "source", count: 2 },
      { category: "dependency", count: 1 },
      { category: "env", count: 1 },
    ]);
  });

  it("keeps inconclusive reasons visible so an empty run cannot look clean", () => {
    const s = summarise([skip("a", "ci-ai", "no provider"), skip("b", "ci-ai", "no provider")]);
    expect(s.inconclusiveReasons).toEqual([{ reason: "skipped: no provider", count: 2 }]);
  });
});

describe("formatReport", () => {
  it("leads with the caveat, not the number", () => {
    const text = formatReport(summarise([pass("a", "ci-ai")]));
    expect(text).toContain("lower bound on correctness");
    expect(text).toContain("100%");
  });

  it("says plainly when the run measured nothing", () => {
    const text = formatReport(summarise([skip("a", "ci-ai")]));
    expect(text).toContain("Nothing conclusive ran");
    expect(text).toContain("n/a");
    expect(text).not.toContain(" 0%");
  });

  it("shows the inconclusive count alongside the rate", () => {
    const text = formatReport(summarise([pass("a", "ci-ai"), skip("b", "ci-ai")]));
    expect(text).toContain("inconclusive 1");
  });
});
