import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fallbackProvidersFor, selectModel, selectProviderName } from "./router";
import { clearAiProviderCache } from "./provider-config.server";

const ENV_KEYS = [
  "AI_PROVIDER",
  "CLAUDE_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
];

describe("selectProviderName", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    clearAiProviderCache();
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    clearAiProviderCache();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("respects AI_PROVIDER=deepseek for a fast-generation task even when a Claude key is present", () => {
    // Regression: selectProviderName used to ignore AI_PROVIDER entirely for every task in
    // FAST_GENERATION_TASKS (readme, ci, vitest, playwright, api-tests, env-example) and always
    // preferred Claude when a key was present, no matter what the user configured.
    process.env.AI_PROVIDER = "deepseek";
    process.env.CLAUDE_API_KEY = "sk-fake-claude-key";
    process.env.DEEPSEEK_API_KEY = "sk-fake-deepseek-key";
    expect(selectProviderName({ taskType: "readme_improvements" })).toBe("deepseek");
    expect(selectProviderName({ taskType: "vitest_generation" })).toBe("deepseek");
    expect(selectProviderName({ taskType: "ci_generation" })).toBe("deepseek");
  });

  it("respects AI_PROVIDER=claude for a fast-generation task", () => {
    process.env.AI_PROVIDER = "claude";
    process.env.CLAUDE_API_KEY = "sk-fake-claude-key";
    process.env.DEEPSEEK_API_KEY = "sk-fake-deepseek-key";
    expect(selectProviderName({ taskType: "readme_improvements" })).toBe("claude");
  });

  it("respects the configured provider for non-fast-generation tasks too", () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.CLAUDE_API_KEY = "sk-fake-claude-key";
    expect(selectProviderName({ taskType: "architecture_analysis" })).toBe("deepseek");
  });

  it("falls back off Cursor for fast-generation tasks — Cloud Agents are too slow for a sync response", () => {
    process.env.AI_PROVIDER = "cursor";
    process.env.CLAUDE_API_KEY = "sk-fake-claude-key";
    process.env.DEEPSEEK_API_KEY = "sk-fake-deepseek-key";
    expect(selectProviderName({ taskType: "readme_improvements" })).toBe("claude");
  });

  it("keeps Cursor for non-fast-generation tasks", () => {
    process.env.AI_PROVIDER = "cursor";
    expect(selectProviderName({ taskType: "architecture_analysis" })).toBe("cursor");
  });
});

describe("fallbackProvidersFor", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    clearAiProviderCache();
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    clearAiProviderCache();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("does not fall back to OpenAI/Gemini when AI_PROVIDER=deepseek even if those keys exist", () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "sk-deepseek";
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.GEMINI_API_KEY = "sk-gemini";
    expect(fallbackProvidersFor("deepseek")).toEqual(["deepseek"]);
  });

  it("allows Claude as DeepSeek failover when a Claude key is present", () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "sk-deepseek";
    process.env.CLAUDE_API_KEY = "sk-claude";
    process.env.OPENAI_API_KEY = "sk-openai";
    expect(fallbackProvidersFor("deepseek")).toEqual(["deepseek", "claude"]);
  });
});

describe("selectModel", () => {
  // Regression: a June 30 commit ("enhance webhook handling and improve error reporting" —
  // unrelated to AI routing) silently collapsed the deepseek branch to always return the
  // reasoner model, leaving DEEPSEEK_CHAT_MODEL declared but unused. That made every DeepSeek
  // call (README, env-example, CI, tests) pay for hidden reasoning tokens it didn't need, which
  // also raised the odds of the empty-response failure mode found via live testing.
  it("uses the DeepSeek chat model for non-deep-analysis tasks", () => {
    expect(selectModel("deepseek", "readme_improvements")).toBe("deepseek-chat");
    expect(selectModel("deepseek", "vitest_generation")).toBe("deepseek-chat");
    expect(selectModel("deepseek", "ci_generation")).toBe("deepseek-chat");
  });

  it("uses the DeepSeek reasoner model only for deep-analysis tasks", () => {
    expect(selectModel("deepseek", "architecture_analysis")).toBe("deepseek-reasoner");
    expect(selectModel("deepseek", "refactoring_suggestions")).toBe("deepseek-reasoner");
  });

  it("uses Haiku for simple-fill Claude tasks, Opus for deep analysis, Sonnet otherwise", () => {
    expect(selectModel("claude", "readme_improvements")).toBe("claude-haiku-4-5-20251001");
    expect(selectModel("claude", "architecture_analysis")).toBe("claude-opus-4-8");
    expect(selectModel("claude", "vitest_generation")).toBe("claude-sonnet-4-6");
  });
});
