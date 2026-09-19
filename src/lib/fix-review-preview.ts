import type { FileDiff } from "@/lib/mock-data";

export interface ReviewVerificationNote {
  fixId: string;
  status: string;
  note: string;
}

export function collectPreviewIssues(
  diffs: FileDiff[] | null,
  verificationNotes: ReviewVerificationNote[],
  errorMessage?: string | null,
): string[] {
  const issues: string[] = [];
  for (const d of diffs ?? []) {
    if (d.validation?.status === "invalid") {
      issues.push(`${d.path}: ${d.validation.detail ?? "Syntax error"}`);
    }
  }
  for (const n of verificationNotes) {
    if (n.status === "warning") {
      issues.push(`${n.fixId}: ${n.note}`);
    }
  }
  if (errorMessage?.trim()) issues.push(errorMessage.trim());
  return issues;
}
