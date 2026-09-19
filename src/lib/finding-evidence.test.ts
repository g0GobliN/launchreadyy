import { describe, expect, it } from "vitest";
import { getCheckedForCopy, getDetectionCopy, isSandboxVerified } from "./finding-evidence";
import type { Issue } from "./mock-data";

function baseIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "i1",
    category: "Deployment",
    title: "build failed",
    severity: "high",
    why: "build failed",
    timeSaved: "30m",
    fixId: "sandbox-build",
    ...overrides,
  };
}

describe("isSandboxVerified", () => {
  it("is false when detection is unset", () => {
    expect(isSandboxVerified(baseIssue())).toBe(false);
  });

  it("is false for a static guess (rule-based/framework-aware/ai-assisted)", () => {
    expect(isSandboxVerified(baseIssue({ detection: ["rule-based"] }))).toBe(false);
    expect(isSandboxVerified(baseIssue({ detection: ["framework-aware", "ai-assisted"] }))).toBe(
      false,
    );
  });

  it("is true only when detection includes sandbox-verified", () => {
    expect(isSandboxVerified(baseIssue({ detection: ["sandbox-verified"] }))).toBe(true);
  });
});

describe("getDetectionCopy", () => {
  it("labels sandbox-verified distinctly from static detection methods", () => {
    expect(getDetectionCopy(baseIssue({ detection: ["sandbox-verified"] }))).toBe(
      "Verified in sandbox",
    );
    expect(getDetectionCopy(baseIssue({ detection: ["rule-based"] }))).toBe("Rule-based");
  });
});

describe("getCheckedForCopy", () => {
  it("includes both evidence and looked-for when both exist", () => {
    expect(
      getCheckedForCopy(
        baseIssue({
          foundEvidence: "HTTP responded 200 without an https:// Location.",
          checkedFor: ["GET http://example.com (redirect manual)"],
        }),
      ),
    ).toBe(
      "HTTP responded 200 without an https:// Location. Looked for: GET http://example.com (redirect manual).",
    );
  });

  it("falls back to checked-only copy", () => {
    expect(getCheckedForCopy(baseIssue({ checkedFor: ["Strict-Transport-Security"] }))).toBe(
      "Checked: Strict-Transport-Security. None found.",
    );
  });
});
