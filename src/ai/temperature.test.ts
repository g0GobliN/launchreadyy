import { describe, it, expect } from "vitest";

import { AI_TEMPERATURE, supportsTemperature } from "./temperature";

describe("AI_TEMPERATURE", () => {
  it("is low — everything generated here is code or structured text", () => {
    expect(AI_TEMPERATURE).toBeGreaterThan(0);
    expect(AI_TEMPERATURE).toBeLessThanOrEqual(0.3);
  });
});

describe("supportsTemperature", () => {
  it("allows temperature on standard chat models", () => {
    for (const m of [
      "gpt-4o-mini",
      "gpt-4o",
      "deepseek-chat",
      "claude-sonnet-4-6",
      "gemini-2.0-flash",
    ]) {
      expect(supportsTemperature(m), m).toBe(true);
    }
  });

  it("omits temperature for OpenAI reasoning models, which reject it", () => {
    for (const m of ["o1", "o1-mini", "o3-mini", "o4-mini", "gpt-5", "gpt-5-mini"]) {
      expect(supportsTemperature(m), m).toBe(false);
    }
  });

  it("defaults to sending temperature when the model is unknown", () => {
    expect(supportsTemperature(undefined)).toBe(true);
  });

  it("ignores surrounding whitespace", () => {
    expect(supportsTemperature("  o3-mini ")).toBe(false);
  });
});
