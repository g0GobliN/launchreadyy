/**
 * Background jobs — local Node.js runtime:
 *
 * - SQLite `background_jobs` = source of truth (payload, claims, retries, timeouts)
 * - Wakeups are in-process: an enqueue nudges the local worker loop directly; the
 *   loop's periodic sweep covers delayed jobs and anything missed while idle.
 *
 * Call sites use `enqueueJob()` only — swap dispatch without rewriting product code.
 */

import { getDataStore } from "./data-store.server";
import type { Database } from "./data-store.types";

export type BackgroundJob = () => Promise<unknown>;

export interface JobRunner {
  enqueue(job: BackgroundJob): void;
}

type BgJobRow = Database["public"]["Tables"]["background_jobs"]["Row"];

export type FixRunJobPayload = {
  type: "fix_run";
  fixRequestId: string;
  userLogin: string;
  repoFullName: string;
  effortScore: number;
  fixIds: string[];
  scanId: string;
};

export type FixRegenerateJobPayload = {
  type: "fix_regenerate";
  fixRequestId: string;
  userLogin: string;
  repoFullName: string;
  effortScore: number;
  fixIds: string[];
  scanId: string;
  feedback: string;
};

export type LiveSiteScanJobPayload = {
  type: "live_site_scan";
  liveScanId: string;
  userLogin: string;
  domain: string;
  repoId?: string | null;
};

export type SandboxVerifyJobPayload = {
  type: "sandbox_verify";
  runId: string;
  repoId: string;
  repoFullName: string;
  userLogin: string;
  defaultBranch: string;
  scanId?: string;
  fixRequestId?: string;
  branchName?: string;
  /** Opt-in test step (Capability 6) — off by default. */
  includeTest?: boolean;
  /** Leave room for a future build matrix without redesigning the payload. */
  runtimeVersion?: string;
};

/**
 * Watches GitHub's checks on a PR we opened, and repairs our own file when they fail.
 *
 * Re-enqueues itself with a future `available_at` rather than sleeping; the scheduler drain
 * picks due jobs back up.
 * CI runs take minutes, so 2-minute granularity costs nothing.
 */
export type CiWatchJobPayload = {
  type: "ci_watch";
  fixRequestId: string;
  repoId: string;
  repoFullName: string;
  userLogin: string;
  prNumber: number;
  branchName: string;
  /** How many automatic repairs have already been pushed. Capped in ci-watch.server. */
  attempt: number;
  /** Signature of the previous failure — if it repeats, we are not converging, so stop. */
  lastSignature?: string;
  /** Epoch ms after which we stop watching regardless of state. */
  deadlineAt: number;
};

/**
 * A repo scan run off the request path — the scheduled monitor tick, and the
 * scan a user starts by hand.
 *
 * Neither trigger carries a token: GitHub access is always the operator's own
 * `GITHUB_TOKEN`, resolved fresh at execution time, so a job that sits in the
 * queue for a while never runs on a value that could go stale.
 */
export type RepoScanJobPayload = {
  type: "repo_scan";
  repoId: string;
  userLogin: string;
  trigger: "monitor" | "manual";
  enqueueSandbox?: boolean;
};

export type DurableJobPayload =
  | FixRunJobPayload
  | FixRegenerateJobPayload
  | LiveSiteScanJobPayload
  | SandboxVerifyJobPayload
  | CiWatchJobPayload
  | RepoScanJobPayload;

// 8 min, not 4.5: a scan of a large repo on a slow connection spends minutes just pulling the
// tarball, and a sandbox run installs and builds the project. 4.5 killed both mid-flight.
const JOB_TIMEOUT_MS = 8 * 60 * 1000;
const STALE_SECONDS = 540; // 9 min — slightly above JOB_TIMEOUT_MS

// ─── Legacy fire-and-forget runner (non-durable closures) ──────────────────────

/**
 * Fire-and-forget runner. In Node there is no isolate death to race — `void` the
 * promise and let `unhandledRejection` (wired in the server entry) report failures.
 */
const fireAndForgetRunner: JobRunner = {
  enqueue(job) {
    void job().catch((e) => console.error("[job] fire-and-forget failed:", e));
  },
};

let runner: JobRunner = fireAndForgetRunner;

export function setJobRunner(next: JobRunner): void {
  runner = next;
}

