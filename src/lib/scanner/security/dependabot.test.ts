import { describe, expect, it, vi } from "vitest";
import { checkDependabotAlerts } from "./dependabot";
import { dedupeIssues, type IssueInput } from "../../scanner-rules";

const OPTS = { token: "t", owner: "acme", repo: "app" };

function alertsReturning(alerts: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => alerts,
  }) as unknown as typeof fetch;
}

function alert(pkg: string, severity: string, number = 1) {
  return {
    number,
    html_url: `https://github.com/acme/app/security/dependabot/${number}`,
    dependency: { package: { name: pkg } },
    security_advisory: { ghsa_id: `GHSA-${pkg}`, severity, summary: `Vulnerability in ${pkg}` },
  };
}

describe("checkDependabotAlerts", () => {
  it("reports a single open alert", async () => {
    const issues: IssueInput[] = [];
    await checkDependabotAlerts(OPTS, issues, alertsReturning([alert("lodash", "high")]));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.title).toBe("Dependabot: lodash (GHSA-lodash)");
    expect(issues[0]!.severity).toBe("high");
  });

  /**
   * Regression: one issue was pushed per alert, all under the `dependabot-alert` fixId, and
   * dedupeIssues in the scan keeps only the first issue per fixId — so a repo with several open
   * alerts reported one and silently dropped the rest.
   */
  it("reports every open alert in one finding that survives dedupe", async () => {
    const issues: IssueInput[] = [];
    await checkDependabotAlerts(
      OPTS,
      issues,
      alertsReturning([
        alert("lodash", "high", 1),
        alert("axios", "critical", 2),
        alert("express", "medium", 3),
      ]),
    );

    expect(issues).toHaveLength(1);
    expect(dedupeIssues(issues)).toHaveLength(1);
    expect(issues[0]!.title).toContain("3 open vulnerability alerts");
    for (const pkg of ["lodash", "axios", "express"]) {
      expect(issues[0]!.foundEvidence).toContain(`GHSA-${pkg}`);
    }
  });

  /** Upstream "critical" is capped to high by mapSeverity — this rule never claims Critical. */
  it("takes the worst severity across the alerts", async () => {
    const issues: IssueInput[] = [];
    await checkDependabotAlerts(
      OPTS,
      issues,
      alertsReturning([alert("a", "medium", 1), alert("b", "critical", 2)]),
    );
    expect(issues[0]!.severity).toBe("high");

    const mediumOnly: IssueInput[] = [];
    await checkDependabotAlerts(
      OPTS,
      mediumOnly,
      alertsReturning([alert("a", "medium", 1), alert("b", "medium", 2)]),
    );
    expect(mediumOnly[0]!.severity).toBe("medium");
  });

  it("drops low-severity alerts and stays quiet when only those exist", async () => {
    const issues: IssueInput[] = [];
    await checkDependabotAlerts(OPTS, issues, alertsReturning([alert("a", "low", 1)]));
    expect(issues).toHaveLength(0);
  });

  it("soft-fails when the alerts API is unavailable", async () => {
    const issues: IssueInput[] = [];
    const forbidden = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    await checkDependabotAlerts(OPTS, issues, forbidden as unknown as typeof fetch);
    expect(issues).toHaveLength(0);
  });
});
