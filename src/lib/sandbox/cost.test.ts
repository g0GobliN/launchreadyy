import { afterEach, describe, expect, it } from "vitest";
import {
  durationPercentiles,
  estimateSandboxCostUsd,
  percentile,
  resolveSandboxDurationMs,
} from "./cost";

describe("resolveSandboxDurationMs", () => {
  it("prefers discovered durationMs", () => {
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const finishedAt = new Date("2026-01-01T00:02:00Z");
    expect(
      resolveSandboxDurationMs({
        discoveredDurationMs: 12_345,
        startedAt,
        finishedAt,
      }),
    ).toBe(12_345);
  });

  it("falls back to wall clock", () => {
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const finishedAt = new Date("2026-01-01T00:01:30Z");
    expect(resolveSandboxDurationMs({ startedAt, finishedAt })).toBe(90_000);
  });
});

describe("estimateSandboxCostUsd", () => {
  const prev = process.env.E2B_USD_PER_MINUTE;

  afterEach(() => {
    if (prev === undefined) delete process.env.E2B_USD_PER_MINUTE;
    else process.env.E2B_USD_PER_MINUTE = prev;
  });

  it("returns null when rate unset", () => {
    delete process.env.E2B_USD_PER_MINUTE;
    expect(estimateSandboxCostUsd(60_000)).toBeNull();
  });

  it("estimates from duration × rate", () => {
    process.env.E2B_USD_PER_MINUTE = "0.10";
    expect(estimateSandboxCostUsd(60_000)).toBe(0.1);
    expect(estimateSandboxCostUsd(90_000)).toBe(0.15);
  });
});

describe("percentile / durationPercentiles", () => {
  it("nearest-rank P50/P95/P99", () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(100);
    expect(percentile(sorted, 99)).toBe(100);
  });

  it("aggregates durations", () => {
    const r = durationPercentiles([1000, 2000, 3000, 4000]);
    expect(r.count).toBe(4);
    expect(r.p50).toBe(2000);
    expect(r.p95).toBe(4000);
  });
});
