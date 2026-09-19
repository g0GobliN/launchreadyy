/** Absolute ceiling on a single provider call — clamps retries that inflate maxTokens. */
export const AI_MAX_TOKENS_CEILING = 8192;

export function clampAiMaxTokens(maxTokens?: number): number | undefined {
  if (maxTokens == null) return undefined;
  if (!Number.isFinite(maxTokens)) return undefined;
  return Math.min(Math.max(0, Math.round(maxTokens)), AI_MAX_TOKENS_CEILING);
}
