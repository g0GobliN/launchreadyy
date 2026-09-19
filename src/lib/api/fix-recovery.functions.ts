import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { idString } from "./schema-primitives";
import { rateLimitByUser } from "../rate-limit.server";
import { getGitHubToken } from "../github-token.server";
import { getDataStore } from "../data-store.server";
import {
  commitFilesOnBranch,
  createPRFromFiles,
  ensureOpenPullRequest,
} from "../fix-executor.server";
import {
  buildGeneratedFileRecords,
  buildRecoveryFileSet,
  gitBranchExists,
  isDeterministicCiPatch,
  parseStoredHashes,
  rootCauseForSignature,
  runDiagnosis,
  MAX_ERROR_LOG,
  RECOVERY_AI_EFFORT,
  type DiagnosisOutput,
  type GeneratedFileRecord,
} from "../fix-recovery.server";

async function loadFixRequest(jobId: string) {
  const db = getDataStore();
  const { data, error } = await db.from("fix_requests").select("*").eq("id", jobId).single();
  if (error || !data) throw new Error("Fix request not found");
  return data;
}

async function assertUserOwnsJob(repoId: string, userLogin: string): Promise<void> {
  const { assertRepoOwner } = await import("../auth.server");
  await assertRepoOwner(repoId, userLogin);
}

async function getRecoveryAttemptCount(fixRequestId: string): Promise<number> {
  const db = getDataStore();
  const { count } = await db
    .from("fix_recoveries")
    .select("*", { count: "exact", head: true })
    .eq("fix_request_id", fixRequestId)
    .not("patch_pr_url", "is", null);
  return count ?? 0;
}

function generatedRecordsFromJob(job: {
  generated_file_hashes: unknown;
  pending_files: string | null;
}): GeneratedFileRecord[] {
  const records = parseStoredHashes(job.generated_file_hashes);
  if (records.length > 0) return records;
  if (!job.pending_files) return [];
  try {
    const files = JSON.parse(job.pending_files) as { path: string; content: string }[];
    if (!Array.isArray(files) || files.length === 0) return [];
    return buildGeneratedFileRecords(files);
  } catch {
    return [];
  }
}

async function openRecoveryPr(opts: {
  recoveryId: string;
  fixRequestId: string;
  userLogin: string;
  patchPath: string;
  patchContent: string;
  attemptCount: number;
  driftLevel: string;
  githubToken: string;
}): Promise<{ prUrl: string; aiEffort: number; recreated: boolean }> {
  const db = getDataStore();
  const job = await loadFixRequest(opts.fixRequestId);
  const records = generatedRecordsFromJob(job);
  if (!records.length) {
    throw new Error("No generated file snapshots found — re-run the fix from analysis");
  }

  const allFiles = buildRecoveryFileSet(records, {
    path: opts.patchPath,
    content: opts.patchContent,
  });
  const fixIds = job.fixes.split(",").filter(Boolean);

  const { data: repo, error: repoErr } = await db
    .from("repos")
    .select("full_name, default_branch")
    .eq("id", job.repo_id)
    .single();
  if (repoErr || !repo) throw new Error("Repo not found");

  const defaultBranch = repo.default_branch ?? "main";
  const branchName = job.branch_name;
  const branchAlive =
    Boolean(branchName) && (await gitBranchExists(opts.githubToken, repo.full_name, branchName!));

  let prUrl: string;
  let prNumber: number;
  let newBranchName: string;
  let recreated = false;

  if (branchAlive && branchName) {
    await commitFilesOnBranch(
      opts.githubToken,
      repo.full_name,
      branchName,
      [{ path: opts.patchPath, content: opts.patchContent }],
      "fix: relax CI install for lockfile sync",
    );
    const pr = await ensureOpenPullRequest(
      opts.githubToken,
      repo.full_name,
      branchName,
      defaultBranch,
      fixIds,
    );
    prUrl = pr.prUrl;
    prNumber = pr.prNumber;
    newBranchName = branchName;
  } else {
    recreated = true;
    newBranchName = branchName ?? `launchreadyy/recovery-${opts.recoveryId.slice(0, 8)}`;

    const pr = await createPRFromFiles(
      opts.githubToken,
      repo.full_name,
      defaultBranch,
      newBranchName,
      fixIds,
      allFiles,
    );
    prUrl = pr.prUrl;
    prNumber = pr.prNumber;
  }

  const resolutionType = opts.driftLevel === "pristine" ? "auto_patched" : "suggested";

  await db
    .from("fix_recoveries")
    .update({
      resolution_type: resolutionType,
      patch_pr_url: prUrl,
      ai_effort: RECOVERY_AI_EFFORT,
    })
    .eq("id", opts.recoveryId);

  await db
    .from("fix_requests")
    .update({
      pr_url: prUrl,
      pr_number: prNumber,
      branch_name: newBranchName,
      status: "pr_open",
      pending_files: JSON.stringify(allFiles),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  return { prUrl, aiEffort: RECOVERY_AI_EFFORT, recreated };
}

export const diagnoseRecoveryFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      jobId: idString,
      errorLog: z.string().min(10).max(MAX_ERROR_LOG),
    }),
  )
  .handler(async ({ data }): Promise<DiagnosisOutput> => {
    const { getLocalUser } = await import("../github-token.server");
    const user = getLocalUser();
    if (!user) throw new Error("Not authenticated");
    await rateLimitByUser("ai", user.login);

    const githubToken = getGitHubToken();
    if (!githubToken) throw new Error("Not authenticated");

    const job = await loadFixRequest(data.jobId);
    await assertUserOwnsJob(job.repo_id, user.login);
    if (job.status !== "completed" && job.status !== "failed" && job.status !== "pr_open") {
      throw new Error("Recovery is only available for completed, pr_open, or failed fix jobs");
    }

    const db = getDataStore();
    const { data: repo } = await db
      .from("repos")
      .select("full_name")
      .eq("id", job.repo_id)
      .single();
    if (!repo) throw new Error("Repo not found");

    const generatedRecords = generatedRecordsFromJob(job);
    if (!generatedRecords.length) {
      throw new Error("No generated file snapshots found for this fix request");
    }

    const previousAttempts = await getRecoveryAttemptCount(data.jobId);
    const attemptCount = previousAttempts + 1;

    const fixIds = job.fixes.split(",").filter(Boolean);
    const diagnosis = await runDiagnosis({
      errorLog: data.errorLog,
      generatedRecords,
      fixIds,
      branchName: job.branch_name,
      attemptCount,
      token: githubToken,
      repoFullName: repo.full_name,
    });

    const recoveryId = crypto.randomUUID();
    await db.from("fix_recoveries").insert({
      id: recoveryId,
      fix_request_id: data.jobId,
      user_login: user.login,
      error_log: data.errorLog.slice(0, MAX_ERROR_LOG),
      error_signature: diagnosis.errorSignature,
      tier: diagnosis.tier,
      drift_level: diagnosis.driftLevel,
      resolution_type: diagnosis.resolutionType,
      attempt_count: attemptCount,
      ai_effort: 0,
      patch_path: diagnosis.patchOffer ? (diagnosis.patch?.path ?? null) : null,
      patch_content: diagnosis.patchOffer ? (diagnosis.patch?.content ?? null) : null,
    });

    let appliedPrUrl: string | undefined;
    let recreatedPr: boolean | undefined;
    if (
      diagnosis.patchOffer &&
      diagnosis.patch &&
      isDeterministicCiPatch(diagnosis.errorSignature)
    ) {
      try {
        const applied = await openRecoveryPr({
          recoveryId,
          fixRequestId: data.jobId,
          userLogin: user.login,
          patchPath: diagnosis.patch.path,
          patchContent: diagnosis.patch.content,
          attemptCount,
          driftLevel: diagnosis.driftLevel,
          githubToken,
        });
        appliedPrUrl = applied.prUrl;
        recreatedPr = applied.recreated;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Auto-apply failed";
        return {
          ...diagnosis,
          recoveryId,
          appliedPrUrl: undefined,
          checklist: [...(diagnosis.checklist ?? []), message],
        };
      }
    }

    return { ...diagnosis, recoveryId, appliedPrUrl, recreatedPr };
  });

