/**
 * Server entry for the multi-agent fix pipeline (v2 Phase 8). Wraps the existing `route()` as the
 * agents' generator and injects the Phase 2 repo-knowledge block, gated by `flag_multi_agent_ai`.
 * Returns null when the flag is off so callers fall back to the existing single-shot fix path.
 *
 * @see docs/README.md  (Phase 8)
 */

import { route } from "../router";
import { isFeatureEnabled } from "../../lib/site-config.server";
import { loadRepoKnowledgeContext } from "../../lib/knowledge/writer.server";
import { runAgentPipeline } from "./pipeline";
import type { AgentIssueInput, AgentRunResult, GenerateFn } from "./types";

/**
 * Run the multi-agent pipeline for one issue, or return null if the feature is disabled. The
 * generator routes through the normal AI layer (provider selection, fallback, caching all apply).
 */
export async function runMultiAgentFix(
  repoId: string,
  issue: AgentIssueInput,
  opts: { maxTokens?: number } = {},
): Promise<AgentRunResult | null> {
  if (!(await isFeatureEnabled("flag_multi_agent_ai"))) return null;

  const repoKnowledge = await loadRepoKnowledgeContext(repoId);
  const generate: GenerateFn = (prompt) =>
    route({ taskType: "code" }, "generate", prompt, opts.maxTokens);

  return runAgentPipeline(issue, { generate, repoKnowledge });
}
