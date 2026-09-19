/**
 * SQLite implementations of the data-store RPC interface.
 *
 * The remote database ran these as SQL functions for atomicity; here SQLite's
 * serialised writes inside one process give the same guarantees with plain
 * statements.
 */

import { db } from "@/db/client";

export interface RpcError {
  message: string;
}
export interface RpcResult {
  data: unknown;
  error: RpcError | null;
  count?: number;
}

type Row = Record<string, unknown>;

function ok(data: unknown): RpcResult {
  return { data, error: null };
}
function fail(message: string): RpcResult {
  return { data: null, error: { message } };
}

// ─── Background job queue ─────────────────────────────────────────────────────

type ClaimedJob = {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
};

function parsePayload(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Claim one due job: transactionally flip `pending → running` and return the row.
 * Two concurrent claims can never both win — the UPDATE is verified against
 * `changes` inside the same transaction that selected the row.
 */
export function claimBackgroundJob(jobId: string | null): RpcResult {
  const now = new Date().toISOString();
  const claimed = db.transaction((): ClaimedJob | null => {
    const row = (
      jobId
        ? db
            .prepare(
              `SELECT id, kind, payload, max_attempts FROM background_jobs
               WHERE id = ? AND status = 'pending' AND available_at <= ?`,
            )
            .get(jobId, now)
        : db
            .prepare(
              `SELECT id, kind, payload, max_attempts FROM background_jobs
               WHERE status = 'pending' AND available_at <= ?
               ORDER BY available_at ASC, created_at ASC
               LIMIT 1`,
            )
            .get(now)
    ) as { id: string; kind: string; payload: string; max_attempts: number } | undefined;
    if (!row) return null;

    const res = db
      .prepare(
        `UPDATE background_jobs
         SET status = 'running', locked_at = ?, updated_at = ?, attempts = attempts + 1
         WHERE id = ? AND status = 'pending'`,
      )
      .run(now, now, row.id);
    if (res.changes !== 1) return null;

    const attempts = (
      db.prepare("SELECT attempts FROM background_jobs WHERE id = ?").get(row.id) as Row
    ).attempts as number;
    return {
      id: row.id,
      kind: row.kind,
      payload: parsePayload(row.payload),
      attempts,
      max_attempts: row.max_attempts,
    };
  })();

  return ok(claimed);
}

/**
 * Process a batch of `{ jobId }` wakeup messages.
 * Idempotent: claim fails quietly when a job is already running/done.
 * The local worker's direct-drain path covers the same ground in-process.
 */
export async function handleDurableJobQueueBatch(
  messages: Array<{ body: unknown; ack: () => void; retry: () => void }>,
  processOne: (jobId: string) => Promise<void>,
): Promise<void> {
  for (const message of messages) {
    const body = message.body as { jobId?: unknown } | null;
    const jobId = typeof body?.jobId === "string" ? body.jobId : null;
    if (!jobId) {
      console.error("[durable-job] queue message missing jobId:", message.body);
      message.ack();
      continue;
    }
    try {
      await processOne(jobId);
      message.ack();
    } catch (e) {
      console.error(`[durable-job] queue consumer failed for ${jobId}:`, e);
      message.retry();
    }
  }
}

/** Put a `running` job whose lock went stale back in the queue. Returns rows requeued. */
export function reclaimStuckBackgroundJobs(staleSeconds: number): RpcResult {
  const cutoff = new Date(Date.now() - staleSeconds * 1000).toISOString();
  const res = db
    .prepare(
      `UPDATE background_jobs
       SET status = 'pending', locked_at = NULL, updated_at = ?
       WHERE status = 'running' AND locked_at IS NOT NULL AND locked_at < ?`,
    )
    .run(new Date().toISOString(), cutoff);
  return ok(res.changes);
}

/** Requeue without spending an attempt — the shared resource was saturated, not broken. */
export function deferBackgroundJob(id: string, delaySeconds: number, reason: string): RpcResult {
  const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  db.prepare(
    `UPDATE background_jobs
     SET status = 'pending', locked_at = NULL, last_error = ?, available_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(reason, availableAt, new Date().toISOString(), id);
  return ok(true);
}

// ─── Rate limiting (abuse protection — kept; it protects the operator's tokens) ──

export function checkRateLimit(key: string, max: number, windowSeconds: number): RpcResult {
  const now = Date.now();
  const row = db
    .prepare("SELECT count, reset_at FROM rate_limit_hits WHERE bucket_key = ?")
    .get(key) as { count: number; reset_at: string } | undefined;

  if (!row || new Date(row.reset_at).getTime() <= now) {
    const resetAt = new Date(now + windowSeconds * 1000).toISOString();
    db.prepare(
      `INSERT INTO rate_limit_hits (bucket_key, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET count = 1, reset_at = excluded.reset_at`,
    ).run(key, resetAt);
    return ok({ allowed: true, count: 1, retry_after: 0 });
  }

  const count = row.count + 1;
  db.prepare("UPDATE rate_limit_hits SET count = ? WHERE bucket_key = ?").run(count, key);
  const retryAfter = Math.max(1, Math.ceil((new Date(row.reset_at).getTime() - now) / 1000));
  return ok({ allowed: count <= max, count, retry_after: retryAfter });
}

// ─── Short-lived mutex (retention sweeps, monitor ticks) ──────────────────────

export function acquireShortLock(key: string, ttlSeconds: number): RpcResult {
  const now = Date.now();
  const row = db.prepare("SELECT acquired_at FROM short_locks WHERE lock_key = ?").get(key) as
    | { acquired_at: string }
    | undefined;
  if (row && now - new Date(row.acquired_at).getTime() < ttlSeconds * 1000) return ok(false);
  db.prepare(
    `INSERT INTO short_locks (lock_key, acquired_at) VALUES (?, ?)
     ON CONFLICT(lock_key) DO UPDATE SET acquired_at = excluded.acquired_at`,
  ).run(key, new Date(now).toISOString());
  return ok(true);
}

export function releaseShortLock(key: string): RpcResult {
  db.prepare("DELETE FROM short_locks WHERE lock_key = ?").run(key);
  return ok(true);
}

// ─── Sandbox concurrency slots ────────────────────────────────────────────────

export function acquireSandboxSlot(runId: string, max: number, staleSeconds: number): RpcResult {
  const cutoff = new Date(Date.now() - staleSeconds * 1000).toISOString();
  db.prepare("DELETE FROM sandbox_slots WHERE acquired_at < ?").run(cutoff);
  const count = (db.prepare("SELECT COUNT(*) AS c FROM sandbox_slots").get() as { c: number }).c;
  if (count >= max) return ok(false);
  db.prepare(
    `INSERT INTO sandbox_slots (run_id, acquired_at) VALUES (?, ?)
     ON CONFLICT(run_id) DO UPDATE SET acquired_at = excluded.acquired_at`,
  ).run(runId, new Date().toISOString());
  return ok(true);
}

export function releaseSandboxSlot(runId: string): RpcResult {
  db.prepare("DELETE FROM sandbox_slots WHERE run_id = ?").run(runId);
  return ok(true);
}

// ─── Retention sweep ──────────────────────────────────────────────────────────

const RETENTION_DAYS: Record<string, number> = {
  scans: 90,
  issues: 90,
  background_jobs: 30,
  ai_usage: 180,
  ai_test_cache: 90,
  sandbox_verify_runs: 180,
  security_events: 180,
  category_score_history: 180,
  rate_limit_hits: 1,
};

function purgeTable(table: string, days: number, timeColumn = "created_at"): number {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    return db.prepare(`DELETE FROM ${table} WHERE ${timeColumn} < ?`).run(cutoff).changes;
  } catch {
    return 0;
  }
}

export function runRetentionSweep(): RpcResult {
  const counts: Record<string, number> = {};
  counts.scans = purgeTable("scans", RETENTION_DAYS.scans!);
  counts.issues = purgeTable("issues", RETENTION_DAYS.issues!);
  counts.background_jobs = purgeTable("background_jobs", RETENTION_DAYS.background_jobs!);
  counts.ai_usage = purgeTable("ai_usage", RETENTION_DAYS.ai_usage!);
  counts.ai_test_cache = purgeTable("ai_test_cache", RETENTION_DAYS.ai_test_cache!);
  counts.sandbox_verify_runs = purgeTable(
    "sandbox_verify_runs",
    RETENTION_DAYS.sandbox_verify_runs!,
  );
  counts.security_events = purgeTable("security_events", RETENTION_DAYS.security_events!);
  counts.category_score_history = purgeTable(
    "category_score_history",
    RETENTION_DAYS.category_score_history!,
  );
  counts.rate_limit_hits = purgeTable("rate_limit_hits", RETENTION_DAYS.rate_limit_hits!);
  return ok(counts);
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function rpc(name: string, args: Record<string, unknown> = {}): Promise<RpcResult> {
  try {
    switch (name) {
      case "claim_background_job":
        return claimBackgroundJob((args.p_id as string | null) ?? null);
      case "reclaim_stuck_background_jobs":
        return reclaimStuckBackgroundJobs(Number(args.p_stale_seconds ?? 540));
      case "defer_background_job":
        return deferBackgroundJob(
          String(args.p_id ?? ""),
          Number(args.p_delay_seconds ?? 30),
          String(args.p_reason ?? "deferred"),
        );
      case "check_rate_limit":
        return checkRateLimit(
          String(args.p_key ?? ""),
          Number(args.p_max ?? 10),
          Number(args.p_window_seconds ?? 60),
        );
      case "acquire_short_lock":
        return acquireShortLock(String(args.p_key ?? ""), Number(args.p_ttl_seconds ?? 30));
      case "release_short_lock":
        return releaseShortLock(String(args.p_key ?? ""));
      case "acquire_sandbox_slot":
        return acquireSandboxSlot(
          String(args.p_run_id ?? ""),
          Number(args.p_max ?? 1),
          Number(args.p_stale_seconds ?? 900),
        );
      case "release_sandbox_slot":
        return releaseSandboxSlot(String(args.p_run_id ?? ""));
      case "run_retention_sweep":
        return runRetentionSweep();
      default:
        return fail(`Unknown RPC: ${name}`);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
