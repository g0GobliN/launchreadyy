import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  githubLoginString,
  idString,
  longText,
  mediumText,
  optionalIdString,
  shortText,
  slugString,
} from "./schema-primitives";

import { requireAuthUser, assertRepoOwner, assertJobOwner } from "../auth.server";
import { getGitHubToken } from "../github-token.server";
import { getDataStore } from "../data-store.server";
import { fetchGitHubRepos } from "../github.server";
import { AI_FIX_IDS, generateAiTests, hasAiTestCache } from "../ai-tests.server";
import { AI_FIX_EFFORT } from "../fix-meta";
import { DETERMINISTIC_AUDITOR_FIX_IDS } from "../auditor-fixes.server";
import { parseAuditorRoutePath } from "../stripe-webhook-fix.server";
import { defaultFixBranchName, sanitizeFixBranchName } from "../fix-branch";
import { rateLimitByUser } from "../rate-limit.server";
import { toPublicError } from "../utils";
import {
  assertFeatureEnabled,
  assertNotMaintenanceMode,
  getFeatureFlags,
} from "../site-config.server";
import {
  createPRFromFiles,
  computeDiffsFromFiles,
  collectFixFiles,
  type AiTestFile,
  type VerificationNote,
} from "../fix-executor.server";
import {
  CreateFixRequestSchema,
  insertFixJobRecord,
  startPendingFixJob,
  assertFixesAllowed,
  resolveAuditorTargetPaths,
  getFixCache,
  setFixCache,
} from "../fix-job-runner.server";

// Returns display info for the currently-authenticated user, or null.
export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  const githubToken = getGitHubToken();
  const { getLocalUser } = await import("../github-token.server");
  const storedUser = getLocalUser();
  if (!githubToken || !storedUser) return null;
  return storedUser;
});

// Lists all GitHub repos for the authenticated user using the stored GitHub token.
export const listGitHubRepos = createServerFn({ method: "GET" }).handler(async () => {
  const githubToken = getGitHubToken();
  if (!githubToken) return [];
  return fetchGitHubRepos(githubToken);
});

// Shaped like GitHub's repo payload, but it reaches us via the browser, so it is client
// input and bounded as such — `owner_login` is checked against the session below.
const RepoInputSchema = z.object({
  id: z.number(),
  name: shortText,
  full_name: shortText,
  description: mediumText.nullable(),
  language: slugString.nullable(),
  stargazers_count: z.number(),
  updated_at: shortText,
  private: z.boolean(),
  owner_login: githubLoginString,
  default_branch: shortText,
});

// Saves the user-selected GitHub repo to the database and returns its DB id.
export const saveSelectedRepo = createServerFn({ method: "POST" })
  .inputValidator(RepoInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    if (data.owner_login !== user.login) {
      throw new Error("Repo owner does not match your account");
    }

    const { connectRepoForOwner } = await import("../repo-connect.server");
    const { repoId } = await connectRepoForOwner(
      getDataStore(),
      {
        id: String(data.id),
        name: data.name,
        full_name: data.full_name,
        description: data.description,
        language: data.language ?? "Unknown",
        stars: data.stargazers_count,
        updated_at: data.updated_at,
        private: data.private,
        framework: "unknown",
        owner: user.login,
        default_branch: data.default_branch,
      },
      async () => {
        // Community: no repo caps. Hook kept as the pre-connect extension point.
      },
    );
    return { repoId };
  });

/**
 * Queues a scan of a saved repo and returns immediately.
 *
 * The scan used to run inline here, which meant the browser held an open request for its whole
 * duration — minutes on a large repo — with the caller stuck on a spinner and no way to report
 * progress or a mid-flight failure. The work now runs as a durable job so the caller can move
 * to the repo page and watch it.
 *
 * Everything that can reject the request outright still happens here, synchronously: a queued
 * job is a promise that the scan will run, so permission and provider failures must be known
 * before that promise is made.
 */
export const triggerScan = createServerFn({ method: "POST" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const githubToken = getGitHubToken();
    if (!githubToken) throw new Error("GitHub token unavailable — please reconnect.");

    const user = await requireAuthUser();
    await rateLimitByUser("scan", user.login);
    await assertNotMaintenanceMode();
    await assertRepoOwner(data.repoId, user.login);

    // A manual scan is also what registers the repo for ongoing monitoring.
    const { upsertRepoMonitor } = await import("../services/repo-monitor.server");
    await upsertRepoMonitor({
      userLogin: user.login,
      repoId: data.repoId,
    }).catch(() => {});

    const { enqueueDurableJob } = await import("../jobs.server");
    const jobId = await enqueueDurableJob({
      type: "repo_scan",
      repoId: data.repoId,
      userLogin: user.login,
      trigger: "manual",
      enqueueSandbox: true,
    });

    return { jobId };
  });

