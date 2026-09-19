import { route } from "./router";
import type { AICallOptions } from "./types";

export type { TaskType, AIProvider, RouterContext, AICallOptions } from "./types";

/**
 * Unified AI service. All features must use these methods — never call a
 * provider directly from business logic.
 *
 * Provider selection and caching are handled by the router transparently.
 */
export const aiService = {
  /**
   * Generate code or text (tests, README content, etc.).
   * Routes to the provider configured for generation tasks.
   */
  async generate(prompt: string, options?: AICallOptions): Promise<string> {
    return route(
      {
        taskType: options?.taskType ?? "vitest_generation",
      },
      "generate",
      prompt,
      options?.maxTokens,
      options?.cacheKey,
      options?.repoUrl,
    );
  },

  /**
   * Analyze code structure, architecture, or quality.
   * Routes to the provider configured for analysis tasks.
   */
  async analyze(prompt: string, options?: AICallOptions): Promise<string> {
    return route(
      {
        taskType: options?.taskType ?? "architecture_analysis",
      },
      "analyze",
      prompt,
      options?.maxTokens,
      options?.cacheKey,
      options?.repoUrl,
    );
  },

  /**
   * Generate a targeted fix or refactoring suggestion.
   * Semantically distinct from `generate` so the router can route it
   * differently in Phase 3 (e.g. to a more capable model).
   */
  async fix(prompt: string, options?: AICallOptions): Promise<string> {
    return route(
      {
        taskType: options?.taskType ?? "refactoring_suggestions",
      },
      "generate",
      prompt,
      options?.maxTokens,
      options?.cacheKey,
    );
  },
};
