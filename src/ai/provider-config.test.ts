import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAiProviderCache,
  envAiProvider,
  getConfiguredAiProvider,
  normalizeAiProviderId,
} from "./provider-config.server";

const ENV_KEYS = ["AI_PROVIDER"];

describe("normalizeAiProviderId", () => {
  it("accepts exact ids and prefixed model labels", () => {
    expect(normalizeAiProviderId("deepseek")).toBe("deepseek");
    expect(normalizeAiProviderId("DeepSeek")).toBe("deepseek");
    expect(normalizeAiProviderId("claude-sonnet-4-6")).toBe("claude");
    expect(normalizeAiProviderId("openai_gpt-4o")).toBe("openai");
    expect(normalizeAiProviderId("garbage")).toBeNull();
    expect(normalizeAiProviderId("")).toBeNull();
  });
});

describe("getConfiguredAiProvider", () => {
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

  it("defaults to deepseek when env unset", () => {
    expect(envAiProvider()).toBe("deepseek");
    expect(getConfiguredAiProvider()).toBe("deepseek");
  });

  it("reads AI_PROVIDER env when cache is cold", () => {
    process.env.AI_PROVIDER = "openai";
    expect(getConfiguredAiProvider()).toBe("openai");
  });
});