/**
 * Progress of the most recent scan queued for a repo.
 *
 * The repo page polls this so a scan that dies says so, instead of leaving a spinner turning
 * forever — which is exactly how the old inline path failed.
 */
export const getRepoScanJobFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);

    const db = getDataStore();
    const { data: job } = await db
      .from("background_jobs")
      .select("id, status, attempts, max_attempts, last_error, created_at")
      .eq("kind", "repo_scan")
      .eq("payload->>repoId", data.repoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!job) return null;

    // "pending" covers both the first wait and a retry between attempts — either way the user
    // has a scan coming, so both read as still running.
    const running = job.status === "pending" || job.status === "running";
    return {
      jobId: job.id,
      running,
      failed: job.status === "failed",
      error: job.status === "failed" ? toPublicError(job.last_error ?? "Scan failed.") : null,
      queuedAt: job.created_at,
    };
  });

// ─── Fix Request Job System ───────────────────────────────────────────────────

export const createFixRequest = createServerFn({ method: "POST" })
  .inputValidator(CreateFixRequestSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await rateLimitByUser("ai", user.login);
    return insertFixJobRecord(data, user.login);
  });

// Create the job and immediately start generation (skips the extra confirmation screen).
export const createAndStartFixRequest = createServerFn({ method: "POST" })
  .inputValidator(CreateFixRequestSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await rateLimitByUser("ai", user.login);
    const { jobId } = await insertFixJobRecord(data, user.login);
    await startPendingFixJob(jobId, user.login);
    return { jobId };
  });