export function resetJobRunner(): void {
  runner = fireAndForgetRunner;
}

export function getJobRunner(): JobRunner {
  return runner;
}

/** Non-durable: use only for work that need not survive isolate death. */
export function enqueueBackgroundJob(job: BackgroundJob): void {
  runner.enqueue(job);
}

export function createInlineJobRunner(): JobRunner & { drain: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    enqueue(job) {
      pending.push(Promise.resolve().then(job));
    },
    async drain() {
      await Promise.all(pending.splice(0));
    },
  };
}

// ─── Durable queue ────────────────────────────────────────────────────────────

function parsePayload(raw: unknown): DurableJobPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.type === "live_site_scan") {
    if (typeof p.liveScanId !== "string" || typeof p.domain !== "string") return null;
    return p as unknown as LiveSiteScanJobPayload;
  }
  if (p.type === "sandbox_verify") {
    if (
      typeof p.runId !== "string" ||
      typeof p.repoId !== "string" ||
      typeof p.repoFullName !== "string" ||
      typeof p.defaultBranch !== "string"
    ) {
      return null;
    }
    return p as unknown as SandboxVerifyJobPayload;
  }
  if (p.type === "repo_scan") {
    if (typeof p.repoId !== "string" || typeof p.userLogin !== "string") return null;
    return p as unknown as RepoScanJobPayload;
  }
  if (p.type === "ci_watch") {
    if (
      typeof p.fixRequestId !== "string" ||
      typeof p.repoId !== "string" ||
      typeof p.repoFullName !== "string" ||
      typeof p.userLogin !== "string" ||
      typeof p.prNumber !== "number" ||
      typeof p.branchName !== "string" ||
      typeof p.attempt !== "number" ||
      typeof p.deadlineAt !== "number"
    ) {
      return null;
    }
    return p as unknown as CiWatchJobPayload;
  }
  if (p.type !== "fix_run" && p.type !== "fix_regenerate") return null;
  if (typeof p.fixRequestId !== "string") return null;
  return p as unknown as DurableJobPayload;
}

async function markJob(
  id: string,
  patch: Database["public"]["Tables"]["background_jobs"]["Update"],
): Promise<void> {
  const db = getDataStore();
  await db
    .from("background_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * A deferral is a job that could not start because a shared resource was saturated, as
 * opposed to one that ran and failed. Recognised by name, not instanceof — the throwing
 * modules are imported dynamically, so they can be a different class identity.
 */
async function asDeferral(err: unknown): Promise<{ retryAfterSeconds: number } | null> {
  if (!(err instanceof Error)) return null;
  const { isSandboxPoolBusyError } = await import("./sandbox-verify/concurrency");
  if (isSandboxPoolBusyError(err)) return { retryAfterSeconds: err.retryAfterSeconds };
  return null;
}

/** Requeue without spending an attempt. Falls back to a plain patch if the RPC is missing. */
async function deferJob(id: string, delaySeconds: number, reason: string): Promise<void> {
  const db = getDataStore();
  const { error } = await db.rpc("defer_background_job", {
    p_id: id,
    p_delay_seconds: delaySeconds,
    p_reason: reason,
  });
  if (!error) return;

  // Database predates the RPC — requeue anyway. The attempt is not refunded here, which is
  // worse than the RPC path but still better than dropping the job.
  console.error("[durable-job] defer rpc failed, falling back:", error.message);
  await markJob(id, {
    status: "pending",
    last_error: reason,
    available_at: new Date(Date.now() + delaySeconds * 1_000).toISOString(),
    locked_at: null,
  });
}

async function executePayload(payload: DurableJobPayload): Promise<void> {
  if (payload.type === "live_site_scan") {
    const { processLiveSiteScanJob } = await import("./services/security/live-site-job.server");
    await processLiveSiteScanJob(payload);
    return;
  }

  if (payload.type === "ci_watch") {
    const { processCiWatchJob } = await import("./ci-watch.server");
    await processCiWatchJob(payload);
    return;
  }

  if (payload.type === "repo_scan") {
    const { processRepoScanJob } = await import("./services/repo-scan-job.server");
    const work = processRepoScanJob(payload);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Repo scan timed out after 8 minutes")), JOB_TIMEOUT_MS),
    );
    await Promise.race([work, timeout]);
    return;
  }

  if (payload.type === "sandbox_verify") {
    const { processSandboxVerifyJob } = await import("./sandbox-verify");
    const work = processSandboxVerifyJob(payload);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Sandbox verify timed out after 8 minutes")),
        JOB_TIMEOUT_MS,
      ),
    );
    await Promise.race([work, timeout]);
    return;
  }

  const { getGitHubToken } = await import("./github-token.server");
  const token = getGitHubToken();
  if (!token) {
    throw new Error("GITHUB_TOKEN is not configured — set it in .env, then retry.");
  }

  const { runFixJob, regenerateFixJob } = await import("./fix-job-runner.server");

  const work =
    payload.type === "fix_run"
      ? runFixJob(
          payload.fixRequestId,
          payload.repoFullName,
          payload.userLogin,
          payload.effortScore,
          payload.fixIds,
          payload.scanId,
          token,
        )
      : regenerateFixJob(
          payload.fixRequestId,
          payload.repoFullName,
          payload.userLogin,
          payload.effortScore,
          payload.fixIds,
          payload.scanId,
          token,
          payload.feedback,
        );

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Fix job timed out after 8 minutes")), JOB_TIMEOUT_MS),
  );
  await Promise.race([work, timeout]);
}

