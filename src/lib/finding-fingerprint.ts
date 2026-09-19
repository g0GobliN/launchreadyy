import { createHash } from "node:crypto";
import type { Issue } from "./mock-data";

/** Stable identity across scans — hash(rule id + normalized path hint + key evidence). */
export function findingFingerprint(issue: {
  fixId: string;
  title?: string;
  foundEvidence?: string;
  checkedFor?: string[];
}): string {
  const evidence = (issue.foundEvidence ?? issue.checkedFor?.join("|") ?? issue.title ?? "")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const raw = `${issue.fixId}|${evidence}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export interface FindingDiff {
  resolved: Issue[];
  newFindings: Issue[];
  unchanged: Issue[];
}

export function diffFindingsByFingerprint(prev: Issue[], next: Issue[]): FindingDiff {
  const prevMap = new Map(prev.map((i) => [findingFingerprint(i), i]));
  const nextMap = new Map(next.map((i) => [findingFingerprint(i), i]));

  const resolved: Issue[] = [];
  const newFindings: Issue[] = [];
  const unchanged: Issue[] = [];

  for (const [fp, issue] of prevMap) {
    if (!nextMap.has(fp)) resolved.push(issue);
  }
  for (const [fp, issue] of nextMap) {
    if (!prevMap.has(fp)) newFindings.push(issue);
    else unchanged.push(issue);
  }
  return { resolved, newFindings, unchanged };
}

export interface CategoryTrend {
  category: string;
  currentScore: number;
  previousScore: number | null;
  delta: number | null;
  topImprovement: string | null;
  topRegression: string | null;
  resolved: string[];
  newTitles: string[];
}

export function buildCategoryTrend(
  category: string,
  currentScore: number,
  previousScore: number | null,
  prevIssues: Issue[],
  nextIssues: Issue[],
): CategoryTrend {
  const prevCat = prevIssues.filter((i) => (i.readinessCategory ?? i.category) === category);
  const nextCat = nextIssues.filter((i) => (i.readinessCategory ?? i.category) === category);
  const diff = diffFindingsByFingerprint(prevCat, nextCat);
  return {
    category,
    currentScore,
    previousScore,
    delta: previousScore == null ? null : currentScore - previousScore,
    topImprovement: diff.resolved[0]?.title ?? null,
    topRegression: diff.newFindings[0]?.title ?? null,
    resolved: diff.resolved.map((i) => i.title).slice(0, 5),
    newTitles: diff.newFindings.map((i) => i.title).slice(0, 5),
  };
}
