import { getDataStore } from "../data-store.server";
import { REUSED_FAILURE, REUSED_PASS } from "./reuse-reason";
import type { InconclusiveReason } from "./failure-classify";
import type { IssueInput } from "../scanner-rules";

/** A prior run that answered the question for this commit — pass or clean failure. */
export type DefinitiveSandboxRun = {
  kind: "definitive";
  /** The real build's row. Mirrors point back at it, so chains never get deeper than one hop. */
  id: string;
  createdAt: string;
  status: "passed" | "failed";
};

/**
 * The last attempt on this commit ended without judging it. Not reusable — but the caller
 * still wants to know, because "we already tried this commit and it blew the time budget" is
 * a reason to stop retrying it automatically on every scan.
 */
export type InconclusiveSandboxRun = {
  kind: "inconclusive";
  reason: InconclusiveReason;
  createdAt: string;
};

export type SandboxRunLookup = DefinitiveSandboxRun | InconclusiveSandboxRun | null;

/** Join an in-flight build only when it belongs to this analysis and still uses its config. */
export function shouldJoinActiveSandboxRun(opts: {
  activeScanId: string | null;
  requestedScanId?: string;
  configChangedSinceRun: boolean;
}): boolean {
  if (opts.configChangedSinceRun) return false;
  return !opts.requestedScanId || opts.activeScanId === opts.requestedScanId;
}

/**
 * Whether enqueue should reuse an existing run instead of starting another sandbox.
 * Missing SHA or no prior answer → enqueue.
 *
 * An answer is keyed by commit, but the build also depends on env vars and build settings,
 * which change without a commit. Editing either invalidates it — otherwise users had to know
 * to press a separate "force" button, which nobody did.
 */
export function shouldReuseSandboxRun(opts: {
  gitSha: string | null;
  priorRunId: string | null;
  configChangedSinceRun?: boolean;
}): string | null {
  if (opts.configChangedSinceRun) return null;
  if (!opts.gitSha || !opts.priorRunId) return null;
  return opts.priorRunId;
}

/**
 * Whether to decline a scan's automatic verification because this exact commit already spent
 * the full sandbox budget without finishing.
 *
 * A budget kill is not cacheable — the repo may just be slow, and the next attempt could
 * succeed — but that cuts both ways: retrying it unprompted spends a slot to reproduce a
 * result we can already predict, and on Free that is the month gone in two scans with nothing
 * learned. So the run is never *replayed*, only never *auto-retried*.
 *
 * A manual verification can retry after an upgrade, while config edits count as a meaningful
 * change — raising memory or trimming the build is exactly how someone gets past this.
 */
export function shouldSkipBudgetKilledCommit(opts: {
  prior: SandboxRunLookup;
  configChangedSinceRun?: boolean;
  origin?: "scan" | "manual";
}): boolean {
  if (opts.prior?.kind !== "inconclusive") return false;
  if (opts.prior.reason !== "budget_kill") return false;
  return !opts.configChangedSinceRun && opts.origin === "scan";
}

/**
 * The latest run that judged this repo tip (with this includeTest setting), pass or fail.
 *
 * A failure is as much an answer about a commit as a pass is, and re-running it changes
 * nothing — so clicking Analyze again on a repo that does not build used to spend a fresh
 * sandbox slot every time, which on Free is the whole month in two clicks.
 *
 * Three kinds of run are deliberately not answers:
 *   - skipped — we never learned anything (no manifest, provider down, our image was short a
 *     toolchain), and the next attempt may well succeed;
 *   - failed with an `error_message` — the job crashed on our side rather than on the repo's;
 *   - an inconclusive run — out of time or memory, or an install the package registry killed.
 *     See `inconclusiveReason`. These come back tagged rather than as null, because the caller
 *     treats "never tried" and "tried and it timed out" differently.
 */
export async function findSandboxRunForCommit(opts: {
  repoId: string;
  gitSha: string;
  includeTest: boolean;
}): Promise<SandboxRunLookup> {
  const db = getDataStore();
  const { data, error } = await db
    .from("sandbox_verify_runs")
    .select("id, created_at, status, structured_results")
    .eq("repo_id", opts.repoId)
    .eq("git_sha", opts.gitSha)
    .in("status", ["passed", "failed"])
    .is("error_message", null)
    .eq("include_test", opts.includeTest)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[findSandboxRunForCommit]", error.message);
    return null;
  }
  if (!data) return null;

  const structured = asRecord(data.structured_results);
  const inconclusive = structured.inconclusive;
  if (inconclusive === "budget_kill" || inconclusive === "flaky_infra") {
    return { kind: "inconclusive", reason: inconclusive, createdAt: data.created_at };
  }

  const status = data.status as "passed" | "failed";
  // Already a mirror? Point at the run it copied, so the log stops nesting a reuse header
  // inside a reuse header and every mirror stays one hop from the real build.
  const sourceId =
    typeof structured.reusedFromRunId === "string" ? structured.reusedFromRunId : null;
  if (!sourceId) return { kind: "definitive", id: data.id, createdAt: data.created_at, status };

  const { data: source } = await db
    .from("sandbox_verify_runs")
    .select("id, created_at")
    .eq("id", sourceId)
    .maybeSingle();
  // The original's timestamp, not the mirror's: it is the moment the config was actually
  // proven to work, so config edits since then still force a real build.
  return source
    ? { kind: "definitive", id: source.id, createdAt: source.created_at, status }
    : { kind: "definitive", id: data.id, createdAt: data.created_at, status };
}

/**
 * Did the user edit env vars or build settings after this run finished?
 * Read failures return false — a missing signal should not trigger unnecessary work.
 */