async function failFixRequest(payload: DurableJobPayload, message: string): Promise<void> {
  if (payload.type === "live_site_scan") {
    const db = getDataStore();
    await db
      .from("live_site_scans")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        results: [{ error: message }],
      })
      .eq("id", payload.liveScanId)
      .then(
        () => {},
        (e: unknown) => console.error("[durable-job] mark live_site_scan failed:", e),
      );
    return;
  }

  // A watch that fails leaves the PR exactly as it was — open, with whatever CI said. There is
  // nothing to roll back and nothing to mark failed: the fix itself
  // succeeded, only our observation of it broke.
  if (payload.type === "ci_watch") {
    console.error(`[durable-job] ci_watch failed for PR #${payload.prNumber}: ${message}`);
    return;
  }

  if (payload.type === "sandbox_verify") {
    const db = getDataStore();
    await db
      .from("sandbox_verify_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", payload.runId)
      .then(
        () => {},
        (e: unknown) => console.error("[durable-job] mark sandbox_verify failed:", e),
      );
    return;
  }

  // A failed monitor scan writes no user-visible row — the
  // previous scan simply stands until the next tick. Nothing to roll back or mark.
  if (payload.type === "repo_scan") {
    console.error(`[durable-job] repo_scan failed for ${payload.repoId}: ${message}`);
    return;
  }

  const db = getDataStore();
  await db
    .from("fix_requests")
    .update({
      status: "failed",
      error_message: message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.fixRequestId)
    .then(
      () => {},
      (e: unknown) => console.error("[durable-job] mark fix_request failed:", e),
    );
}

