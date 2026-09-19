import { getDataStore } from "./data-store.server";

/**
 * Short-lived mutual exclusion for critical sections that span outbound API calls.
 *
 * The TTL lets an abandoned critical section recover without blocking later scheduled work.
 * It fails open when SQLite is unreachable because callers already fail on their next database
 * operation.
 */
export async function acquireShortLock(key: string, ttlSeconds: number): Promise<boolean> {
  const db = getDataStore();
  const { data, error } = await db.rpc("acquire_short_lock", {
    p_key: key,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) {
    console.error("[short-lock] acquire failed:", key, error.message);
    return true;
  }
  return data === true;
}

/** Idempotent — releasing a lock you no longer hold is a no-op. */
export async function releaseShortLock(key: string): Promise<void> {
  const db = getDataStore();
  const { error } = await db.rpc("release_short_lock", { p_key: key });
  if (error) console.error("[short-lock] release failed:", key, error.message);
}
