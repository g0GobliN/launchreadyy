import { describe, expect, it } from "vitest";
import { AI_MAX_TOKENS_CEILING, clampAiMaxTokens } from "./max-tokens";

describe("clampAiMaxTokens", () => {
  it("leaves undefined alone", () => {
    expect(clampAiMaxTokens(undefined)).toBeUndefined();
  });

  it("passes through values under the ceiling", () => {
    expect(clampAiMaxTokens(2048)).toBe(2048);
    expect(clampAiMaxTokens(6144)).toBe(6144);
  });

  it("clamps inflated retries to the ceiling", () => {
    expect(clampAiMaxTokens(Math.round(6144 * 2.2))).toBe(AI_MAX_TOKENS_CEILING);
    expect(clampAiMaxTokens(20_000)).toBe(8192);
  });
});
