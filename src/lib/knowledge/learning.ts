/**
 * Repository learning (v2 Phase 10). Adapt future scans from human signals — dismissed findings,
 * accepted risks, ignored items — so the tool stops re-nagging about things the developer decided.
 * Pure and deterministic; signals are loaded from the knowledge store (tier 1 — human input) at the
 * call site.
 *
 * Guardrail: learning suppresses *presentation only*, and a severity escalation overrides a prior
 * dismissal — a newly-critical issue is never silently hidden because an earlier, milder version was
 * dismissed.
 *
 * @see docs/README.md  (Phase 10)
 */

export interface LearnableFinding {
  category: string;
  title: string;
  fixId: string;
  severity: string;
  file?: string;
  ruleId?: string;
}

export type LearnedAction = "dismissed" | "accepted" | "ignored";

export interface LearnedSignal {
  fingerprint: string;
  action: LearnedAction;
  /** Severity when the human acted — used to detect later escalation. */
  severityAtAction: string;
}

/** Stable identity for a finding across scans — independent of volatile counts/evidence text. */
export function fingerprintFinding(f: LearnableFinding): string {
  return [f.category, f.fixId, f.ruleId ?? "", f.file ?? "", f.title].join("|").toLowerCase();
}

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function rank(severity: string): number {
  return SEVERITY_RANK[severity.toLowerCase()] ?? 0;
}

export interface Suppression<T> {
  finding: T;
  reason: "dismissed" | "accepted-risk" | "ignored";
}

export interface LearningResult<T> {
  visible: T[];
  suppressed: Suppression<T>[];
}

const REASON: Record<LearnedAction, Suppression<unknown>["reason"]> = {
  dismissed: "dismissed",
  accepted: "accepted-risk",
  ignored: "ignored",
};

/**
 * Split findings into what to show vs. suppress, honoring learned signals. A signal suppresses a
 * finding only when the finding's current severity has NOT escalated beyond the acted-on severity.
 * Order of `visible` matches the input order.
 */
export function applyLearning<T extends LearnableFinding>(
  findings: T[],
  signals: LearnedSignal[],
): LearningResult<T> {
  const byFingerprint = new Map(signals.map((s) => [s.fingerprint, s]));
  const visible: T[] = [];
  const suppressed: Suppression<T>[] = [];

  for (const finding of findings) {
    const signal = byFingerprint.get(fingerprintFinding(finding));
    if (!signal) {
      visible.push(finding);
      continue;
    }
    // Escalation override: current severity higher than when the human acted → re-surface.
    if (rank(finding.severity) > rank(signal.severityAtAction)) {
      visible.push(finding);
      continue;
    }
    suppressed.push({ finding, reason: REASON[signal.action] });
  }

  return { visible, suppressed };
}
