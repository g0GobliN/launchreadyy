/**
 * Wire Phase 10 learning into scan results: load risk_acceptances as learned signals
 * and suppress matching findings via `applyLearning` (presentation only; critical severity
 * still shows through the escalation guardrail).
 */

import { getRiskAcceptances } from "../db.server";
import { isFeatureEnabled } from "../site-config.server";
import type { ReadinessFinding } from "../readiness";
import { applyLearning, fingerprintFinding, type LearnedSignal } from "./learning";

/**
 * Drop findings whose fixId was accepted-as-risk, unless severity escalated past the
 * acceptance band (critical always resurfaces).
 */
export async function filterFindingsWithLearning(
  repoId: string,
  findings: ReadinessFinding[],
): Promise<ReadinessFinding[]> {
  if (!(await isFeatureEnabled("flag_repo_learning"))) return findings;

  const accepted = await getRiskAcceptances(repoId);
  if (accepted.length === 0) return findings;

  const acceptedFixIds = new Set(accepted.map((a) => a.fixId));
  // risk_acceptances store fixId only — synthesize fingerprints for matching findings.
  // severityAtAction "high" matches prior behavior: only critical (rank 4) resurfaces.
  const signals: LearnedSignal[] = findings
    .filter((f) => acceptedFixIds.has(f.fixId))
    .map((f) => ({
      fingerprint: fingerprintFinding(f),
      action: "accepted" as const,
      severityAtAction: "high",
    }));

  if (signals.length === 0) return findings;
  return applyLearning(findings, signals).visible;
}