/** Claim + execute one job (by id, or next pending). */
export async function processDurableJob(jobId?: string): Promise<boolean> {
  const db = getDataStore();
  const { data, error } = await db.rpc("claim_background_job", {
    p_id: jobId ?? null,
  });
  if (error) {
    console.error("[durable-job] claim failed:", error.message);
    return false;
  }
  const row = (Array.isArray(data) ? data[0] : data) as BgJobRow | undefined;
  if (!row) return false;

  const payload = parsePayload(row.payload);
  if (!payload) {
    await markJob(row.id, {
      status: "failed",
      last_error: "Invalid job payload",
      completed_at: new Date().toISOString(),
      payload: {},
    });
    return true;
  }

  try {
    await executePayload(payload);
    await markJob(row.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      last_error: null,
      payload: { ...payload },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown job error";

    // Deferral is not failure — the work never started, so it must not spend an attempt or
    // the job hard-fails after three unlucky ticks during a spike. Requeue on a longer,
    // jittered delay than the soft-fail path: whatever is saturated needs time to drain,
    // and a herd retrying in lockstep just re-collides.
    const deferral = await asDeferral(err);
    if (deferral) {
      await deferJob(row.id, deferral.retryAfterSeconds, message);
      dispatchJobWakeup(row.id, deferral.retryAfterSeconds);
      return true;
    }

    console.error(`[durable-job] ${row.kind} ${row.id} failed:`, message);
    const giveUp = row.attempts >= row.max_attempts;
    if (giveUp) {
      await failFixRequest(payload, message);
      await markJob(row.id, {
        status: "failed",
        last_error: message,
        completed_at: new Date().toISOString(),
        payload: { ...payload },
      });
    } else {
      await markJob(row.id, {
        status: "pending",
        last_error: message,
        available_at: new Date(Date.now() + 5_000).toISOString(),
        locked_at: null,
      });
      // Wake the worker again after a soft failure; the poll covers the rest.
      dispatchJobWakeup(row.id);
    }
  }
  return true;
}

/** Requeue stuck running jobs, then process a few pending ones. */
export async function drainDurableJobs(limit = 3): Promise<void> {
  const db = getDataStore();
  try {
    await db.rpc("reclaim_stuck_background_jobs", { p_stale_seconds: STALE_SECONDS });
  } catch (e) {
    console.error("[durable-job] reclaim failed:", e);
  }
  for (let i = 0; i < limit; i++) {
    const did = await processDurableJob();
    if (!did) break;
  }
}

/**
 * Wake the local worker loop. The in-process loop owns all timing — a delay just
 * tells it when to look again; nothing is delivered early because the claim is
 * transactional and re-checks `available_at`.
 */
export function dispatchJobWakeup(_jobId?: string, _delaySeconds?: number): "worker" {
  wakeJobWorker();
  return "worker";
}

/**
 * Persist a job, then wake the in-process worker.
 */
export async function enqueueDurableJob(
  payload: DurableJobPayload,
  /** Seconds to hold the job before a worker may claim it. Polling loops use this instead of
   *  sleeping — `background_jobs.available_at` already gates the drain query. */
  delaySeconds = 0,
): Promise<string> {
  const db = getDataStore();
  const id = crypto.randomUUID();
  const { error } = await db.from("background_jobs").insert({
    id,
    kind: payload.type,
    payload: payload as unknown as Record<string, unknown>,
    status: "pending",
    ...(delaySeconds > 0
      ? { available_at: new Date(Date.now() + delaySeconds * 1000).toISOString() }
      : {}),
  });
  if (error) throw new Error(`Failed to enqueue job: ${error.message}`);

  try {
    await db.rpc("reclaim_stuck_background_jobs", { p_stale_seconds: STALE_SECONDS });
  } catch {
    /* non-fatal */
  }

  // A delayed job waits for the polling loop; an immediate wakeup would only observe a
  // not-yet-available row.
  if (delaySeconds <= 0) dispatchJobWakeup(id);
  return id;
}

/** Kick the local worker loop (cheap when the queue is empty). */
export function scheduleDurableJobDrain(): void {
  wakeJobWorker();
}

// ─── Local worker loop ────────────────────────────────────────────────────────

/** Idle poll interval. The wakeup path short-circuits this; it's a safety net. */
const WORKER_POLL_MS = 10_000;
/** Re-run the loop at most this often after a wakeup burst. */
const WORKER_MIN_INTERVAL_MS = 250;

let workerTimer: ReturnType<typeof setInterval> | null = null;
let workerRunning = false;
let lastTickAt = 0;
let wakeupPending = false;

function wakeJobWorker(): void {
  wakeupPending = true;
  if (!workerTimer) startJobWorker();
}

/**
 * Start the in-process job worker. Called automatically on first enqueue and
 * explicitly by the server entry at boot; safe to call repeatedly.
 */
export function startJobWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void runWorkerTick();
  }, WORKER_POLL_MS);
  // Don't hold the process open just for polling — the HTTP server keeps it alive.
  workerTimer.unref?.();
  void runWorkerTick();
}

/** Stop the worker loop (tests, graceful shutdown). */
export function stopJobWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

async function runWorkerTick(): Promise<void> {
  if (workerRunning) return;
  const now = Date.now();
  if (now - lastTickAt < WORKER_MIN_INTERVAL_MS) return;
  workerRunning = true;
  wakeupPending = false;
  try {
    await drainDurableJobs(3);
  } catch (e) {
    console.error("[durable-job] worker tick failed:", e);
  } finally {
    workerRunning = false;
    lastTickAt = Date.now();
    if (wakeupPending) void runWorkerTick();
  }
}
