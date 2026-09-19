/**
 * Repository Knowledge Model — write/read API for evidence-backed facts.
 * @see docs/reference/07-database.md
 */

import { getDataStore } from "./data-store.server";

export type KnowledgeState =
  | "hypothesis"
  | "verified"
  | "stale"
  | "historical"
  | "disputed"
  | "reverified";

export type KnowledgeTier = 1 | 2 | 3 | 4;
export type KnowledgeConfidence = "high" | "medium" | "low";

export type KnowledgeScope =
  | "default"
  | "build-sandbox"
  | "production-live"
  | "ci-declared"
  | "dockerfile-declared";

export type UpsertKnowledgeFactInput = {
  repoId: string;
  factKey: string;
  scope?: KnowledgeScope | string;
  value: unknown;
  /** Producer tier 1–4 per the knowledge model Precedence section. */
  tier: KnowledgeTier;
  producer: string;
  evidenceRef?: string;
  /** When true (Tier 1 only), state becomes verified. */
  verified?: boolean;
};

function confidenceFrom(tier: KnowledgeTier, state: KnowledgeState): KnowledgeConfidence {
  if (state === "verified" || state === "reverified") return "high";
  if (state === "stale" || state === "disputed") return "low";
  if (tier <= 2) return "medium";
  if (tier === 3) return "medium";
  return "low";
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Upsert a fact for (repo, key, scope). Stronger tier wins; history preserved via superseded_by.
 */
export async function upsertKnowledgeFact(input: UpsertKnowledgeFactInput): Promise<string> {
  const db = getDataStore();
  const scope = input.scope ?? "default";
  const wantVerified = input.verified === true && input.tier === 1;
  const state: KnowledgeState = wantVerified ? "verified" : "hypothesis";
  const confidence = confidenceFrom(input.tier, state);
  const now = new Date().toISOString();

  const { data: current } = await db
    .from("repo_knowledge_facts")
    .select("id, value, tier, state")
    .eq("repo_id", input.repoId)
    .eq("fact_key", input.factKey)
    .eq("scope", scope)
    .is("superseded_by", null)
    .maybeSingle();

  if (current) {
    const sameValue = valuesEqual(current.value, input.value);
    // Lower/equal tier with same value: refresh timestamps only for Tier 1 re-verify.
    if (sameValue && input.tier <= (current.tier as number)) {
      if (wantVerified && current.state !== "verified") {
        await db
          .from("repo_knowledge_facts")
          .update({
            state: "verified",
            confidence: "high",
            verified_at: now,
            evidence_ref: input.evidenceRef ?? null,
            producer: input.producer,
            tier: input.tier,
          })
          .eq("id", current.id);
      }
      return current.id;
    }
    // Incoming weaker than current → ignore (don't demote).
    if (input.tier > (current.tier as number)) {
      return current.id;
    }
    // Stronger or different value at same/higher tier → supersede.
    const newId = crypto.randomUUID();
    await db.from("repo_knowledge_facts").insert({
      id: newId,
      repo_id: input.repoId,
      fact_key: input.factKey,
      scope,
      value: input.value as never,
      state,
      tier: input.tier,
      confidence,
      producer: input.producer,
      evidence_ref: input.evidenceRef ?? null,
      verified_at: wantVerified ? now : null,
      first_observed_at: now,
    });
    await db
      .from("repo_knowledge_facts")
      .update({ state: "historical", superseded_by: newId })
      .eq("id", current.id);
    return newId;
  }

  const id = crypto.randomUUID();
  await db.from("repo_knowledge_facts").insert({
    id,
    repo_id: input.repoId,
    fact_key: input.factKey,
    scope,
    value: input.value as never,
    state,
    tier: input.tier,
    confidence,
    producer: input.producer,
    evidence_ref: input.evidenceRef ?? null,
    verified_at: wantVerified ? now : null,
    first_observed_at: now,
  });
  return id;
}

export async function listCurrentKnowledgeFacts(repoId: string) {
  const db = getDataStore();
  const { data } = await db
    .from("repo_knowledge_facts")
    .select("*")
    .eq("repo_id", repoId)
    .is("superseded_by", null)
    .in("state", ["hypothesis", "verified", "stale", "reverified", "disputed"])
    .order("fact_key");
  return data ?? [];
}
