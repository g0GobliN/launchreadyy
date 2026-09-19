import { describe, expect, it } from "vitest";
import { defaultFixBranchName, sanitizeFixBranchName } from "./fix-branch";

describe("defaultFixBranchName", () => {
  it("uses a readable date-based name", () => {
    expect(defaultFixBranchName(new Date("2026-06-12T12:00:00Z"))).toBe(
      "launchreadyy-production-ready-2026-06-12",
    );
  });
});

describe("sanitizeFixBranchName", () => {
  it("accepts logical hyphenated names", () => {
    expect(sanitizeFixBranchName("launchreadyy-production-ready-2026-06-12")).toBe(
      "launchreadyy-production-ready-2026-06-12",
    );
  });

  it("trims whitespace", () => {
    expect(sanitizeFixBranchName("  my-branch  ")).toBe("my-branch");
  });

  it("rejects empty or invalid names", () => {
    expect(() => sanitizeFixBranchName("")).toThrow(/Invalid branch name/);
    expect(() => sanitizeFixBranchName("bad branch")).toThrow(/Invalid branch name/);
    expect(() => sanitizeFixBranchName("a//b")).toThrow(/Invalid branch name/);
  });
});
