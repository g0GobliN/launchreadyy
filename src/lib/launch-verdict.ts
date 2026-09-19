import type { Issue } from "./mock-data";
import { SEVERITY_PENALTY } from "./readiness/categories";

export type LaunchVerdict = "ready" | "conditional" | "not_ready";
export type SandboxVerifyStatus = "queued" | "running" | "passed" | "failed" | "skipped";

function isSecurityIssue(issue: Issue): boolean {
  return (issue.readinessCategory ?? issue.category) === "Security";
}

/** Security category score via the shared severity-penalty mechanism — start at 100, floor at 0. */
export function securityCategoryScore(issues: Issue[]): number {
  const penalty = issues
    .filter(isSecurityIssue)
    .reduce((sum, i) => sum + (SEVERITY_PENALTY[i.severity] ?? 5), 0);
  return Math.max(0, 100 - Math.min(100, penalty));
}

export function computeVerdict(
  score: number,
  blockers: Issue[],
  checklistFailed: number,
  allIssues?: Issue[],
  sandboxStatus?: SandboxVerifyStatus | null,
): { verdict: LaunchVerdict; headline: string; summary: string } {
  // A failed or still-running sandbox means we don't actually know the app installs or
  // builds — no score or blocker count can outrank that. The interactive dashboard pages
  // already gate on this client-side (repo.$repoId.index.tsx's "sandbox-first" redirect),
  // but computeVerdict is also used by the *shareable* Launch Report, which has no such
  // gate — without this, a repo whose sandbox build genuinely fails could still produce a
  // public "Launch ready" report handed to an investor or client.
  if (sandboxStatus === "failed") {
    return {
      verdict: "not_ready",
      headline: "Not ready: sandbox verification failed",
      summary:
        "The app failed to install or build in an isolated sandbox — that must be fixed before anyone can rely on this in production.",
    };
  }
  if (sandboxStatus === "queued" || sandboxStatus === "running") {
    return {
      verdict: "conditional",
      headline: "Sandbox verification in progress",
      summary:
        "The app hasn't finished verifying in an isolated sandbox yet — this reflects the last known state, not a confirmed result.",
    };
  }

  const securityBlocker = blockers.find(isSecurityIssue);

  if (blockers.length > 0 || score < 50) {
    return {
      verdict: "not_ready",
      // A security blocker is hard evidence (critical + high confidence) — name it directly.
      headline: securityBlocker ? `Not ready: ${securityBlocker.title}` : "Not ready to launch",
      summary:
        blockers.length > 0
          ? `${blockers.length} launch blocker${blockers.length > 1 ? "s" : ""} must be resolved before users, customers, or investors rely on this product in production.`
          : "Launch readiness score is below the minimum safe threshold. Critical production gaps remain.",
    };
  }
  if (score < 75 || checklistFailed > 0) {
    return {
      verdict: "conditional",
      headline: "Ready with conditions",
      summary:
        "The app can demo, but production handoff should wait until remaining high-impact gaps are closed.",
    };
  }

  // Security caps on an otherwise-ready verdict: remaining high-severity security issues, or a
  // security category score below 50, hold the verdict at "conditional" — never "ready".
  if (allIssues) {
    const securityIssues = allIssues.filter(isSecurityIssue);
    const highSecurity = securityIssues.filter(
      (i) => i.severity === "critical" || i.severity === "high",
    );
    if (highSecurity.length > 0 || securityCategoryScore(allIssues) < 50) {
      return {
        verdict: "conditional",
        headline: "Ready with warnings",
        summary:
          highSecurity.length > 0
            ? `${highSecurity.length} security issue${highSecurity.length > 1 ? "s" : ""} should be resolved before production traffic: ${highSecurity[0]!.title}${highSecurity.length > 1 ? ", …" : ""}`
            : "The Production Security score is below the safe threshold — review the security findings before launch.",
      };
    }
  }

  return {
    verdict: "ready",
    headline: "Launch ready",
    summary:
      "No critical blockers detected. Remaining items are improvements, not launch stoppers.",
  };
}
