/**
 * E2B cost estimation from wall-clock duration.
 * Set E2B_USD_PER_MINUTE from your E2B rate card; 0/unset → duration-only (no $).
 */

export function e2bUsdPerMinute(): number {
  const n = Number.parseFloat(process.env.E2B_USD_PER_MINUTE ?? "0");
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function e2bRateConfigured(): boolean {
  return e2bUsdPerMinute() > 0;
}

/** Estimated $ for a run; null when rate unset or duration non-positive. */
export function estimateSandboxCostUsd(durationMs: number): number | null {
  const rate = e2bUsdPerMinute();
  if (rate <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  return Math.round((durationMs / 60_000) * rate * 10_000) / 10_000;
}

export function resolveSandboxDurationMs(opts: {
  discoveredDurationMs?: unknown;
  startedAt: Date;
  finishedAt: Date;
}): number {
  const d = opts.discoveredDurationMs;
  if (typeof d === "number" && Number.isFinite(d) && d >= 0) return Math.round(d);
  return Math.max(0, opts.finishedAt.getTime() - opts.startedAt.getTime());
}

/** Nearest-rank percentile; `sortedAsc` must be non-empty ascending numbers. */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const clamped = Math.min(100, Math.max(0, p));
  const idx = Math.ceil((clamped / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, idx)] ?? null;
}

export function durationPercentiles(durationsMs: number[]): {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  count: number;
} {
  const sorted = durationsMs
    .filter((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    count: sorted.length,
  };
}
