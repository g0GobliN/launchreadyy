/**
 * Scoring for the AI patch-quality measurement.
 *
 * The product can say "the pipeline works" — 27 fixtures complete a real PR lifecycle — but it
 * cannot yet say what fraction of *model-authored* patches are right. This is the arithmetic
 * behind that number, kept out of `scripts/` so it is covered by the normal test run rather than
 * living only in a script nobody executes on a normal day.
 *
 * What the number means, precisely: **the share of generated patches that survive
 * install/build/lint in a sandbox.** That is a lower bound on correctness, not correctness — a
 * patch that compiles can still be wrong. It is the right lower bound to publish, because it is
 * exactly the bar `verifyBeforePr` holds a patch to before it reaches a pull request.
 *
 * @see scripts/measure-ai-fix-quality.ts
 */

/** Why an attempt produced no verdict about the model. */
export type InconclusiveKind = "skipped" | "no_output" | "error";

export type AttemptOutcome =
  | { status: "passed" }
  | { status: "failed"; category: string; failedStep?: string }
  | { status: InconclusiveKind; detail: string };

export interface Attempt {
  repo: string;
  fixId: string;
  outcome: AttemptOutcome;
  /** How many files the model wrote. Absent when it produced none. */
  fileCount?: number;
  ms?: number;
}

export interface FixBreakdown {
  fixId: string;
  passed: number;
  failed: number;
  inconclusive: number;
  /** null when nothing conclusive ran — never 0, which would read as "all patches failed". */
  passRate: number | null;
}

export interface QualitySummary {
  attempts: number;
  passed: number;
  failed: number;
  inconclusive: number;
  /** Denominator is passed + failed. null when that is zero. */
  passRate: number | null;
  byFix: FixBreakdown[];
  /** Failure categories, most common first — where the patches actually break. */
  failureCategories: { category: string; count: number }[];
  /** Inconclusive reasons, so a run that measured nothing cannot look like a clean sweep. */
  inconclusiveReasons: { reason: string; count: number }[];
}

type InconclusiveOutcome = Extract<AttemptOutcome, { status: InconclusiveKind }>;

/** Type predicate, not a plain boolean — the callers below read `.detail` off the narrowed type. */
const isInconclusive = (o: AttemptOutcome): o is InconclusiveOutcome =>
  o.status === "skipped" || o.status === "no_output" || o.status === "error";

/**
 * Reduce attempts to a publishable summary.
 *
 * Inconclusive attempts are excluded from the denominator rather than counted as failures. A
 * sandbox that never ran, or a model that returned nothing because the repo had no such gap,
 * is not evidence the patch was bad — folding those in would understate quality by however
 * flaky the harness happened to be that day, which is precisely the number nobody can act on.
 */
export function summarise(attempts: Attempt[]): QualitySummary {
  const passed = attempts.filter((a) => a.outcome.status === "passed").length;
  const failed = attempts.filter((a) => a.outcome.status === "failed").length;
  const inconclusive = attempts.filter((a) => isInconclusive(a.outcome)).length;

  const fixIds = [...new Set(attempts.map((a) => a.fixId))].sort();
  const byFix = fixIds.map((fixId) => {
    const own = attempts.filter((a) => a.fixId === fixId);
    const p = own.filter((a) => a.outcome.status === "passed").length;
    const f = own.filter((a) => a.outcome.status === "failed").length;
    return {
      fixId,
      passed: p,
      failed: f,
      inconclusive: own.filter((a) => isInconclusive(a.outcome)).length,
      passRate: rate(p, f),
    };
  });

  return {
    attempts: attempts.length,
    passed,
    failed,
    inconclusive,
    passRate: rate(passed, failed),
    byFix,
    failureCategories: tally(
      attempts.flatMap((a) => (a.outcome.status === "failed" ? [a.outcome.category] : [])),
    ).map(([category, count]) => ({ category, count })),
    inconclusiveReasons: tally(
      attempts.flatMap((a) =>
        isInconclusive(a.outcome) ? [`${a.outcome.status}: ${a.outcome.detail}`] : [],
      ),
    ).map(([reason, count]) => ({ reason, count })),
  };
}

function rate(passed: number, failed: number): number | null {
  const total = passed + failed;
  return total === 0 ? null : passed / total;
}

/** Counts by value, most frequent first, ties broken alphabetically so output is stable. */
function tally(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const pct = (r: number | null): string => (r === null ? "n/a" : `${Math.round(r * 100)}%`);

/** Human-readable report. Deliberately leads with the caveat — the headline invites misreading. */
export function formatReport(s: QualitySummary): string {
  const lines: string[] = [
    `AI patch quality — share of generated patches that install, build and lint cleanly`,
    `(a lower bound on correctness: a patch that compiles can still be wrong)`,
    ``,
    `  overall      ${pct(s.passRate)}   (${s.passed} passed / ${s.passed + s.failed} conclusive)`,
    `  attempts     ${s.attempts}`,
    `  inconclusive ${s.inconclusive}  — excluded from the rate`,
    ``,
  ];

  if (s.passRate === null) {
    lines.push(`  Nothing conclusive ran. The rate above is not a result — see reasons below.`, ``);
  }

  lines.push(`By fix:`);
  for (const f of s.byFix) {
    const incon = f.inconclusive > 0 ? `  (${f.inconclusive} inconclusive)` : "";
    lines.push(
      `  ${f.fixId.padEnd(24)} ${pct(f.passRate).padStart(4)}   ${f.passed}/${f.passed + f.failed}${incon}`,
    );
  }

  if (s.failureCategories.length > 0) {
    lines.push(``, `Failures by category:`);
    for (const c of s.failureCategories) lines.push(`  ${c.category.padEnd(24)} ${c.count}`);
  }

  if (s.inconclusiveReasons.length > 0) {
    lines.push(``, `Inconclusive:`);
    for (const r of s.inconclusiveReasons) lines.push(`  ${r.count}x ${r.reason}`);
  }

  return lines.join("\n");
}
