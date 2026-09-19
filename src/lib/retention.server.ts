import { getDataStore } from "./data-store.server";
import { acquireShortLock } from "./short-lock.server";

/**
 * Retention sweep for operational tables.
 *
 * Nothing here is user-facing product data. Scans, issues, and repos are never touched.
 * What this deletes is exhaust: finished job rows, idempotency records, expired caches,
 * and stale locks, none of which is read again once its window closes.
 *
 * Left unswept these grow without bound — a storage and slow-query problem
 * long before it is an outage, which is exactly why it has to be automatic. A table
 * nobody prunes is one nobody notices until it is 50GB.
 *
 * The deletes live in the `run_retention_sweep` database operation so a neglected
 * installation can clean each table with one statement.
 */

export type RetentionResult = Record<string, number>;

/** Runs every purge and reports how many rows each one removed. */
export async function runRetentionSweep(): Promise<RetentionResult> {
  const db = getDataStore();
  const { data, error } = await db.rpc("run_retention_sweep");
  if (error) {
    console.error("[retention] sweep failed:", error.message);
    return {};
  }
  const counts = (data ?? {}) as Record<string, number>;
  return counts;
}

/**
 * Scheduler entry point. The local scheduler runs every 2 minutes; sweeping that often
 * would be 30 pointless delete scans an hour, so the lock doubles as the schedule —
 * it is taken for an hour and deliberately never released, and its TTL is what lets
 * the next sweep through. Whichever tick wins the hour does the work.
 */
export async function maybeRunRetentionSweep(): Promise<RetentionResult | null> {
  const got = await acquireShortLock("retention:sweep", 3600);
  if (!got) return null;
  return runRetentionSweep();
}

/** Summarises a sweep for the scheduler log, omitting tables with nothing to drop. */
export function formatRetentionResult(result: RetentionResult): string {
  const parts = Object.entries(result)
    .filter(([, n]) => n > 0)
    .map(([table, n]) => `${table}=${n}`);
  return parts.length > 0 ? parts.join(" ") : "nothing to purge";
}
