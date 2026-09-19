import { describe, expect, it } from "vitest";
import { buildLaunchReportData, computeVerdict } from "./launch-report.server";

describe("computeVerdict", () => {
  it("returns not_ready when blockers exist", () => {
    const v = computeVerdict(80, [{ id: "1" } as never], 0);
    expect(v.verdict).toBe("not_ready");
  });

  it("returns ready for high score without blockers", () => {
    const v = computeVerdict(82, [], 0);
    expect(v.verdict).toBe("ready");
  });
});

describe("buildLaunchReportData", () => {
  it("builds investor-facing report payload", () => {
    const data = buildLaunchReportData({
      repo: {
        name: "my-app",
        full_name: "acme/my-app",
        framework: "Next.js",
        language: "TypeScript",
        private: false,
        description: "Demo app",
      },
      scan: {
        score: 62,
        created_at: new Date().toISOString(),
        category_scores: [{ category: "Security", score: 55, issueCount: 2, blockerCount: 1 }],
        checklist: [{ id: "ci", label: "CI", status: "fail", stackSpecific: false }],
        stack_detected: {
          profile: "Next.js + Stripe",
          frameworks: ["Next.js"],
          services: ["Stripe"],
          deployTargets: ["Vercel"],
        },
      },
      issueRows: [
        {
          id: "1",
          category: "Security",
          title: "Stripe webhook unsigned",
          severity: "critical",
          why: "x",
          time_saved: "2h",
          fix_id: "auditor-stripe-webhook",
          risk_level: "blocker",
          business_impact: "Fake payments",
          production_scenario: "Fraud",
          priority: 1,
        },
      ],
      previousScore: 48,
      completedFixCount: 2,
    });

    expect(data.verdict).toBe("not_ready");
    expect(data.blockers).toHaveLength(1);
    expect(data.previousScore).toBe(48);
    expect(data.disclaimer).toContain("not a penetration test");
  });
});
