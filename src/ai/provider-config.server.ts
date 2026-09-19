/** Resolves the AI provider selected by this installation's environment. */

export const AI_PROVIDER_IDS = ["deepseek", "claude", "openai", "gemini", "cursor"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export function isAiProviderId(value: string | null | undefined): value is AiProviderId {
  return Boolean(value && (AI_PROVIDER_IDS as readonly string[]).includes(value.toLowerCase()));
}

export function normalizeAiProviderId(value: string | null | undefined): AiProviderId | null {
  if (!value?.trim()) return null;
  const lower = value.trim().toLowerCase();
  // Allow legacy free-text labels like "deepseek-chat" / "claude-sonnet-4-6" to map to a provider.
  for (const id of AI_PROVIDER_IDS) {
    if (lower === id || lower.startsWith(`${id}-`) || lower.startsWith(`${id}_`)) return id;
  }
  return null;
}

export function envAiProvider(): AiProviderId {
  const fromEnv = normalizeAiProviderId(process.env.AI_PROVIDER);
  return fromEnv ?? "deepseek";
}

/** Sync read — uses cache when warm, else env. Call `ensureAiProviderCache` in async entrypoints. */
export function getConfiguredAiProvider(): AiProviderId {
  return envAiProvider();
}

export function clearAiProviderCache(): void {}

export async function ensureAiProviderCache(): Promise<AiProviderId> {
  return envAiProvider();
}

/** Which provider API keys are present (booleans only — never return secret values). */
export function aiProviderKeyStatus(): Record<AiProviderId, boolean> {
  return {
    deepseek: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
    claude: Boolean(process.env.CLAUDE_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim()),
    openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
    gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
    cursor: Boolean(process.env.CURSOR_API_KEY?.trim()),
  };
}
