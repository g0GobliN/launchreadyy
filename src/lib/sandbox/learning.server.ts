/**
 * Server glue for intelligent-sandbox learning (v2 Phase 9). Reads a completed run's log, detects
 * required services / env vars from real failure signatures, unions them with what's already known,
 * and persists tier-1 (observed) knowledge facts. Flag-gated; a no-op when nothing is detected.
 *
 * @see docs/README.md  (Phase 9)
 */

import { listCurrentKnowledgeFacts, upsertKnowledgeFact } from "../repo-knowledge.server";
import { isFeatureEnabled } from "../site-config.server";
import { buildPrimingPlan, detectRequiredEnvVars, detectRequiredServices } from "./learning";

const SCOPE = "build-sandbox";

function knownStringArray(
  facts: { fact_key: string; value: unknown; scope?: string }[],
  key: string,
): string[] {
  const row = facts.find((f) => f.fact_key === key && (f.scope ?? "default") === SCOPE);
  return Array.isArray(row?.value)
    ? (row!.value as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * Learn required services/env vars from a sandbox run log and persist them (unioned with prior
 * knowledge). No-op unless `flag_intelligent_sandbox` is on and something was actually detected.
 */
export async function recordSandboxLearning(
  repoId: string,
  logText: string,
  runId: string,
): Promise<void> {
  if (!(await isFeatureEnabled("flag_intelligent_sandbox"))) return;

  const services = detectRequiredServices(logText);
  const envVars = detectRequiredEnvVars(logText);
  if (services.length === 0 && envVars.length === 0) return;

  const current = await listCurrentKnowledgeFacts(repoId);
  const plan = buildPrimingPlan({
    services,
    envVars,
    knownServices: knownStringArray(current, "required-services"),
    knownEnvVarNames: knownStringArray(current, "required-env-vars"),
  });

  const writes: Promise<unknown>[] = [];
  if (plan.services.length > 0) {
    writes.push(
      upsertKnowledgeFact({
        repoId,
        factKey: "required-services",
        scope: SCOPE,
        value: plan.services,
        tier: 1,
        producer: "sandbox",
        evidenceRef: runId,
        verified: true,
      }),
    );
  }
  if (plan.envVarNames.length > 0) {
    writes.push(
      upsertKnowledgeFact({
        repoId,
        factKey: "required-env-vars",
        scope: SCOPE,
        value: plan.envVarNames,
        tier: 1,
        producer: "sandbox",
        evidenceRef: runId,
        verified: true,
      }),
    );
  }
  await Promise.all(writes.map((p) => p.catch((e) => console.error("[sandbox-learning]", e))));
}

/**
 * Phase 9 priming — load previously learned required env var names / services for the next run.
 * Returns empty arrays when the flag is off or nothing is stored.
 */
export async function loadSandboxPriming(
  repoId: string,
): Promise<{ services: string[]; envVarNames: string[] }> {
  if (!(await isFeatureEnabled("flag_intelligent_sandbox"))) {
    return { services: [], envVarNames: [] };
  }
  const current = await listCurrentKnowledgeFacts(repoId);
  return {
    services: knownStringArray(current, "required-services"),
    envVarNames: knownStringArray(current, "required-env-vars"),
  };
}