// Background job: simulates PR creation. Runs fire-and-forget so the browser
// can be closed without cancelling the job — Node.js keeps the promise alive.
// The operator identity and effort score travel with the durable job payload.
export const confirmFixRequest = createServerFn({ method: "POST" })
  .inputValidator(z.object({ jobId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await rateLimitByUser("ai", user.login);
    return startPendingFixJob(data.jobId, user.login);
  });

// User reviewed the generated output and approved it — commits files and opens the real PR.
// On a GitHub-side failure the job stays in awaiting_review (nothing was charged for this step)
// so the user can just hit "Create PR" again instead of losing their reviewed content.
export const approveFixRequest = createServerFn({ method: "POST" })
  .inputValidator(z.object({ jobId: idString }))
  .handler(async ({ data }) => {
    const authedUser = await requireAuthUser();
    await assertJobOwner(data.jobId, authedUser.login);

    const githubToken = getGitHubToken();
    if (!githubToken) throw new Error("GitHub token unavailable — please reconnect.");

    const db = getDataStore();
    type JobRow = {
      status: string;
      branch_name: string;
      fixes: string;
      repo_id: string;
      pending_files: string | null;
      pending_verification_notes: string | null;
      pending_ai_files: string | null;
      repos: { full_name: string; default_branch: string | null; framework?: string | null } | null;
    };
    const { data: jobRaw, error } = await db
      .from("fix_requests")
      .select(
        "status, branch_name, fixes, repo_id, pending_files, pending_verification_notes, pending_ai_files, repos(full_name, default_branch, framework)",
      )
      .eq("id", data.jobId)
      .single();
    const job = jobRaw as unknown as JobRow | null;

    if (error || !job) throw new Error("Job not found");
    if (job.status !== "awaiting_review") throw new Error("Job is not awaiting review");
    if (!job.pending_files) throw new Error("No generated output to approve");

    const repoFullName = job.repos?.full_name ?? "";
    const defaultBranch = job.repos?.default_branch ?? "main";
    const files = JSON.parse(job.pending_files) as { path: string; content: string }[];
    if (files.length === 0) {
      throw new Error(
        "No file changes to commit — this fix may already be applied. Re-scan your repo.",
      );
    }
    const verificationNotes = (
      job.pending_verification_notes ? JSON.parse(job.pending_verification_notes) : []
    ) as VerificationNote[];
    const fixIds = job.fixes.split(",").filter(Boolean);

    const { buildProjectContext } = await import("../project-context.server");
    const { runFixPreflight, preflightBlockMessage } = await import("../fix-preflight.server");
    const framework = job.repos?.framework ?? "unknown";
    const ctx = await buildProjectContext(githubToken, repoFullName, framework);
    const preflight = runFixPreflight({
      files,
      ctx,
      fixIds,
      repoFilePaths: ctx.filePaths,
      verificationNotes,
    });
    if (!preflight.passed) {
      throw new Error(preflightBlockMessage(preflight));
    }

    // Capability 6 — verify-before-PR (blocks on hard failure; skips if sandbox unavailable)
    const { verifyBeforePr } = await import("../sandbox-verify/verify-before-pr");
    const { producesTests } = await import("../language-test-fixes");
    const verify = await verifyBeforePr({
      token: githubToken,
      repoId: job.repo_id,
      repoFullName,
      userLogin: authedUser.login,
      defaultBranch,
      files,
      // A job that generates tests must have those tests actually run. Otherwise the sandbox
      // only proves the project still builds, and a generated suite that imports a wrong path
      // or asserts nothing reaches the pull request unexecuted.
      includeTest: producesTests(fixIds),
    });
    if (verify.status === "failed") {
      // Name the step that actually failed. "PR blocked until the fix builds cleanly" is
      // misleading when the build was fine and it was the test run that failed — which is now
      // a case we deliberately create for jobs that generate tests.
      const failedStep = verify.steps?.find((s) => s.exitCode !== 0)?.step;
      const remedy =
        failedStep === "test"
          ? "The generated tests did not pass, so the PR was not opened. Re-generate the fix, or fix the failing test in your repo first."
          : "PR blocked until the fix builds cleanly.";
      throw new Error(
        `Sandbox verification failed (${verify.category}) at the ${failedStep ?? "verification"} step: ${verify.message}. ${remedy}`,
      );
    }
    // Both notes are built in `verification-notes.ts` so the PR body can read the skip reason as
    // data instead of parsing it back out of the finished sentence.
    const { sandboxPassedNote, sandboxSkippedNote } =
      await import("../fix-executor/verification-notes");
    if (verify.status === "passed") {
      verificationNotes.push(sandboxPassedNote(producesTests(fixIds)));
    }
    if (verify.status === "skipped") {
      // A skip used to add nothing to the PR at all, and an absent verification section reads as
      // approval. It is the opposite: nobody built this change before it was proposed, and the
      // reviewer is now the only check left.
      verificationNotes.push(sandboxSkippedNote(verify.reason));
    }

    try {
      const { prNumber, prUrl } = await createPRFromFiles(
        githubToken,
        repoFullName,
        defaultBranch,
        job.branch_name,
        fixIds,
        files,
        verificationNotes,
      );

      await db
        .from("fix_requests")
        .update({
          status: "pr_open",
          pr_number: prNumber,
          pr_url: prUrl,
          ...(job.pending_ai_files ? { ai_files: job.pending_ai_files } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.jobId);

      // Non-critical: store file hashes for recovery.
      const { buildGeneratedFileRecords, toStoredHashes } = await import("../fix-recovery.server");
      const generatedHashes = toStoredHashes(buildGeneratedFileRecords(files));
      await db
        .from("fix_requests")
        .update({ generated_file_hashes: generatedHashes })
        .eq("id", data.jobId)
        .then(({ error: hashErr }) => {
          if (hashErr) {
            console.error("[approveFixRequest] could not save file hashes:", hashErr.message);
          }
        });

      // Watch the checks this PR just triggered, and repair our own file if they fail. Strictly
      // best-effort: a watcher that can't start must never fail a PR that opened successfully.
      try {
        const { watchPrChecks } = await import("../ci-watch.server");
        await watchPrChecks({
          fixRequestId: data.jobId,
          repoId: job.repo_id,
          repoFullName,
          userLogin: authedUser.login,
          prNumber,
          branchName: job.branch_name,
        });
      } catch (e) {
        console.error("[approveFixRequest] could not start CI watch:", e);
      }

      return { jobId: data.jobId, prNumber, prUrl };
    } catch (err) {
      await db
        .from("fix_requests")
        .update({
          error_message: err instanceof Error ? err.message : "Failed to create PR",
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.jobId);
      throw err;
    }
  });

// User confirmed CI passed on the open PR — archive file snapshot and close the job.
export const confirmFixJobCompleteFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ jobId: idString }))
  .handler(async ({ data }) => {
    const authedUser = await requireAuthUser();
    await assertJobOwner(data.jobId, authedUser.login);

    const db = getDataStore();
    type JobRow = {
      status: string;
      pending_files: string | null;
      pending_ai_files: string | null;
    };
    const { data: jobRaw, error } = await db
      .from("fix_requests")
      .select("status, pending_files, pending_ai_files")
      .eq("id", data.jobId)
      .single();
    const job = jobRaw as unknown as JobRow | null;

    if (error || !job) throw new Error("Job not found");
    if (job.status !== "pr_open") throw new Error("Job is not awaiting CI confirmation");

    let aiFilesSnapshot: string | null = job.pending_ai_files;
    if (job.pending_files) {
      try {
        const files = JSON.parse(job.pending_files) as { path: string; content: string }[];
        const aiMeta = job.pending_ai_files
          ? (JSON.parse(job.pending_ai_files) as { fixId: string; path: string }[])
          : [];
        const fixByPath = new Map(aiMeta.map((f) => [f.path, f.fixId]));
        aiFilesSnapshot = JSON.stringify(
          files.map((f) => ({
            fixId: fixByPath.get(f.path) ?? "launchreadyy",
            path: f.path,
            content: f.content,
          })),
        );
      } catch {
        /* keep pending_ai_files if parse fails */
      }
    }

    await db
      .from("fix_requests")
      .update({
        status: "completed",
        ...(aiFilesSnapshot ? { ai_files: aiFilesSnapshot } : {}),
        pending_files: null,
        pending_verification_notes: null,
        pending_ai_files: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.jobId);

    return { jobId: data.jobId };
  });

// User didn't like the generated output — re-runs AI generation with their feedback applied.
// Regeneration recomputes the AI effort estimate; template-only jobs have nothing
// to regenerate so this is rejected for them.
export const regenerateFixRequest = createServerFn({ method: "POST" })
  .inputValidator(z.object({ jobId: idString, feedback: longText.optional() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await rateLimitByUser("ai", user.login);
    await assertNotMaintenanceMode();
    await assertJobOwner(data.jobId, user.login);

    const githubToken = getGitHubToken();
    if (!githubToken) throw new Error("GitHub token unavailable — please reconnect.");

    const db = getDataStore();
    type JobRow = {
      status: string;
      fixes: string;
      scan_id: string;
      repos: { full_name: string } | null;
    };
    const { data: jobRaw, error } = await db
      .from("fix_requests")
      .select("status, fixes, scan_id, repos(full_name)")
      .eq("id", data.jobId)
      .single();
    const job = jobRaw as unknown as JobRow | null;

    if (error || !job) throw new Error("Job not found");
    if (job.status !== "awaiting_review") throw new Error("Job is not awaiting review");

    const fixIds = job.fixes.split(",").filter(Boolean);
    await assertFixesAllowed(fixIds);
    const aiFixIds = fixIds.filter((id) => AI_FIX_IDS.has(id));
    if (aiFixIds.length === 0) {
      throw new Error("This job has no AI-generated content to regenerate.");
    }

    const regenCost = aiFixIds.reduce((sum, id) => sum + (AI_FIX_EFFORT[id] ?? 0), 0);

    await db
      .from("fix_requests")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", data.jobId);

    const repoFullName = job.repos?.full_name ?? "";
    const { enqueueDurableJob } = await import("../jobs.server");
    await enqueueDurableJob({
      type: "fix_regenerate",
      fixRequestId: data.jobId,
      userLogin: user.login,
      repoFullName,
      effortScore: regenCost,
      fixIds,
      scanId: job.scan_id,
      feedback: data.feedback?.trim() ?? "",
    });

    return { jobId: data.jobId, effortScore: regenCost };
  });

// Returns diffs for the files currently awaiting review on a job (computed against the real repo).
export const getPendingDiffsFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ jobId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertJobOwner(data.jobId, user.login);

    const githubToken = getGitHubToken();
    if (!githubToken) throw new Error("Not authenticated");

    const db = getDataStore();
    const { data: jobRaw } = await db
      .from("fix_requests")
      .select("pending_files, repos(full_name)")
      .eq("id", data.jobId)
      .single();
    const job = jobRaw as unknown as {
      pending_files: string | null;
      repos: { full_name: string } | null;
    } | null;
    const repoFullName = job?.repos?.full_name ?? "";
    if (!job?.pending_files || !repoFullName) return [];

    const files = JSON.parse(job.pending_files) as { path: string; content: string }[];
    return computeDiffsFromFiles(githubToken, repoFullName, files);
  });

// Returns current job status — called by client-side polling.
// If a job has been running for over 10 minutes it is presumed stale (worker was killed
// before writing the final status) and is auto-transitioned to failed so the UI unblocks.
export const getFixRequestFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ jobId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertJobOwner(data.jobId, user.login);

    const db = getDataStore();
    const { data: row, error } = await db
      .from("fix_requests")
      .select("*")
      .eq("id", data.jobId)
      .single();
    if (error || !row) return null;

    const STALE_MS = 10 * 60 * 1000;
    if (row.status === "running" && Date.now() - new Date(row.updated_at).getTime() > STALE_MS) {
      await db
        .from("fix_requests")
        .update({
          status: "failed",
          error_message:
            "Job timed out — the worker was terminated before completing. Your branch may already exist on GitHub.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.jobId);
      return {
        ...row,
        status: "failed",
        error_message:
          "Job timed out — the worker was terminated before completing. Your branch may already exist on GitHub.",
      };
    }

    return row;
  });

export const loadDashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  const { loadDashboardData } = await import("../dashboard.server");
  return loadDashboardData();
});

