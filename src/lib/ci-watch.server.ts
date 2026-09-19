/**
 * Watches GitHub's checks on a PR we opened and repairs our own file when they fail.
 *
 * Why this exists: a generated fix can be correct in isolation and still break the repo's CI —
 * invalid workflow YAML, a file that fails the repo's own `prettier --check`, a Node version its
 * tooling rejects. Every one of those shipped to users before this existed, and the user's only
 * recourse was to close the PR. See `fix-recovery.server.ts` for the signature table.
 *
 * Shape: one PR, repair commits pushed to the same branch. GitHub already renders a commit list
 * with a diff and a check result per commit, so "what changed between attempts" is native rather
 * than something we reinvent. New PRs per attempt would litter the repo with orphan branches and
 * split the review; a force-pushed amend would hide the history, which is worse than either.
 */
import { getDataStore } from "./data-store.server";
import { enqueueDurableJob, type CiWatchJobPayload } from "./jobs.server";
import { getGitHubToken, GITHUB_TOKEN_MISSING } from "./github-token.server";
import { ghGet } from "./fix-executor/github";
import { commitFilesOnBranch } from "./fix-executor/pr";
import {
  matchErrorPattern,
  parseStoredHashes,
  scopeForSignature,
  type GeneratedFileRecord,
} from "./fix-recovery.server";

/** Automatic repair pushes. Matches verifyBeforePr's MAX_RETRIES — each one costs the user a
 *  GitHub Actions run, so this is deliberately small. */
export const MAX_AUTO_ATTEMPTS = 2;
const POLL_SECONDS = 120;
/** Stop watching after this long even if checks never settle. */
export const WATCH_WINDOW_MS = 25 * 60 * 1000;
const MAX_LOG_BYTES = 60_000;

export type CheckState = "pending" | "passed" | "failed";

type CheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
  id: number;
};

/**
 * Collapse GitHub's check runs into one state.
 *
 * `skipped` and `neutral` are not failures — a workflow that skips a job on a path filter is
 * working as designed. Anything still queued or running keeps the whole thing pending, because
 * acting on a partial result would repair against a failure that a later job explains.
 */
export function summariseChecks(runs: CheckRun[]): CheckState {
  if (runs.length === 0) return "pending";
  if (runs.some((r) => r.status !== "completed")) return "pending";
  const failed = runs.filter(
    (r) => r.conclusion && !["success", "skipped", "neutral"].includes(r.conclusion),
  );
  return failed.length > 0 ? "failed" : "passed";
}

/** True when the branch tip is no longer the commit we last pushed — the user has taken over. */
export function userHasPushed(headSha: string, ourLastSha: string | null): boolean {
  return Boolean(ourLastSha) && headSha !== ourLastSha;
}

async function fetchFailingLog(
  token: string,
  repoFullName: string,
  runs: CheckRun[],
): Promise<string> {
  const failing = runs.filter(
    (r) => r.conclusion && !["success", "skipped", "neutral"].includes(r.conclusion),
  );
  const chunks: string[] = [];
  for (const run of failing.slice(0, 3)) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoFullName}/actions/jobs/${run.id}/logs`,
        { headers: { Authorization: `Bearer ${token}`, "User-Agent": "LaunchReadyy" } },
      );
      if (!res.ok) continue;
      const text = await res.text();
      // Tail, not head: the failure and its message are at the end, while the head is setup noise.
      chunks.push(`### ${run.name}\n${text.slice(-MAX_LOG_BYTES / 2)}`);
    } catch {
      /* a log that won't download is not a reason to abandon the run */
    }
  }
  // Name the failing checks even when no log came back — "0 jobs, no logs" is itself the
  // signature of a workflow GitHub refused to load.
  if (chunks.length === 0) {
    return failing.map((r) => `${r.name}: ${r.conclusion}`).join("\n");
  }
  return chunks.join("\n\n").slice(0, MAX_LOG_BYTES);
}

async function recordAttempt(input: {
  fixRequestId: string;
  userLogin: string;
  errorLog: string;
  signature: string;
  resolution: string;
  attempt: number;
  prUrl?: string | null;
}): Promise<void> {
  const db = getDataStore();
  await db
    .from("fix_recoveries")
    .insert({
      fix_request_id: input.fixRequestId,
      user_login: input.userLogin,
      error_log: input.errorLog.slice(0, 10_000),
      error_signature: input.signature,
      tier: 1,
      drift_level: "pristine",
      resolution_type: input.resolution,
      patch_pr_url: input.prUrl ?? null,
      attempt_count: input.attempt,
      // No effort tier: the loop only ever runs because our own PR broke their CI.
      ai_effort: 0,
    })
    .then(
      () => {},
      (e: unknown) => console.error("[ci-watch] failed to record attempt:", e),
    );
}

async function stopWatching(fixRequestId: string, note: string): Promise<void> {
  const db = getDataStore();
  await db
    .from("fix_requests")
    .update({ error_message: note, updated_at: new Date().toISOString() })
    .eq("id", fixRequestId);
}

