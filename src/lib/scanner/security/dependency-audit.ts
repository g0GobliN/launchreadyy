import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals } from "./signals";

const AUDIT_RE =
  /\bnpm\s+audit\b|\bpnpm\s+audit\b|\byarn\s+npm\s+audit\b|\baudit\s+--audit-level\b|security-audit:|dependency-audit/i;

/**
 * Flags missing dependency-audit step in CI. Fix pack adds a dedicated workflow.
 */
export function checkDependencyAudit(
  files: string[],
  fileContents: Record<string, string>,
  issues: IssueInput[],
) {
  const workflows = files.filter(
    (f) => f.startsWith(".github/workflows/") && (f.endsWith(".yml") || f.endsWith(".yaml")),
  );
  if (workflows.length === 0) return; // no CI yet — checkCI owns that finding

  const hasAudit = workflows.some((f) => AUDIT_RE.test(fileContents[f] ?? ""));
  if (hasAudit) return;

  issues.push({
    category: "Security",
    title: "No dependency audit in CI",
    severity: "medium",
    why: "Without a scheduled or PR-time audit, known vulnerable packages can ship unnoticed until an incident.",
    timeSaved: "30m",
    fixId: "dependency-audit-ci",
    checkedFor: ["npm audit / pnpm audit / yarn npm audit in .github/workflows"],
    foundEvidence: `Checked ${workflows.length} workflow file(s); no dependency audit step found.`,
    confidence: confidenceFromSignals([{ kind: "exact_absence", detail: "npm audit in CI" }]),
    recommendedFix:
      "Add a CI job that runs npm audit (or equivalent) and fails on high/critical advisories.",
    detection: ["rule-based"],
  });
}
