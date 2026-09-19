/**
 * Global cap on how many sandboxes run at once, across every user.
 *
 * Nothing else bounds parallelism: queue consumers scale on demand, so a spike fires as
 * many sandbox creates as there are pending jobs. Past the provider account's concurrency
 * ceiling those creates are rejected, and because scans block on verification the user
 * sees no results rather than late ones.
 *
 * A slot is permission to run one sandbox. No slot → the job waits its turn instead of
 * failing (see defer_background_job in schema.sql).
 */

import { getDataStore } from "../data-store.server";
import { SANDBOX_TIMEOUT_MS } from "../fix-meta";

/**
 * Pool size when SANDBOX_MAX_CONCURRENT is unset. Deliberately conservative — a cap below
 * the provider's real ceiling only adds queue wait, while a cap above it does nothing at
 * all. Raise it to match the account's actual limit.
 */
const DEFAULT_MAX_CONCURRENT = 8;

/**
 * Headroom past the sandbox time budget before a slot counts as abandoned. Covers the work
 * bracketing the timed run — clone, image pull, and the final result writes.
 */
const STALE_MARGIN_MS = 120_000;

/** Base wait before a deferred run retries. */
const RETRY_BASE_SECONDS = 15;
/** Jitter span, so a backlog released at once doesn't retry in lockstep and re-collide. */
const RETRY_JITTER_SECONDS = 15;

export function maxConcurrentSandboxes(): number {
  const raw = process.env.SANDBOX_MAX_CONCURRENT;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CONCURRENT;
}

export function slotStaleSeconds(): number {
  return Math.ceil((SANDBOX_TIMEOUT_MS + STALE_MARGIN_MS) / 1000);
}

export function busyRetrySeconds(): number {
  return RETRY_BASE_SECONDS + Math.floor(Math.random() * RETRY_JITTER_SECONDS);
}

/** Thrown when the pool is full. Means "retry later", never "this run failed". */
export class SandboxPoolBusyError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("All sandbox slots are busy — this run starts as soon as one frees up.");
    this.name = "SandboxPoolBusyError";
  }
}

/** Name check, not instanceof — the job runner imports this module dynamically. */
export function isSandboxPoolBusyError(err: unknown): err is SandboxPoolBusyError {
  return err instanceof Error && err.name === "SandboxPoolBusyError";
}

/**
 * Reserve a slot, or throw {@link SandboxPoolBusyError}.
 *
 * Fails closed on an unreachable counter, matching the metered rate-limit tiers: an
 * unverifiable cap is not a cap, and it would give out exactly when load is high enough to
 * break the counter. Deferring costs a wait; overshooting costs rejected runs.
 */
export async function acquireSandboxSlot(runId: string): Promise<void> {
  let granted = false;
  try {
    const { data, error } = await getDataStore().rpc("acquire_sandbox_slot", {
      p_run_id: runId,
      p_max: maxConcurrentSandboxes(),
      p_stale_seconds: slotStaleSeconds(),
    });
    if (error) {
      console.error("[sandbox-slot] acquire failed:", error.message);
    } else {
      granted = data === true;
    }
  } catch (err) {
    console.error("[sandbox-slot] acquire threw:", err);
  }
  if (!granted) throw new SandboxPoolBusyError(busyRetrySeconds());
}

/**
 * Hand the slot back. Never throws — a release failure must not mask the run's real
 * outcome, and the stale sweep inside acquire_sandbox_slot reclaims what leaks.
 */
export async function releaseSandboxSlot(runId: string): Promise<void> {
  try {
    const { error } = await getDataStore().rpc("release_sandbox_slot", {
      p_run_id: runId,
    });
    if (error) console.error("[sandbox-slot] release failed:", error.message);
  } catch (err) {
    console.error("[sandbox-slot] release threw:", err);
  }
}
