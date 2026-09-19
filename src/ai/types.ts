export type TaskType =
  | "architecture_analysis"
  | "refactoring_suggestions"
  | "vitest_generation"
  | "playwright_generation"
  | "api_test_generation"
  | "readme_improvements"
  | "ci_generation"
  | "env_example_generation"
  | "fix_recovery"
  | "security_explanation"
  | "security_deep_analysis"
  | "code";

/** Token counts as reported by the provider for a single call. */
export interface AIUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Portion of `inputTokens` served from the provider's own prompt cache, when it reports one. */
  cachedInputTokens?: number;
}

/**
 * Out-parameter for per-call token usage.
 *
 * Providers return plain strings and are called from a dozen places, so widening the return
 * type would ripple across every call site for the benefit of the one caller that cares.
 * The router passes a fresh sink per call and reads it straight after; nothing else has to
 * know this exists.
 */
export interface AIUsageSink {
  usage?: AIUsage;
}

export interface AIProvider {
  generate(
    prompt: string,
    maxTokens?: number,
    repoUrl?: string,
    model?: string,
    sink?: AIUsageSink,
  ): Promise<string>;
  analyze(
    prompt: string,
    maxTokens?: number,
    repoUrl?: string,
    model?: string,
    sink?: AIUsageSink,
  ): Promise<string>;
}

export interface RouterContext {
  taskType: TaskType;
  /** Attributes recorded token usage to a user when the caller knows who it is for. */
  githubLogin?: string | null;
}

export interface AICallOptions extends Partial<RouterContext> {
  maxTokens?: number;
  /** Optional cache key. When provided the router checks the in-memory cache
   *  before calling the provider and stores the result afterward. */
  cacheKey?: string;
  /** Full GitHub URL (https://github.com/owner/repo). When set and the active
   *  provider supports repo access (e.g. Cursor), the agent reads the real
   *  codebase instead of relying solely on pasted file context. */
  repoUrl?: string;
}