export const getAllJobsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getLocalUser } = await import("../github-token.server");
  const user = getLocalUser();
  if (!user) throw new Error("Not authenticated");
  const { getAllFixRequests } = await import("../db.server");
  return getAllFixRequests(user.login);
});

// ─── Architecture analysis ────────────────────────────────────────────────────

// Returns existing arch scan for a repo, or null if none exists.
export const getArchScanFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    const { getArchScan } = await import("../db.server");
    return getArchScan(data.repoId);
  });

// Runs a fresh architecture analysis and stores the result.
// Reuses a cached result if one was created within the last hour.
export const runArchScanFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const githubToken = getGitHubToken();
    if (!githubToken) throw new Error("GitHub token unavailable — please reconnect.");

    const user = await requireAuthUser();
    await rateLimitByUser("scan", user.login);
    await assertNotMaintenanceMode();
    await assertFeatureEnabled("flag_architecture_analysis");
    await assertRepoOwner(data.repoId, user.login);
    const db = getDataStore();
    const { data: repo, error: repoErr } = await db
      .from("repos")
      .select("full_name, default_branch, framework")
      .eq("id", data.repoId)
      .single();
    if (repoErr || !repo) throw new Error("Repo not found.");

    const { isArchScanSupported, ARCH_SCAN_UNSUPPORTED_MESSAGE } =
      await import("../arch-scanner.server");
    if (!isArchScanSupported(repo.framework)) {
      throw new Error(ARCH_SCAN_UNSUPPORTED_MESSAGE);
    }

    // Check cache: if scanned in the last hour, return the existing result.
    const { getArchScan, saveArchScan } = await import("../db.server");
    const existing = await getArchScan(data.repoId);
    if (existing) {
      const ageMs =
        Date.now() -
        new Date(
          (await db.from("arch_scans").select("created_at").eq("id", existing.id).single()).data
            ?.created_at ?? 0,
        ).getTime();
      if (ageMs < 60 * 60 * 1000) return existing; // under 1 hour — cache hit
    }

    const { runArchScan } = await import("../arch-scanner.server");
    const result = await runArchScan(githubToken, repo.full_name, repo.default_branch ?? "main");
    return saveArchScan(data.repoId, result.score, result.findings, result.scannedFiles);
  });

