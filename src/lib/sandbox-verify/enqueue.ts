import { enqueueDurableJob, type SandboxVerifyJobPayload } from "../jobs.server";
import { getDataStore } from "../data-store.server";
import { resolveBranchHeadSha } from "../github.server";
import { getProjectBuildSettings } from "../sandbox/build-settings.server";
import {
  findSandboxRunForCommit,
  hasConfigChangedSince,
  resolveReusedSandboxRun,
  shouldJoinActiveSandboxRun,
  shouldReuseSandboxRun,
  shouldSkipBudgetKilledCommit,
} from "./reuse";
import { SANDBOX_TIMEOUT_MS } from "../fix-meta";
export type EnqueueSandboxVerifyInput = {
  repoId: string;
  repoFullName: string;
  userLogin: string;
  defaultBranch: string;
  githubToken: string;
  scanId?: string;
  fixRequestId?: string;
  branchName?: string;
  includeTest?: boolean;
  runtimeVersion?: string;
  /**
   * Who asked. "scan" means nobody pressed anything — a scan is verifying as it goes, so a
   * commit already known to blow the time budget must not be retried on our initiative and
   * started unnecessarily. "manual" is an explicit operator request and always gets a run.
   */
  origin?: "scan" | "manual";
};

export type EnqueueSandboxVerifyResult = {
  runId: string;
  jobId: string;
  /** True when an existing run was returned. */
  reused?: boolean;
};

/** Why no run was started. */
export type EnqueueSandboxVerifyRefusal = {
  refused: "commit_unresolved" | "budget_exceeded";
  message: string;
};

export type EnqueueSandboxVerifyOutcome = EnqueueSandboxVerifyResult | EnqueueSandboxVerifyRefusal;

export function isEnqueueRefusal(
  outcome: EnqueueSandboxVerifyOutcome,
): outcome is EnqueueSandboxVerifyRefusal {
  return "refused" in outcome;
}

/**
 * Create a sandbox_verify_runs row and enqueue the durable job.
 * Scans wait on this result before showing findings.
 *
 * If the branch tip already has an answer (same includeTest), returns that run without
 * starting another run. See `findSandboxRunForCommit` for what counts.
 */
export async function enqueueSandboxVerify(
  input: EnqueueSandboxVerifyInput,
): Promise<EnqueueSandboxVerifyOutcome> {
  const branch = input.branchName ?? input.defaultBranch;
  const buildSettings = await getProjectBuildSettings(input.repoId);
  // Match processSandboxVerifyJob: explicit request OR repo setting.
  const includeTest = input.includeTest === true || buildSettings.includeTest;
  const gitSha = await resolveBranchHeadSha(input.githubToken, input.repoFullName, branch).catch(
    () => null,
  );

  // Fail closed. The commit is the only key we have for "have we already answered this?",
  // so without it every reuse check is a guess — and a GitHub blip would quietly spend a
  // sandbox slot rebuilding something we may already have verified. Asking the user to try
  // again costs them a click; guessing costs them a run they cannot get back.
  if (!gitSha) {
    return {
      refused: "commit_unresolved",
      message: `Couldn't read the latest commit on ${branch} from GitHub, so verification was skipped rather than risk spending a sandbox run twice on the same code. Try again in a moment.`,
    };
  }

  // A tab refresh or a second browser window must join the sandbox already verifying this
  // analysis, not claim another paid slot for the same commit. Different scans are kept
  // separate because sandbox rows can link to only one scan_id.
  const db = getDataStore();
  const { data: activeRun } = await db
    .from("sandbox_verify_runs")
    .select("id, scan_id, created_at")
    .eq("repo_id", input.repoId)
    .eq("git_sha", gitSha)
    .eq("include_test", includeTest)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeRun) {
    const configChangedSinceRun = await hasConfigChangedSince(input.repoId, activeRun.created_at);
    if (
      shouldJoinActiveSandboxRun({
        activeScanId: activeRun.scan_id,
        requestedScanId: input.scanId,
        configChangedSinceRun,
      })
    ) {
      return { runId: activeRun.id, jobId: "", reused: true };
    }
  }

  const prior = await findSandboxRunForCommit({ repoId: input.repoId, gitSha, includeTest });
  const configChangedSinceRun = prior
    ? await hasConfigChangedSince(input.repoId, prior.createdAt)
    : false;

  if (
    shouldSkipBudgetKilledCommit({
      prior,
      configChangedSinceRun,
      origin: input.origin,
    })
  ) {
    const seconds = Math.round(SANDBOX_TIMEOUT_MS / 1000);
    return {
      refused: "budget_exceeded",
      message: `This commit already used the full ${seconds}s sandbox budget without finishing, so we didn't spend another run on it. Trim the build, then build again.`,
    };
  }

  const reuseId = shouldReuseSandboxRun({
    gitSha,
    priorRunId: prior?.kind === "definitive" ? prior.id : null,
    configChangedSinceRun,
  });
  if (reuseId && prior?.kind === "definitive") {
    const runId = await resolveReusedSandboxRun({
      priorRunId: reuseId,
      priorStatus: prior.status,
      repoId: input.repoId,
      userLogin: input.userLogin,
      scanId: input.scanId,
      fixRequestId: input.fixRequestId,
      gitSha,
      includeTest,
      branchName: input.branchName ?? null,
    });
    return { runId, jobId: "", reused: true };
  }

  const runId = crypto.randomUUID();
  const { error } = await db.from("sandbox_verify_runs").insert({
    id: runId,
    repo_id: input.repoId,
    user_id: input.userLogin,
    scan_id: input.scanId ?? null,
    fix_request_id: input.fixRequestId ?? null,
    status: "queued",
    branch_name: input.branchName ?? null,
    runtime_version: input.runtimeVersion ?? null,
    include_test: includeTest,
    git_sha: gitSha,
  });
  if (error) throw new Error(`Failed to create sandbox_verify_runs: ${error.message}`);

  const payload: SandboxVerifyJobPayload = {
    type: "sandbox_verify",
    runId,
    repoId: input.repoId,
    repoFullName: input.repoFullName,
    userLogin: input.userLogin,
    defaultBranch: input.defaultBranch,
    scanId: input.scanId,
    fixRequestId: input.fixRequestId,
    branchName: input.branchName,
    includeTest,
    runtimeVersion: input.runtimeVersion,
  };

  const jobId = await enqueueDurableJob(payload);
  return { runId, jobId };
}
