/**
 * Build the compact repository-knowledge block injected into AI fix prompts (v2 Phase 2). Pure
 * formatting — takes current facts, returns a string the AI reads before generating, so it reuses
 * what the scanner/sandbox already proved instead of re-guessing. Verified facts are marked; low
 * confidence is de-emphasized. Empty in → empty string out (nothing to inject).
 *
 * @see docs/README.md  (Phase 2)
 */

import { KNOWLEDGE_FACT_LABELS } from "./fact-keys";

export interface KnowledgeFactRow {
  fact_key: string;
  value: unknown;
  confidence: string;
  state: string;
  scope?: string;
}

function renderValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Render current facts as a Markdown block for an AI prompt. `disputed`/`stale` facts are excluded —
 * they aren't reliable enough to steer generation. Order: confidence, then key, for stable output.
 */
export function buildRepoKnowledgeContext(facts: KnowledgeFactRow[]): string {
  const usable = facts.filter((f) => f.state !== "disputed" && f.state !== "stale");
  if (usable.length === 0) return "";

  const sorted = [...usable].sort((a, b) => {
    const c = (CONFIDENCE_RANK[a.confidence] ?? 3) - (CONFIDENCE_RANK[b.confidence] ?? 3);
    return c !== 0 ? c : a.fact_key.localeCompare(b.fact_key);
  });

  const lines = sorted.map((f) => {
    const label = KNOWLEDGE_FACT_LABELS[f.fact_key] ?? f.fact_key;
    const verified = f.state === "verified" || f.state === "reverified";
    const marker = verified ? " (verified)" : f.confidence === "low" ? " (low confidence)" : "";
    return `- ${label}: ${renderValue(f.value)}${marker}`;
  });

  return [
    "## Known facts about this repository",
    "Use these established facts instead of re-inferring them. Prefer verified facts; treat",
    "low-confidence facts as hints, not guarantees.",
    "",
    ...lines,
  ].join("\n");
}