// Returns real diffs + CI intelligence for the selected fixes against the user's actual repo.
export const getFixPreviewFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ repoId: idString, fixIds: z.array(z.string()), scanId: optionalIdString }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await rateLimitByUser("ai", user.login);
    await assertRepoOwner(data.repoId, user.login);

    const githubToken = getGitHubToken();
    if (!githubToken) throw new Error("Not authenticated");

    const db = getDataStore();
    const { data: repo } = await db
      .from("repos")
      .select("full_name, framework, name")
      .eq("id", data.repoId)
      .single();
    if (!repo) throw new Error("Repo not found");

    const opts = {
      framework: repo.framework ?? "unknown",
      repoName: repo.name,
      auditorTargetPaths: data.scanId
        ? await resolveAuditorTargetPaths(db, data.scanId, data.fixIds)
        : undefined,
    };

    const flags = await getFeatureFlags();
    const aiFixIds = data.fixIds.filter(
      (id) =>
        AI_FIX_IDS.has(id) &&
        !DETERMINISTIC_AUDITOR_FIX_IDS.has(id) &&
        flags.flag_ai_fixes &&
        (id !== "playwright-ai" || flags.flag_playwright_ai),
    );

    const loadAiPreviewFiles = async (): Promise<AiTestFile[]> => {
      if (!data.scanId || aiFixIds.length === 0) return [];
      const { buildProjectContext, getToolApplicability } =
        await import("../project-context.server");
      const ctx = await buildProjectContext(githubToken, repo.full_name, opts.framework);
      const applicable = aiFixIds.filter((id) => getToolApplicability(id, ctx).applicable);
      if (applicable.length === 0) return [];
      return generateAiTests(
        data.scanId,
        applicable,
        repo.full_name,
        githubToken,
        repo.framework ?? undefined,
      );
    };

    const mergeAiFiles = (
      base: { path: string; content: string }[],
      ai: AiTestFile[],
    ): { path: string; content: string }[] => {
      if (ai.length === 0) return base;
      const aiPaths = new Set(ai.map((f) => f.path));
      const deterministicPaths = new Set(["playwright.config.ts", "playwright.config.js"]);
      return [
        ...base.filter((f) => !aiPaths.has(f.path) || deterministicPaths.has(f.path)),
        ...ai.filter((f) => !deterministicPaths.has(f.path)),
      ];
    };

    const ENV_SENSITIVE_FIX_IDS = new Set([
      "env-example",
      "env-example-ai",
      "auditor-env-undocumented",
      "auditor-env-gap",
    ]);
    const skipFixCache = data.fixIds.some((id) => ENV_SENSITIVE_FIX_IDS.has(id));
    const cachedFiles = skipFixCache ? null : await getFixCache(db, data.repoId, data.fixIds);
    if (cachedFiles && cachedFiles.length > 0) {
      const { buildProjectContext } = await import("../project-context.server");
      const { buildFixPreviewInsight } = await import("../fix-preview-insight.server");
      const ctx = await buildProjectContext(githubToken, repo.full_name, opts.framework);
      const aiFiles = await loadAiPreviewFiles();
      const files = mergeAiFiles(cachedFiles, aiFiles);
      return {
        diffs: await computeDiffsFromFiles(githubToken, repo.full_name, files),
        insight: buildFixPreviewInsight(ctx, data.fixIds),
        verificationNotes: [] as VerificationNote[],
      };
    }

    const [collectResult, aiFiles] = await Promise.all([
      collectFixFiles(githubToken, repo.full_name, data.fixIds, opts),
      loadAiPreviewFiles(),
    ]);
    const files = mergeAiFiles(collectResult.files, aiFiles);
    if (files.length > 0) {
      void setFixCache(db, data.repoId, data.fixIds, repo.framework ?? "unknown", files);
    }
    return {
      diffs: await computeDiffsFromFiles(githubToken, repo.full_name, files),
      insight: collectResult.previewInsight ?? null,
      verificationNotes: collectResult.verificationNotes,
      preflight: collectResult.preflight ?? null,
    };
  });

