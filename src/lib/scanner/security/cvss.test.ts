import { describe, expect, it } from "vitest";
import { cvssV3BaseScore, numericScoreFrom } from "./cvss";

/**
 * Vectors with scores published by FIRST/NVD, so these assert against the specification rather
 * than against this implementation's own output.
 */
describe("cvssV3BaseScore", () => {
  it.each([
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H", 7.5],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", 7.5],
    ["CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", 7.8],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N", 6.1],
    // exploitability 8.22·0.85·0.44·0.27·0.62 = 0.5146, impact 6.42·0.22 = 1.4124 → 1.927 → 2.0
    ["CVSS:3.1/AV:N/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N", 2.0],
    ["CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8],
  ])("scores %s as %s", (vector, expected) => {
    expect(cvssV3BaseScore(vector)).toBeCloseTo(expected, 1);
  });

  it("returns 0 when there is no impact", () => {
    expect(cvssV3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N")).toBe(0);
  });

  it("rejects a v4 vector rather than mis-scoring it with v3 weights", () => {
    expect(cvssV3BaseScore("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H")).toBeNull();
  });

  it("rejects vectors missing a base metric", () => {
    expect(cvssV3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H")).toBeNull();
    expect(cvssV3BaseScore("not a vector")).toBeNull();
  });
});

describe("numericScoreFrom", () => {
  /**
   * Regression: OSV's `severity[].score` is a vector string, so the previous parseFloat always
   * produced NaN. Every comparison against it was false, so the advisory graded as "low" and the
   * caller dropped it — a 9.8 critical disappeared silently.
   */
  it("reads a CVSS vector, which is what OSV actually sends", () => {
    expect(numericScoreFrom("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBeCloseTo(9.8, 1);
    expect(parseFloat("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBeNaN();
  });

  it("still accepts a bare numeric score", () => {
    expect(numericScoreFrom("7.5")).toBe(7.5);
    expect(numericScoreFrom("10")).toBe(10);
    expect(numericScoreFrom("0")).toBe(0);
  });

  it("rejects nonsense and out-of-range numbers", () => {
    expect(numericScoreFrom("11")).toBeNull();
    expect(numericScoreFrom("")).toBeNull();
    expect(numericScoreFrom(undefined)).toBeNull();
  });
});
