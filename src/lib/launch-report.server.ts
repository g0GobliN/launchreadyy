import type { CategoryScore, DetectedStack, Issue, LaunchChecklistItem } from "./mock-data";
import { checklistSummary } from "./readiness/checklist";
import { isAutoFixableFixId } from "./readiness/enrich-finding";
import { computeVerdict, type LaunchVerdict } from "./launch-verdict";

export type { LaunchVerdict };

export interface LaunchReportData {
  verdict: LaunchVerdict;
  verdictHeadline: string;
  verdictSummary: string;
  repo: {
    name: string;
    fullName: string;
    framework: string;
    language: string;
    private: boolean;
    description: string | null;
  };
  score: number;
  previousScore: number | null;
  scannedAt: string;
  blockers: Issue[];
  fixBeforeLaunch: Issue[];
  checklist: LaunchChecklistItem[];
  checklistStats: { total: number; passed: number; failed: number; warn: number };
  categoryScores: CategoryScore[];
  stackDetected: DetectedStack | null;
  completedFixCount: number;
  disclaimer: string;
}

function mapDbIssue(row: {
  id: string;
  category: string;
  title: string;
  severity: string;
  why: string;
  time_saved: string;
  fix_id: string;
  risk_level?: string | null;
  business_impact?: string | null;
  production_scenario?: string | null;
  affected_audience?: string | null;
  fix_difficulty?: string | null;
  priority?: number | null;
  auto_fixable?: boolean | null;
  source?: string | null;
  readiness_category?: string | null;
  checked_for?: string[] | null;
  found_evidence?: string | null;
}): Issue {
  return {
    id: row.id,
    category: row.readiness_category ?? row.category,
    title: row.title,
    severity: row.severity as Issue["severity"],
    why: row.why,
    timeSaved: row.time_saved,
    fixId: row.fix_id,
    riskLevel: (row.risk_level as Issue["riskLevel"]) ?? undefined,
    businessImpact: row.business_impact ?? undefined,
    productionScenario: row.production_scenario ?? undefined,
    affectedAudience: (row.affected_audience as Issue["affectedAudience"]) ?? undefined,
    fixDifficulty: (row.fix_difficulty as Issue["fixDifficulty"]) ?? undefined,
    priority: row.priority ?? undefined,
    autoFixable: isAutoFixableFixId(row.fix_id),
    source: (row.source as Issue["source"]) ?? undefined,
    readinessCategory: row.readiness_category ?? undefined,
    checkedFor: row.checked_for ?? undefined,
    foundEvidence: row.found_evidence ?? undefined,
  };
}

export { computeVerdict } from "./launch-verdict";

export function buildLaunchReportData(opts: {
  repo: {
    name: string;
    full_name: string;
    framework: string;
    language: string;
    private: boolean;
    description: string | null;
  };
  scan: {
    score: number;
    created_at: string;
    category_scores?: CategoryScore[] | null;
    checklist?: Array<{ status: string; [key: string]: unknown }> | null;
    stack_detected?: DetectedStack | null;
  };
  issueRows: Array<Parameters<typeof mapDbIssue>[0]>;
  previousScore?: number | null;
  completedFixCount?: number;
  sandboxStatus?: "queued" | "running" | "passed" | "failed" | "skipped" | null;
}): LaunchReportData {
  const issues = opts.issueRows
    .map(mapDbIssue)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const blockers = issues.filter((i) => i.riskLevel === "blocker");
  const fixBeforeLaunch = issues
    .filter((i) => i.riskLevel === "high" || (i.riskLevel === "medium" && (i.priority ?? 99) <= 5))
    .filter((i) => !blockers.includes(i));

  const checklist = (opts.scan.checklist as LaunchChecklistItem[] | null) ?? [];
  const stats = checklistSummary(checklist);
  const { verdict, headline, summary } = computeVerdict(
    opts.scan.score,
    blockers,
    stats.failed,
    issues,
    opts.sandboxStatus,
  );

  return {
    verdict,
    verdictHeadline: headline,
    verdictSummary: summary,
    repo: {
      name: opts.repo.name,
      fullName: opts.repo.full_name,
      framework: opts.repo.framework,
      language: opts.repo.language,
      private: opts.repo.private,
      description: opts.repo.description,
    },
    score: opts.scan.score,
    previousScore: opts.previousScore ?? null,
    scannedAt: opts.scan.created_at,
    blockers,
    fixBeforeLaunch: fixBeforeLaunch.slice(0, 8),
    checklist,
    checklistStats: stats,
    categoryScores: (opts.scan.category_scores as CategoryScore[] | null) ?? [],
    stackDetected: (opts.scan.stack_detected as DetectedStack | null) ?? null,
    completedFixCount: opts.completedFixCount ?? 0,
    disclaimer:
      "This report reflects automated repository analysis at scan time, including Production Security findings with evidence and confidence. It is not a penetration test, compliance certification, or guarantee of production safety. Validate critical flows manually before launch.",
  };
}

export function publicReportUrl(token: string, origin?: string): string {
  // An unconfigured install links to itself. APP_URL is what `launchreadyy start` sets.
  const base =
    origin ?? process.env.PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:5174";
  return `${base.replace(/\/$/, "")}/r/${token}`;
}