// ─── Report page ──────────────────────────────────────────────────────────────

// Returns all data needed to render the per-repo report page.
export const getReportFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);

    const db = getDataStore();

    const [repoRes, scanRes] = await Promise.all([
      db.from("repos").select("*").eq("id", data.repoId).single(),
      db
        .from("scans")
        .select("*")
        .eq("repo_id", data.repoId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
    ]);

    if (repoRes.error || !repoRes.data) throw new Error("Repo not found.");
    if (scanRes.error || !scanRes.data)
      return { repo: repoRes.data, scan: null, issues: [], jobs: [], archScan: null };

    const [issuesRes, jobsRes, archRes] = await Promise.all([
      db.from("issues").select("*").eq("scan_id", scanRes.data.id),
      db
        .from("fix_requests")
        .select("id, fixes, status, pr_url, pr_number, effort_score, created_at")
        .eq("scan_id", scanRes.data.id)
        .order("created_at", { ascending: false }),
      db
        .from("arch_scans")
        .select("score, findings, scanned_files, created_at")
        .eq("repo_id", data.repoId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      repo: repoRes.data,
      scan: scanRes.data,
      issues: issuesRes.data ?? [],
      jobs: jobsRes.data ?? [],
      archScan: archRes.data ?? null,
    };
  });

// Cancels a pending job, or discards a generated-but-not-yet-approved one.
export const cancelFixRequest = createServerFn({ method: "POST" })
  .inputValidator(z.object({ jobId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertJobOwner(data.jobId, user.login);

    const db = getDataStore();
    await db
      .from("fix_requests")
      .update({
        status: "cancelled",
        pending_files: null,
        pending_verification_notes: null,
        pending_ai_files: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.jobId)
      .in("status", ["pending", "awaiting_review"]);
  });
