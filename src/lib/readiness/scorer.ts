import {
  READINESS_CATEGORIES,
  type CategoryScore,
  type ReadinessFinding,
  type ReadinessScoreResult,
} from "./types";
import { SEVERITY_PENALTY } from "./categories";

export function scoreCategory(
  findings: ReadinessFinding[],
  category: ReadinessFinding["readinessCategory"],
): CategoryScore {
  const inCat = findings.filter((f) => f.readinessCategory === category);
  const penalty = inCat.reduce((sum, f) => sum + (SEVERITY_PENALTY[f.severity] ?? 5), 0);
  const blockerCount = inCat.filter((f) => f.riskLevel === "blocker").length;
  return {
    category,
    score: Math.max(0, 100 - Math.min(100, penalty)),
    issueCount: inCat.length,
    blockerCount,
  };
}

export function computeReadinessScore(findings: ReadinessFinding[]): ReadinessScoreResult {
  const categoryScores = READINESS_CATEGORIES.map((cat) => scoreCategory(findings, cat));

  // Averaging 12 per-category scores let clean/inapplicable categories (Docs, Performance, DB
  // safety on a repo with no DB...) drown out real problems — a repo with 6 unresolved
  // "fix before launch" issues could still land at 90+ because half the categories defaulted
  // to a perfect 100 for having nothing to say. Score directly off issue counts instead, using
  // the same blocker/fix-before-launch/can-wait split already shown in the UI, so the headline
  // number can't be inflated by categories the repo doesn't even touch.
  const { blockers, fixBeforeLaunch, canWait } = partitionFindings(findings);
  // Weights tuned against 12 real cloned repos across languages: -12/-3 bottomed out most
  // repos with 5+ everyday issues (missing CI, no tests, no docs) at the same floor value,
  // erasing differentiation between a repo with 5 gaps and one with 8. -8/-2 spreads that
  // same real-world range (1-8 fix-before-launch issues) across roughly 40-90 instead.
  const raw = 100 - fixBeforeLaunch.length * 8 - canWait.length * 2;

  // A repo with an unresolved blocker (leaked secret, unverified webhook) must never score
  // higher than a repo without one — no matter how many smaller issues that other repo has.
  // So the two cases get non-overlapping bands: blocker repos are confined to [0, 39], everyone
  // else to [40, 100]. Without this split, enough medium/low issues could drag a repo with zero
  // blockers below the cap meant to mark blockers as the worst case.
  const overallScore =
    blockers.length > 0 ? Math.max(0, Math.min(raw, 39)) : Math.max(40, Math.min(raw, 100));

  return { overallScore, categoryScores };
}

/** Low-confidence findings sink to the bottom of their severity band — they need manual review. */
export function confidenceRank(confidence?: string): number {
  return confidence === "low" ? 1 : 0;
}

/** Sort findings: blockers first, low-confidence last within each band, then by priority. */
export function sortByPriority(findings: ReadinessFinding[]): ReadinessFinding[] {
  const riskOrder = { blocker: 0, high: 1, medium: 2, low: 3 };
  return [...findings].sort((a, b) => {
    const rd = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (rd !== 0) return rd;
    const cd = confidenceRank(a.confidence) - confidenceRank(b.confidence);
    if (cd !== 0) return cd;
    return a.priority - b.priority;
  });
}

export function partitionFindings(findings: ReadinessFinding[]) {
  const blockers = findings.filter((f) => f.riskLevel === "blocker");
  const fixBeforeLaunch = findings.filter(
    (f) => f.riskLevel === "high" || (f.riskLevel === "medium" && f.priority <= 5),
  );
  const canWait = findings.filter((f) => !blockers.includes(f) && !fixBeforeLaunch.includes(f));
  return { blockers, fixBeforeLaunch, canWait };
}
