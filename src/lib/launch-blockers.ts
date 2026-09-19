import type { Issue } from "./mock-data";
import type { LaunchTarget, LaunchTimeline } from "./mock-data";
import { computeVerdict, type LaunchVerdict, type SandboxVerifyStatus } from "./launch-verdict";
import { getWhyItMattersCopy } from "./finding-evidence";
import { confidenceRank } from "./readiness/scorer";

export interface LaunchBlocker extends Issue {
  whyItMatters: string;
}

export function pickTopLaunchBlockers(issues: Issue[], limit = 5): LaunchBlocker[] {
  const riskOrder: Record<string, number> = { blocker: 0, high: 1, medium: 2, low: 3 };
  const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  const sorted = [...issues].sort((a, b) => {
    const ra = riskOrder[a.riskLevel ?? "low"] ?? 3;
    const rb = riskOrder[b.riskLevel ?? "low"] ?? 3;
    if (ra !== rb) return ra - rb;
    const sa = sevOrder[a.severity] ?? 3;
    const sb = sevOrder[b.severity] ?? 3;
    if (sa !== sb) return sa - sb;
    const ca = confidenceRank(a.confidence);
    const cb = confidenceRank(b.confidence);
    if (ca !== cb) return ca - cb;
    return (a.priority ?? 99) - (b.priority ?? 99);
  });

  return sorted.slice(0, limit).map((i) => ({
    ...i,
    whyItMatters: getWhyItMattersCopy(i),
  }));
}

export function pickTop3ForLaunch(
  issues: Issue[],
  context?: { launchTarget?: LaunchTarget | null; launchTimeline?: LaunchTimeline | null },
): Issue[] {
  const riskOrder: Record<string, number> = { blocker: 0, high: 1, medium: 2, low: 3 };
  const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const targetWeights: Record<LaunchTarget, string[]> = {
    enterprise: ["sso", "audit", "rbac", "role"],
    investors: ["readme", "monitoring", "backup", "disaster"],
    product_hunt: ["ci", "monitor", "health"],
    mvp: ["ci", "monitor", "health"],
    startup: [],
    oss: [],
  };
  const weightedKeywords = context?.launchTarget ? (targetWeights[context.launchTarget] ?? []) : [];

  const scored = [...issues].sort((a, b) => {
    const titleA = `${a.title} ${a.fixId}`.toLowerCase();
    const titleB = `${b.title} ${b.fixId}`.toLowerCase();
    const wa = weightedKeywords.some((k) => titleA.includes(k)) ? -1 : 0;
    const wb = weightedKeywords.some((k) => titleB.includes(k)) ? -1 : 0;
    if (wa !== wb) return wa - wb;
    const ra = riskOrder[a.riskLevel ?? "low"] ?? 3;
    const rb = riskOrder[b.riskLevel ?? "low"] ?? 3;
    if (ra !== rb) return ra - rb;
    const sa = sevOrder[a.severity] ?? 3;
    const sb = sevOrder[b.severity] ?? 3;
    if (sa !== sb) return sa - sb;
    return (a.priority ?? 99) - (b.priority ?? 99);
  });

  const criticalPathOnly =
    context?.launchTimeline === "today" || context?.launchTimeline === "this_week";
  const filtered = criticalPathOnly
    ? scored.filter(
        (i) => i.riskLevel === "blocker" || i.severity === "critical" || i.severity === "high",
      )
    : scored;

  return filtered.slice(0, 3);
}

export function launchVerdictForScan(
  score: number,
  issues: Issue[],
  checklistFailed = 0,
  sandboxStatus?: SandboxVerifyStatus | null,
): { verdict: LaunchVerdict; headline: string; summary: string } {
  const blockers = issues.filter((i) => i.riskLevel === "blocker");
  return computeVerdict(score, blockers, checklistFailed, issues, sandboxStatus);
}

export interface PostFixProof {
  currentScore: number;
  projectedScore: number;
  scoreDelta: number;
  blockersCleared: number;
  issuesAddressed: number;
  fixesAddressed: string[];
  manualFollowUps: string[];
}

export function estimatePostFixProof(
  scan: { score: number; issues: Issue[] },
  fixIds: string[],
  verificationNotes?: { fixId: string; status: string; note: string }[],
): PostFixProof {
  const fixSet = new Set(fixIds);
  const addressed = scan.issues.filter((i) => fixSet.has(i.fixId));

  let boost = 0;
  for (const i of addressed) {
    if (i.riskLevel === "blocker") boost += 10;
    else if (i.riskLevel === "high" || i.severity === "critical") boost += 6;
    else if (i.riskLevel === "medium" || i.severity === "high") boost += 3;
    else boost += 1;
  }

  const projectedScore = Math.min(100, scan.score + boost);
  const blockersCleared = addressed.filter((i) => i.riskLevel === "blocker").length;

  const manualFollowUps = scan.issues
    .filter((i) => !fixSet.has(i.fixId) && (i.autoFixable === false || i.riskLevel === "blocker"))
    .map((i) => i.title);

  const verificationWarnings = (verificationNotes ?? [])
    .filter((n) => n.status === "warning")
    .map((n) => n.note);

  return {
    currentScore: scan.score,
    projectedScore,
    scoreDelta: projectedScore - scan.score,
    blockersCleared,
    issuesAddressed: addressed.length,
    fixesAddressed: addressed.map((i) => i.title),
    manualFollowUps: [...new Set([...manualFollowUps, ...verificationWarnings])].slice(0, 6),
  };
}
