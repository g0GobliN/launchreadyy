/**
 * Server-side glue for the knowledge engine (v2 Phase 2): persist extracted facts and load the
 * AI-prompt context. Thin wrappers over the pure extract/context logic and the existing
 * `upsertKnowledgeFact` — flag-gated so scans are unchanged when `flag_repo_knowledge_v2` is off.
 *
 * @see docs/README.md  (Phase 2)
 */

import { listCurrentKnowledgeFacts, upsertKnowledgeFact } from "../repo-knowledge.server";
import { isFeatureEnabled } from "../site-config.server";
import { extractKnowledgeFacts, type KnowledgeExtractionInput } from "./extract-facts";
import { buildRepoKnowledgeContext, type KnowledgeFactRow } from "./context";

/**
 * Extract facts from scan inputs and upsert them for the repo. No-op (returns 0) when the flag is
 * off. Best-effort: a single fact failing to persist never fails the scan.
 */
export async function recordScanKnowledge(
  repoId: string,
  input: KnowledgeExtractionInput,
): Promise<number> {
  if (!(await isFeatureEnabled("flag_repo_knowledge_v2"))) return 0;
  const facts = extractKnowledgeFacts(input);
  let written = 0;
  for (const fact of facts) {
    try {
      await upsertKnowledgeFact({
        repoId,
        factKey: fact.factKey,
        value: fact.value,
        tier: fact.tier,
        producer: fact.producer,
        evidenceRef: fact.evidenceRef,
      });
      written++;
    } catch {
      // Best-effort — never let knowledge capture break a scan.
    }
  }
  return written;
}

/**
 * Load the repository-knowledge block for AI prompts. Empty string when the flag is off or there are
 * no facts, so callers can unconditionally concatenate it.
 */
export async function loadRepoKnowledgeContext(repoId: string): Promise<string> {
  if (!(await isFeatureEnabled("flag_repo_knowledge_v2"))) return "";
  const facts = (await listCurrentKnowledgeFacts(repoId)) as KnowledgeFactRow[];
  return buildRepoKnowledgeContext(facts);
}