export async function processCiWatchJob(payload: CiWatchJobPayload): Promise<void> {
  if (Date.now() > payload.deadlineAt) {
    await stopWatching(payload.fixRequestId, "Stopped watching CI — checks never settled.");
    return;
  }

  const token = getGitHubToken();
  if (!token) throw new Error(GITHUB_TOKEN_MISSING);

  const db = getDataStore();
  const { data: fixRequest } = await db
    .from("fix_requests")
    .select("generated_file_hashes, pr_url, status")
    .eq("id", payload.fixRequestId)
    .maybeSingle();

  // The user merged, closed, or moved on — nothing left to watch.
  if (!fixRequest || fixRequest.status === "completed" || fixRequest.status === "cancelled") return;

  const head = await ghGet<{ head: { sha: string } }>(
    token,
    `/repos/${payload.repoFullName}/pulls/${payload.prNumber}`,
  );
  const headSha = head.head.sha;

  const checks = await ghGet<{ check_runs: CheckRun[] }>(
    token,
    `/repos/${payload.repoFullName}/commits/${headSha}/check-runs`,
  );
  const state = summariseChecks(checks.check_runs ?? []);

  if (state === "pending") {
    await enqueueDurableJob({ ...payload }, POLL_SECONDS);
    return;
  }

  if (state === "passed") {
    await stopWatching(payload.fixRequestId, "");
    return;
  }

  // ── Failed ────────────────────────────────────────────────────────────────────────────────
  const errorLog = await fetchFailingLog(token, payload.repoFullName, checks.check_runs ?? []);
  const records: GeneratedFileRecord[] = parseStoredHashes(fixRequest.generated_file_hashes);
  const match = matchErrorPattern(errorLog, records);
  const signature = match?.errorSignature ?? "unrecognised";
  const scope = match ? scopeForSignature(signature) : "unknown";

  // Not ours. Report it — repairing our config until someone else's failing test goes green
  // would bury exactly the kind of gap this product exists to surface.
  if (scope === "theirs") {
    await recordAttempt({
      fixRequestId: payload.fixRequestId,
      userLogin: payload.userLogin,
      errorLog,
      signature,
      resolution: "diagnosis",
      attempt: payload.attempt,
    });
    await stopWatching(payload.fixRequestId, match?.rootCause ?? "");
    return;
  }

  // The same failure twice means the repair is not working. Stop rather than burn another of
  // the user's CI runs on it.
  if (payload.lastSignature && payload.lastSignature === signature) {
    await recordAttempt({
      fixRequestId: payload.fixRequestId,
      userLogin: payload.userLogin,
      errorLog,
      signature,
      resolution: "escalated",
      attempt: payload.attempt,
    });
    await stopWatching(
      payload.fixRequestId,
      "Tried to fix this twice and hit the same failure — handing it over.",
    );
    return;
  }

  if (payload.attempt >= MAX_AUTO_ATTEMPTS || !match?.patch) {
    await recordAttempt({
      fixRequestId: payload.fixRequestId,
      userLogin: payload.userLogin,
      errorLog,
      signature,
      resolution: match?.patch ? "escalated" : "diagnosis",
      attempt: payload.attempt,
    });
    await stopWatching(payload.fixRequestId, match?.rootCause ?? "");
    return;
  }

  // Never fight a human on their own branch.
  const ourLastSha = (fixRequest.generated_file_hashes as { lastSha?: string } | null)?.lastSha;
  if (userHasPushed(headSha, ourLastSha ?? null)) {
    await stopWatching(
      payload.fixRequestId,
      "You've pushed to this branch, so automatic fixes are paused.",
    );
    return;
  }

  const nextAttempt = payload.attempt + 1;
  await commitFilesOnBranch(
    token,
    payload.repoFullName,
    payload.branchName,
    [{ path: match.patch.path, content: match.patch.content }],
    `fix: ${match.rootCause.split(".")[0].toLowerCase()}\n\nAutomatic repair ${nextAttempt}/${MAX_AUTO_ATTEMPTS} after CI failed.\nSignature: ${signature}`,
  );

  await recordAttempt({
    fixRequestId: payload.fixRequestId,
    userLogin: payload.userLogin,
    errorLog,
    signature,
    resolution: "auto_patched",
    attempt: nextAttempt,
    prUrl: fixRequest.pr_url,
  });

  // The push starts a new CI run; come back for its result.
  await enqueueDurableJob(
    { ...payload, attempt: nextAttempt, lastSignature: signature },
    POLL_SECONDS,
  );
}

/** Start watching a PR we just opened. */
export async function watchPrChecks(input: {
  fixRequestId: string;
  repoId: string;
  repoFullName: string;
  userLogin: string;
  prNumber: number;
  branchName: string;
}): Promise<void> {
  await enqueueDurableJob(
    {
      type: "ci_watch",
      ...input,
      attempt: 0,
      deadlineAt: Date.now() + WATCH_WINDOW_MS,
    },
    POLL_SECONDS,
  );
}
