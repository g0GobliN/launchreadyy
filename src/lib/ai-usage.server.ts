/**
 * Measured AI token usage.
 *
 * Records token counts and estimated provider cost from each AI call.
 *
 * Recording is strictly best-effort — an AI call that succeeded must never fail because we could
 * not write a usage row.
 */

import { getDataStore } from "./data-store.server";
import type { AIUsage } from "../ai/types";

/** USD per 1M tokens, by model-id prefix. Longest matching prefix wins. */
const MODEL_RATES: Array<{
  prefix: string;
  inputUsd: number;
  outputUsd: number;
  cachedUsd?: number;
}> = [
  // DeepSeek — the live default (AI_PROVIDER=deepseek).
  { prefix: "deepseek-v4-pro", inputUsd: 0.435, outputUsd: 0.87, cachedUsd: 0.003625 },
  { prefix: "deepseek-reasoner", inputUsd: 0.435, outputUsd: 0.87, cachedUsd: 0.003625 },
  { prefix: "deepseek-v4-flash", inputUsd: 0.14, outputUsd: 0.28, cachedUsd: 0.0028 },
  { prefix: "deepseek-chat", inputUsd: 0.14, outputUsd: 0.28, cachedUsd: 0.0028 },
  // Anthropic rates for installations configured with AI_PROVIDER=claude.
  { prefix: "claude-opus", inputUsd: 5.0, outputUsd: 25.0 },
  { prefix: "claude-sonnet", inputUsd: 3.0, outputUsd: 15.0 },
  { prefix: "claude-haiku", inputUsd: 1.0, outputUsd: 5.0 },
  // Never auto-selected by the fallback chain; here so a manual switch is still costed.
  { prefix: "gpt-4o-mini", inputUsd: 0.15, outputUsd: 0.6 },
  { prefix: "gemini-2.0-flash", inputUsd: 0.1, outputUsd: 0.4 },
];

/** Charged at full input rate when a model has no entry — better to over-report than under. */
const FALLBACK_RATE = { inputUsd: 3.0, outputUsd: 15.0 };

export function estimateCallCostUsd(usage: AIUsage): number {
  const rate =
    MODEL_RATES.filter((r) => usage.model.startsWith(r.prefix)).sort(
      (a, b) => b.prefix.length - a.prefix.length,
    )[0] ?? FALLBACK_RATE;

  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  const cachedRate = "cachedUsd" in rate && rate.cachedUsd != null ? rate.cachedUsd : rate.inputUsd;

  return (
    (fresh * rate.inputUsd) / 1_000_000 +
    (cached * cachedRate) / 1_000_000 +
    (usage.outputTokens * rate.outputUsd) / 1_000_000
  );
}

export interface RecordAiUsageInput {
  usage: AIUsage;
  provider: string;
  taskType: string;
  method: string;
  /** Present when the call is attributable to a user; absent for platform-internal calls. */
  githubLogin?: string | null;
}

export async function recordAiUsage(input: RecordAiUsageInput): Promise<void> {
  const { usage, provider, taskType, method, githubLogin } = input;
  // A provider that reported nothing tells us nothing — a zero row would drag the measured
  // average down and make the model look cheaper than it is.
  if (usage.inputTokens <= 0 && usage.outputTokens <= 0) return;

  try {
    const db = getDataStore();
    await db.from("ai_usage").insert({
      github_login: githubLogin ?? null,
      provider,
      model: usage.model,
      task_type: taskType,
      method,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cached_input_tokens: usage.cachedInputTokens ?? 0,
      est_cost_usd: estimateCallCostUsd(usage),
    });
  } catch (err) {
    console.error("[ai-usage] failed to record usage:", err);
  }
}
