import type { Issue } from "./mock-data";

/** Human copy for why a finding matters — the headline-adjacent reasoning shown for every finding. */
export function getWhyItMattersCopy(issue: Issue): string {
  if (issue.businessImpact?.trim()) return issue.businessImpact;
  if (issue.productionScenario?.trim()) return issue.productionScenario;
  if (issue.why?.trim()) return issue.why;
  return "Detected during automated repo audit.";
}

/** "Checked X, Y, Z — none found" style copy for the evidence/audit-trail disclosure. Null when there's nothing to show. */
export function getCheckedForCopy(issue: Issue): string | null {
  const lookedFor =
    issue.checkedFor && issue.checkedFor.length > 0 ? issue.checkedFor.join(", ") : null;
  if (issue.foundEvidence && lookedFor) {
    return `${issue.foundEvidence} Looked for: ${lookedFor}.`;
  }
  if (issue.foundEvidence) return issue.foundEvidence;
  if (lookedFor) return `Checked: ${lookedFor}. None found.`;
  return null;
}

/** Confidence label + manual-review note for the evidence disclosure. Null when the finding predates confidence. */
export function getConfidenceCopy(issue: Issue): { label: string; note: string | null } | null {
  if (!issue.confidence) return null;
  const label = issue.confidence.charAt(0).toUpperCase() + issue.confidence.slice(1);
  const note =
    issue.confidence === "high"
      ? null
      : issue.confidence === "medium"
        ? "Automatic verification is incomplete — worth a manual review."
        : "Pattern-based inference only — verify this manually before acting on it.";
  return { label, note };
}

const DETECTION_LABEL: Record<string, string> = {
  "rule-based": "Rule-based",
  "framework-aware": "Framework-aware",
  "ai-assisted": "AI-assisted",
  "sandbox-verified": "Verified in sandbox",
};

/** Primary detection method label for the finding card badge. Null when unset. */
export function getDetectionCopy(issue: Issue): string | null {
  if (!issue.detection || issue.detection.length === 0) return null;
  return issue.detection.map((d) => DETECTION_LABEL[d] ?? d).join(" · ");
}

/** True when a real sandbox build/lint run confirmed this finding — a proven fact, not a static guess. */
export function isSandboxVerified(issue: Issue): boolean {
  return issue.detection?.includes("sandbox-verified") ?? false;
}