export async function hasConfigChangedSince(repoId: string, since: string): Promise<boolean> {
  const db = getDataStore();
  const [envVars, buildSettings] = await Promise.all([
    db
      .from("project_env_vars")
      .select("repo_id")
      .eq("repo_id", repoId)
      .gt("updated_at", since)
      .limit(1),
    db
      .from("project_build_settings")
      .select("repo_id")
      .eq("repo_id", repoId)
      .gt("updated_at", since)
      .limit(1),
  ]);
  if (envVars.error) console.error("[hasConfigChangedSince] env", envVars.error.message);
  if (buildSettings.error)
    console.error("[hasConfigChangedSince] build", buildSettings.error.message);
  return (envVars.data?.length ?? 0) > 0 || (buildSettings.data?.length ?? 0) > 0;
}

/**
 * Return a run id suitable for the caller. If a new scan (or fix) needs the earlier
 * result linked, insert a mirror row so verdicts keyed by scan_id still see
 * the same status.
 */
export async function resolveReusedSandboxRun(opts: {
  priorRunId: string;
  priorStatus: "passed" | "failed";
  repoId: string;
  userLogin: string;
  scanId?: string;
  fixRequestId?: string;
  gitSha: string;
  includeTest: boolean;
  branchName?: string | null;
}): Promise<string> {
  const db = getDataStore();
  const { data: prior } = await db
    .from("sandbox_verify_runs")
    .select(
      "id, scan_id, fix_request_id, raw_log, live_log, structured_results, planned_steps, completed_steps, runtime_version, package_manager, branch_name",
    )
    .eq("id", opts.priorRunId)
    .maybeSingle();

  if (!prior) return opts.priorRunId;

  const sameScan = !opts.scanId || prior.scan_id === opts.scanId;
  const sameFix = !opts.fixRequestId || prior.fix_request_id === opts.fixRequestId;
  if (sameScan && sameFix) return prior.id;

  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const priorStructured = asRecord(prior.structured_results);

  const planned = (prior.planned_steps as Array<{ step: string; command: string }> | null) ?? [];
  const priorCompleted =
    (prior.completed_steps as Array<{
      step: string;
      command: string;
      exitCode: number;
      durationMs: number;
    }> | null) ?? [];
  // Prefer the prior checklist; if it was thin, treat planned steps as passed so the UI
  // doesn't show empty Install/Build/Lint circles next to "finished". Only for a pass —
  // inventing green checkmarks for a run that failed would be a lie about which step broke.
  const completedSteps =
    priorCompleted.length > 0 || opts.priorStatus === "failed"
      ? priorCompleted
      : planned.map((s) => ({
          step: s.step,
          command: s.command,
          exitCode: 0,
          durationMs: 0,
        }));

  const passed = opts.priorStatus === "passed";
  const reuseLog = [
    passed
      ? "[sandbox] Skipped — this commit already passed verification."
      : "[sandbox] Skipped — this commit already failed verification, and nothing has changed since.",
    "[sandbox] Reused the previous definitive result.",
    passed
      ? "[sandbox] Env var and build setting changes trigger a real build automatically."
      : "[sandbox] Push a fix or edit env vars or build settings, then analyze again.",
    prior.raw_log || prior.live_log
      ? "\n—— Previous run log ——\n" + (prior.raw_log || prior.live_log)
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { error } = await db.from("sandbox_verify_runs").insert({
    id: runId,
    repo_id: opts.repoId,
    user_id: opts.userLogin,
    scan_id: opts.scanId ?? prior.scan_id,
    fix_request_id: opts.fixRequestId ?? null,
    status: opts.priorStatus,
    branch_name: opts.branchName ?? prior.branch_name,
    runtime_version: prior.runtime_version,
    package_manager: prior.package_manager,
    include_test: opts.includeTest,
    git_sha: opts.gitSha,
    raw_log: reuseLog,
    live_log: reuseLog,
    structured_results: {
      ...priorStructured,
      reusedFromRunId: opts.priorRunId,
      skipReason: passed ? REUSED_PASS : REUSED_FAILURE,
    },
    planned_steps: planned.length > 0 ? planned : null,
    completed_steps: completedSteps,
    current_step: null,
    started_at: now,
    finished_at: now,
  });
  if (error) {
    console.error("[resolveReusedSandboxRun]", error.message);
    return opts.priorRunId;
  }

  // The mirror carries the status, but the findings live on the scan, and this is a
  // different scan. Without this the sandbox's own issues — a failed build, a leaked
  // credential the whole-repo sweep caught — silently vanished from
  // any scan that reused a run, and the verdict read "ready" over a repo that cannot build.
  if (opts.scanId && prior.scan_id !== opts.scanId) {
    await copyIssuesToScan(opts.scanId, priorStructured);
  }
  return runId;
}

/** Replay a reused run's findings onto the scan that is now showing its result. */
async function copyIssuesToScan(
  scanId: string,
  priorStructured: Record<string, unknown>,
): Promise<void> {
  const issues = Array.isArray(priorStructured.issues)
    ? (priorStructured.issues as IssueInput[])
    : [];
  if (issues.length === 0) return;
  try {
    const discovered = asRecord(priorStructured.discovered);
    const sweepFound =
      typeof discovered.sweepIssueCount === "number" && discovered.sweepIssueCount > 0;
    const { syncSandboxIssuesToScan } = await import("./index");
    const { SWEEP_SUPERSEDES_FIX_IDS } = await import("./secret-sweep");
    await syncSandboxIssuesToScan(scanId, issues, sweepFound ? [...SWEEP_SUPERSEDES_FIX_IDS] : []);
  } catch (e) {
    console.error("[resolveReusedSandboxRun] issue replay failed:", e);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
