/**
 * Phase 8 glue for the fix job: run the multi-agent pipeline for a job's primary issue.
 * When the pipeline returns generated files, callers may use them as the primary fix content
 * (still verified by sandbox before PR). Always returns a reasoning trail for audit.
 *
 * @see docs/README.md  (Phase 8)
 */

import { getDataStore } from "./data-store.server";
import { runMultiAgentFix } from "../ai/agents/run.server";
import { filterSafeFiles } from "./fix-executor/safe-paths";

/** Compact, bounded reasoning summary (no raw model text) safe to store as jsonb. */
export interface AgentReasoningRecord {
  plan: unknown;
  securityReview: unknown;
  prReview: unknown;
  synthesis: unknown;
  revisions: number;
  error: string | null;
  steps: { agent: string; ok: boolean }[];
  /** True when agent-produced files were applied as the fix content. */
  filesApplied?: boolean;
  fileCount?: number;
}

export interface AgentFixFiles {
  reasoning: AgentReasoningRecord;
  files: { path: string; content: string }[];
}

/**
 * Run the multi-agent pipeline for the job's primary issue. Returns null when the feature is off or
 * no issue is found. Callers should treat any throw as non-fatal.
 */
export async function computeAgentReasoning(
  scanId: string,
  fixIds: string[],
  repoId: string,
): Promise<AgentReasoningRecord | null> {
  const result = await runAgentFixAttempt(scanId, fixIds, repoId);
  return result?.reasoning ?? null;
}

/** Full agent attempt including optional generated files. */
export async function runAgentFixAttempt(
  scanId: string,
  fixIds: string[],
  repoId: string,
): Promise<AgentFixFiles | null> {
  const db = getDataStore();
  const { data: issue } = await db
    .from("issues")
    .select("title, category, severity, why")
    .eq("scan_id", scanId)
    .in("fix_id", fixIds)
    .limit(1)
    .maybeSingle();
  if (!issue) return null;

  const result = await runMultiAgentFix(repoId, {
    title: issue.title,
    category: issue.category,
    severity: issue.severity,
    description: issue.why ?? "",
  });
  if (!result) return null;

  const wellFormed = [...(result.code?.files ?? []), ...(result.tests?.files ?? [])].filter(
    (f) => typeof f.path === "string" && typeof f.content === "string" && f.content.length > 0,
  );

  // Model output is untrusted: the scan feeds it the contents of a repository we did not
  // write, so a crafted repo could try to steer it into a workflow or install-time file.
  const { safe: files, rejected } = filterSafeFiles(wellFormed, "agent");
  if (rejected.length > 0) {
    console.warn(
      `[multi-agent] dropped ${rejected.length} file(s) with disallowed paths: ${rejected.join(", ")}`,
    );
  }

  return {
    reasoning: {
      plan: result.plan ?? null,
      securityReview: result.securityReview ?? null,
      prReview: result.prReview ?? null,
      synthesis: result.synthesis ?? null,
      revisions: result.revisions,
      error: result.error ?? null,
      steps: result.reasoning.map((r) => ({ agent: r.agent, ok: r.ok })),
      fileCount: files.length,
      filesApplied: false,
    },
    files,
  };
}

/**
 * Prefer agent files for matching paths; keep template files for the rest.
 *
 * Re-filters agent paths rather than trusting the caller: this is the point where model
 * output can overwrite a template-generated file, so the denylist has to hold here even if
 * a future caller passes files that did not come through `runAgentFixAttempt`.
 */
export function mergeAgentGeneratedFiles(
  base: { path: string; content: string }[],
  agentFiles: { path: string; content: string }[],
): { path: string; content: string }[] {
  const { safe } = filterSafeFiles(agentFiles, "agent");
  if (safe.length === 0) return base;
  const byPath = new Map(base.map((f) => [f.path, f]));
  for (const f of safe) byPath.set(f.path, f);
  return [...byPath.values()];
}
