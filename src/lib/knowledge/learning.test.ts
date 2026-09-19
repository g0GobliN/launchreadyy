import { describe, expect, it } from "vitest";
import {
  applyLearning,
  fingerprintFinding,
  type LearnableFinding,
  type LearnedSignal,
} from "./learning";

const finding = (over: Partial<LearnableFinding> = {}): LearnableFinding => ({
  category: "Security",
  title: "Missing rate limiting",
  fixId: "rate-limit",
  severity: "medium",
  file: "src/api/index.ts",
  ...over,
});

describe("fingerprintFinding", () => {
  it("is stable across identical findings and distinct across different ones", () => {
    expect(fingerprintFinding(finding())).toBe(fingerprintFinding(finding()));
    expect(fingerprintFinding(finding())).not.toBe(fingerprintFinding(finding({ fixId: "cors" })));
  });

  it("ignores severity (severity is compared separately, not part of identity)", () => {
    expect(fingerprintFinding(finding({ severity: "low" }))).toBe(
      fingerprintFinding(finding({ severity: "high" })),
    );
  });
});

describe("applyLearning", () => {
  it("suppresses a dismissed finding, preserving reason", () => {
    const f = finding();
    const signals: LearnedSignal[] = [
      { fingerprint: fingerprintFinding(f), action: "dismissed", severityAtAction: "medium" },
    ];
    const { visible, suppressed } = applyLearning([f], signals);
    expect(visible).toEqual([]);
    expect(suppressed).toEqual([{ finding: f, reason: "dismissed" }]);
  });

  it("labels accepted-risk suppressions distinctly", () => {
    const f = finding();
    const { suppressed } = applyLearning(
      [f],
      [{ fingerprint: fingerprintFinding(f), action: "accepted", severityAtAction: "medium" }],
    );
    expect(suppressed[0].reason).toBe("accepted-risk");
  });

  it("GUARDRAIL: severity escalation overrides a prior dismissal (re-surfaces)", () => {
    const dismissedAt = finding({ severity: "medium" });
    const nowCritical = finding({ severity: "critical" });
    const signals: LearnedSignal[] = [
      {
        fingerprint: fingerprintFinding(dismissedAt),
        action: "dismissed",
        severityAtAction: "medium",
      },
    ];
    const { visible, suppressed } = applyLearning([nowCritical], signals);
    expect(visible).toEqual([nowCritical]);
    expect(suppressed).toEqual([]);
  });

  it("still suppresses when severity is unchanged or lower than when acted on", () => {
    const f = finding({ severity: "low" });
    const { visible } = applyLearning(
      [f],
      [{ fingerprint: fingerprintFinding(f), action: "ignored", severityAtAction: "medium" }],
    );
    expect(visible).toEqual([]);
  });

  it("leaves unlearned findings visible in input order", () => {
    const a = finding({ fixId: "a", title: "A" });
    const b = finding({ fixId: "b", title: "B" });
    const { visible } = applyLearning(
      [a, b],
      [{ fingerprint: fingerprintFinding(a), action: "dismissed", severityAtAction: "medium" }],
    );
    expect(visible).toEqual([b]);
  });
});
