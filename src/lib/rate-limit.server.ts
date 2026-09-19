type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Tiers that spend real money per call — model tokens and E2B compute. There is no
 * login, checkout or feedback surface in the Community build, so these are the only
 * metered paths left.
 */
export type RateLimitTier = "scan" | "ai" | "sandbox";

const LIMITS: Record<RateLimitTier, { max: number; windowMs: number }> = {
  scan: { max: 6, windowMs: 60_000 },
  ai: { max: 6, windowMs: 60_000 },
  sandbox: { max: 4, windowMs: 60_000 },
};

function pruneExpired(now: number) {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

/**
 * Per-process in-memory limiter. Fast, but only a best-effort first line — the state is
 * per-process and ephemeral, so a restart forgets it. enforceRateLimit() layers the
 * durable SQLite counter on top. Throws if the key exceeded its tier limit. No-op when
 * RATE_LIMIT_DISABLED=1.
 */
export function checkRateLimit(tier: RateLimitTier, key: string): void {
  if (process.env.RATE_LIMIT_DISABLED === "1") return;

  const { max, windowMs } = LIMITS[tier];
  const now = Date.now();
  pruneExpired(now);

  const id = `${tier}:${key}`;
  let bucket = buckets.get(id);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(id, bucket);
  }

  bucket.count += 1;
  if (bucket.count > max) {
    const retrySec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    throw new Error(`Too many requests. Try again in ${retrySec} seconds.`);
  }
}

/**
 * Thrown when a metered tier cannot confirm headroom. Distinct from a real limit hit.
 *
 * Every tier fails closed on purpose. The in-memory bucket is per-process, so under
 * concurrency it is close to no limit at all; the tiers that remain all spend real money
 * per call (model tokens and E2B compute), and an unavailable limiter is a cost-DoS window
 * with an unrecoverable bill. The practical cost is low — the counter lives in the same
 * SQLite file as everything else, so if it is unreachable, scans and fixes cannot run
 * anyway.
 */
export class RateLimitUnavailableError extends Error {
  constructor() {
    super("Rate limiting is temporarily unavailable. Please try again in a moment.");
    this.name = "RateLimitUnavailableError";
  }
}

/**
 * Authoritative rate-limit check. Applies the fast in-memory layer first (catches
 * same-process floods instantly), then the durable SQLite-backed counter that survives
 * restarts and aggregates hits across every concurrent request.
 *
 * If the durable layer is unavailable, the request is rejected with
 * {@link RateLimitUnavailableError} rather than let an unmetered call through.
 */
export async function enforceRateLimit(tier: RateLimitTier, key: string): Promise<void> {
  // In-memory first — throws (and short-circuits the DB round-trip) on same-process floods.
  checkRateLimit(tier, key);

  if (process.env.RATE_LIMIT_DISABLED === "1") return;
  // Keep unit tests hermetic — the in-memory layer above is what those exercise.
  if (process.env.NODE_ENV === "test") return;

  const { max, windowMs } = LIMITS[tier];

  let result: { allowed: boolean; retry_after: number } | null = null;
  let failure: string | null = null;
  try {
    const { getDataStore } = await import("./data-store.server");
    const { data, error } = (await getDataStore().rpc("check_rate_limit", {
      p_key: `${tier}:${key}`,
      p_max: max,
      p_window_seconds: Math.ceil(windowMs / 1000),
    })) as { data: unknown; error: { message: string } | null };
    if (error) failure = error.message;
    else result = data as { allowed: boolean; retry_after: number };
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }

  if (failure !== null) {
    console.error(`[rate-limit] durable counter unavailable for ${tier}: ${failure}`);
    throw new RateLimitUnavailableError();
  }

  if (result && result.allowed === false) {
    const retry = Math.max(1, result.retry_after ?? 1);
    throw new Error(`Too many requests. Try again in ${retry} seconds.`);
  }
}

export async function rateLimitByIp(tier: RateLimitTier, ip: string): Promise<void> {
  await enforceRateLimit(tier, `ip:${ip || "unknown"}`);
}

export async function rateLimitByUser(tier: RateLimitTier, login: string): Promise<void> {
  // Community: no accounts to ban; rate limiting still protects the operator's
  // own GitHub/E2B/AI accounts from runaway loops.
  await enforceRateLimit(tier, `user:${login}`);
}

/** @internal test helper */
export function resetRateLimitsForTests(): void {
  buckets.clear();
}