export const applyRecoveryFixFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ recoveryId: idString }))
  .handler(async ({ data }) => {
    const { getLocalUser } = await import("../github-token.server");
    const user = getLocalUser();
    if (!user) throw new Error("Not authenticated");

    const githubToken = getGitHubToken();
    if (!githubToken) throw new Error("Not authenticated");

    const db = getDataStore();
    const { data: recovery, error: recErr } = await db
      .from("fix_recoveries")
      .select("*")
      .eq("id", data.recoveryId)
      .single();
    if (recErr || !recovery) throw new Error("Recovery record not found");
    if (recovery.user_login !== user.login) throw new Error("Not authorized");

    if (
      recovery.resolution_type === "escalated" &&
      !isDeterministicCiPatch(recovery.error_signature)
    ) {
      throw new Error("Maximum recovery attempts reached");
    }
    if (recovery.patch_pr_url) {
      throw new Error("This recovery has already been applied");
    }
    if (!recovery.patch_path || !recovery.patch_content) {
      throw new Error("No patch available for this recovery");
    }

    const job = await loadFixRequest(recovery.fix_request_id);
    await assertUserOwnsJob(job.repo_id, user.login);

    const { prUrl, aiEffort, recreated } = await openRecoveryPr({
      recoveryId: data.recoveryId,
      fixRequestId: recovery.fix_request_id,
      userLogin: user.login,
      patchPath: recovery.patch_path,
      patchContent: recovery.patch_content,
      attemptCount: recovery.attempt_count,
      driftLevel: recovery.drift_level,
      githubToken,
    });

    return { prUrl, aiEffort, recreated };
  });

export type RecoveryAttempt = {
  id: string;
  errorSignature: string;
  rootCause: string;
  resolutionType: string;
  attemptCount: number;
  createdAt: string;
};

/**
 * The automatic-repair history for one fix job, oldest first.
 *
 * Powers the attempt timeline: the user should be able to see what failed, what we changed, and
 * why, without leaving for GitHub. `error_log` is deliberately not returned — it can be tens of
 * kilobytes of CI output, and the timeline shows the plain-English cause instead.
 */
export const listRecoveryAttemptsFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ jobId: idString }))
  .handler(async ({ data }): Promise<RecoveryAttempt[]> => {
    const { getLocalUser } = await import("../github-token.server");
    const user = getLocalUser();
    if (!user) throw new Error("Not authenticated");

    const job = await loadFixRequest(data.jobId);
    await assertUserOwnsJob(job.repo_id, user.login);

    const db = getDataStore();
    const { data: rows } = await db
      .from("fix_recoveries")
      .select("id, error_signature, resolution_type, attempt_count, created_at")
      .eq("fix_request_id", data.jobId)
      .order("created_at", { ascending: true });

    return (rows ?? []).map((r) => ({
      id: r.id,
      errorSignature: r.error_signature,
      rootCause: rootCauseForSignature(r.error_signature),
      resolutionType: r.resolution_type,
      attemptCount: r.attempt_count,
      createdAt: r.created_at,
    }));
  });
