import { describe, expect, it } from "vitest";
import {
  estimatePostFixProof,
  launchVerdictForScan,
  pickTop3ForLaunch,
  pickTopLaunchBlockers,
} from "./launch-blockers";
import type { Issue } from "./mock-data";

const issue = (overrides: Partial<Issue> & Pick<Issue, "id" | "fixId" | "title">): Issue => ({
  category: "Security",
  severity: "high",
  why: "Evidence line",
  timeSaved: "1h",
  riskLevel: "high",
  priority: 3,
  ...overrides,
});

describe("pickTopLaunchBlockers", () => {
  it("prioritizes blockers and critical findings", () => {
    const issues: Issue[] = [
      issue({ id: "1", fixId: "readme", title: "Readme", severity: "low", priority: 9 }),
      issue({
        id: "2",
        fixId: "auditor-stripe-webhook",
        title: "Stripe webhook",
        severity: "critical",
        riskLevel: "blocker",
        priority: 1,
        businessImpact: "Payment fraud — fake events could grant access without payment.",
      }),
      issue({ id: "3", fixId: "eslint", title: "ESLint", severity: "medium", priority: 5 }),
    ];
    const top = pickTopLaunchBlockers(issues, 2);
    expect(top[0]?.fixId).toBe("auditor-stripe-webhook");
    expect(top[0]?.whyItMatters).toContain("Payment fraud");
  });
});

describe("estimatePostFixProof", () => {
  it("projects score lift for addressed fixes", () => {
    const scan = {
      score: 42,
      issues: [
        issue({ id: "1", fixId: "ci-ai", title: "CI", riskLevel: "high" }),
        issue({
          id: "2",
          fixId: "auditor-stripe-webhook",
          title: "Webhook",
          riskLevel: "blocker",
          autoFixable: true,
        }),
      ],
    };
    const proof = estimatePostFixProof(scan, ["ci-ai"]);
    expect(proof.projectedScore).toBeGreaterThan(scan.score);
    expect(proof.manualFollowUps.some((t) => t.includes("Webhook"))).toBe(true);

    const webhookProof = estimatePostFixProof(scan, ["auditor-stripe-webhook"]);
    expect(webhookProof.manualFollowUps.some((t) => t.includes("Webhook"))).toBe(false);
  });
});

describe("launchVerdictForScan security rules", () => {
  it("caps ready at conditional when a high security issue remains", () => {
    const v = launchVerdictForScan(90, [
      issue({
        id: "1",
        fixId: "security-secret-heuristic",
        title: "Possible hardcoded credentials",
        severity: "high",
        riskLevel: "high",
        readinessCategory: "Security",
      }),
    ]);
    expect(v.verdict).toBe("conditional");
    expect(v.headline).toBe("Ready with warnings");
  });

  it("names the security blocker in the not_ready headline", () => {
    const v = launchVerdictForScan(90, [
      issue({
        id: "1",
        fixId: "security-hardcoded-secret",
        title: "Hardcoded API keys in source code",
        severity: "critical",
        riskLevel: "blocker",
        readinessCategory: "Security",
      }),
    ]);
    expect(v.verdict).toBe("not_ready");
    expect(v.headline).toContain("Hardcoded API keys");
  });

  it("returns ready for a clean high score", () => {
    const v = launchVerdictForScan(90, [
      issue({
        id: "1",
        fixId: "prettier",
        title: "Prettier",
        category: "Maintainability",
        severity: "low",
        riskLevel: "low",
      }),
    ]);
    expect(v.verdict).toBe("ready");
  });
});

describe("pickTop3ForLaunch", () => {
  it("boosts target-specific priorities for product hunt launches", () => {
    const issues: Issue[] = [
      issue({ id: "1", fixId: "readme", title: "Readme polish", severity: "high", priority: 1 }),
      issue({
        id: "2",
        fixId: "monitoring",
        title: "No monitoring",
        severity: "high",
        priority: 3,
      }),
      issue({
        id: "3",
        fixId: "health-check",
        title: "No health check",
        severity: "high",
        priority: 4,
      }),
      issue({ id: "4", fixId: "eslint", title: "ESLint", severity: "medium", priority: 2 }),
    ];
    const top = pickTop3ForLaunch(issues, {
      launchTarget: "product_hunt",
      launchTimeline: "today",
    });
    expect(top).toHaveLength(3);
    expect(top.some((i) => i.fixId === "monitoring")).toBe(true);
    expect(top.some((i) => i.fixId === "health-check")).toBe(true);
  });
});
