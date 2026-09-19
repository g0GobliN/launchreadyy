/**
 * Fix-job orchestration — extracted from github.functions.ts.
 * createServerFn handlers stay in the API layer; this module owns job lifecycle.
 */

import { z } from "zod";
import type { Json } from "./data-store.types";
import { assertRepoOwner, assertJobOwner } from "./auth.server";
import { getGitHubToken } from "./github-token.server";
import { getDataStore } from "./data-store.server";
import { AI_FIX_IDS, generateAiTests, hasAiTestCache } from "./ai-tests.server";
import { parseAuditorRoutePath } from "./stripe-webhook-fix.server";
import { defaultFixBranchName, sanitizeFixBranchName } from "./fix-branch";
import { assertNotMaintenanceMode, getFeatureFlags } from "./site-config.server";
import {
  buildFixRiskMap,
  getFixEffortTier,
  AI_FIX_EFFORT,
  DETERMINISTIC_AUDITOR_FIX_IDS,
} from "./fix-meta";
import { collectFixFiles, type AiTestFile, type VerificationNote } from "./fix-executor.server";

export const CreateFixRequestSchema = z.object({
  repoId: z.string(),
  scanId: z.string(),
  fixes: z.string(),
  branchName: z.string().optional(),
  estFilesAdded: z.number(),
  estFilesChanged: z.number(),
  estDeps: z.number(),
  effortScore: z.number(),
});

export type CreateFixRequestInput = z.infer<typeof CreateFixRequestSchema>;

export async function loadFixRiskMap(
  scanId: string,
): Promise<Record<string, import("./readiness/types").RiskLevel>> {
  const db = getDataStore();
  const { data } = await db
    .from("issues")
    .select("fix_id, risk_level, severity")
    .eq("scan_id", scanId);
  return buildFixRiskMap(
    (data ?? []).map((row) => ({
      fixId: row.fix_id as string,
      riskLevel: row.risk_level as import("./readiness/types").RiskLevel | undefined,
      severity: row.severity as string | undefined,
    })),
  );
}

/**
 * AI-effort estimate for a batch of fixes. This is a sizing hint for the UI and the
 * job queue — heavier batches take longer and cost more at the AI provider — NOT a
 * provider charge. It is stored with the job so history can show relative effort.
 */
function estimateJobEffort(
  fixIds: string[],
  opts?: { riskByFixId?: Record<string, import("./readiness/types").RiskLevel> },
): number {
  let total = 0;
  for (const id of [...new Set(fixIds.filter(Boolean))]) {
    const tier = getFixEffortTier(id, opts?.riskByFixId?.[id]);
    if (tier === "trivial" || tier === "low") continue;
    if (tier === "ai") total += AI_FIX_EFFORT[id] ?? 2;
    else if (tier === "medium") total += 1;
    else total += 2;
  }
  return total;
}

export async function insertFixJobRecord(data: CreateFixRequestInput, userLogin: string) {
  await assertNotMaintenanceMode();
  await assertRepoOwner(data.repoId, userLogin);

  const selectedFixes = data.fixes.split(",").filter(Boolean);
  await assertFixesAllowed(selectedFixes);

  const db = getDataStore();
  const jobId = crypto.randomUUID();
  const branchName = sanitizeFixBranchName(data.branchName?.trim() || defaultFixBranchName());

  const riskByFixId = await loadFixRiskMap(data.scanId);
  // AI-effort estimate for this batch (heavier selections warn longer in the UI).
  // Cache hits on previously generated AI tests waive the AI part of the estimate.
  const effortCost = estimateJobEffort(selectedFixes, { riskByFixId });

  // Interactive fix jobs outrun queued monitor scans.
  const priority = 1;

  const { error } = await db.from("fix_requests").insert({
    id: jobId,
    repo_id: data.repoId,
    scan_id: data.scanId,
    fixes: data.fixes,
    status: "pending",
    branch_name: branchName,
    est_files_added: data.estFilesAdded,
    est_files_changed: data.estFilesChanged,
    est_deps: data.estDeps,
    effort_score: effortCost,
    owner_login: userLogin,
    priority,
  });

  if (error) throw new Error(error.message);

  return { jobId, effortScore: effortCost };
}

export async function startPendingFixJob(jobId: string, userLogin: string) {
  await assertJobOwner(jobId, userLogin);

  const db = getDataStore();
  const githubToken = getGitHubToken();
  if (!githubToken) throw new Error("GitHub token unavailable — please reconnect.");

  type JobRow = {
    id: string;
    status: string;
    effort_score: number;
    scan_id: string;
    fixes: string;
    repo_id: string;
    repos: { full_name: string } | null;
  };
  const { data: jobRaw, error } = await db
    .from("fix_requests")
    .select("id, status, effort_score, scan_id, fixes, repo_id, repos(full_name)")
    .eq("id", jobId)
    .single();
  const job = jobRaw as unknown as JobRow | null;

  if (error || !job) throw new Error("Job not found");
  if (job.status !== "pending") throw new Error("Job is not in pending state");

  await db
    .from("fix_requests")
    .update({
      status: "running",
      owner_login: userLogin,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  const repoFullName = job.repos?.full_name ?? "";
  if (!repoFullName) throw new Error("Repository not found for this job.");

  const { assertGitHubRepoWriteAccess, probeGitHubGitWrite } = await import("./github.server");
  await assertGitHubRepoWriteAccess(githubToken, repoFullName);
  await probeGitHubGitWrite(githubToken, repoFullName);

  const fixIds = job.fixes.split(",").filter(Boolean);
  const { enqueueDurableJob } = await import("./jobs.server");

  await enqueueDurableJob({
    type: "fix_run",
    fixRequestId: jobId,
    userLogin,
    repoFullName,
    effortScore: job.effort_score,
    fixIds,
    scanId: job.scan_id,
  });

  return { jobId };
}

// Creates a fix_request job with status=pending and returns its ID.

// ─── Fix output cache ─────────────────────────────────────────────────────────

const FIX_CACHE_TTL_DAYS = 1;
type FixFile = { path: string; content: string };

export async function getFixCache(
  db: ReturnType<typeof getDataStore>,
  repoId: string,
  fixIds: string[],
): Promise<FixFile[] | null> {
  const key = [...fixIds].sort().join(",");
  const cutoff = new Date(Date.now() - FIX_CACHE_TTL_DAYS * 86_400_000).toISOString();
  const { data } = await db
    .from("fix_cache")
    .select("files_json, created_at")
    .eq("repo_id", repoId)
    .eq("fix_ids", key)
    .gt("created_at", cutoff)
    .maybeSingle();
  if (!data) return null;
  try {
    const files = JSON.parse(data.files_json) as FixFile[];
    if (files.length === 0) return null;
    return files;
  } catch {
    return null;
  }
}

export function emptyFixJobMessage(fixIds: string[], notes: VerificationNote[]): string {
  const stripeNote = notes.find((n) => n.fixId === "auditor-stripe-webhook");
  if (stripeNote?.note.includes("already verified")) {
    return `${stripeNote.note} Re-scan your repo to clear this finding — no PR is needed.`;
  }
  if (fixIds.includes("auditor-stripe-webhook")) {
    return "No patchable Stripe webhook route was found. Your webhooks may already be verified, or the handler uses a pattern we cannot auto-patch yet. Re-scan after verifying manually.";
  }
  return "No file changes were generated for the selected fixes. They may already be applied — try re-scanning your repo.";
}

export async function setFixCache(
  db: ReturnType<typeof getDataStore>,
  repoId: string,
  fixIds: string[],
  framework: string,
  files: FixFile[],
): Promise<void> {
  if (files.length === 0) return;
  const key = [...fixIds].sort().join(",");
  await db
    .from("fix_cache")
    .upsert(
      { repo_id: repoId, fix_ids: key, framework, files_json: JSON.stringify(files) },
      { onConflict: "repo_id,fix_ids" },
    );
}

export async function resolveAuditorTargetPaths(
  db: ReturnType<typeof getDataStore>,
  scanId: string,
  fixIds: string[],
): Promise<Partial<Record<string, string>>> {
  const auditorIds = fixIds.filter((id) => id.startsWith("auditor-"));
  if (auditorIds.length === 0) return {};

  const { data } = await db
    .from("issues")
    .select("fix_id, why")
    .eq("scan_id", scanId)
    .in("fix_id", auditorIds);

  const paths: Partial<Record<string, string>> = {};
  for (const row of data ?? []) {
    if (row.fix_id === "auditor-stripe-webhook") {
      const route = parseAuditorRoutePath(row.why);
      if (route) paths["auditor-stripe-webhook"] = route;
    }
  }
  return paths;
}

export function aiFixIdsForJob(fixIds: string[]): string[] {
  return fixIds.filter((id) => AI_FIX_IDS.has(id) && !DETERMINISTIC_AUDITOR_FIX_IDS.has(id));
}

export async function assertFixesAllowed(fixIds: string[]): Promise<void> {
  const flags = await getFeatureFlags();
  const aiIds = aiFixIdsForJob(fixIds);
  if (!flags.flag_ai_fixes && aiIds.length > 0) {
    throw new Error("AI-generated fixes are temporarily disabled. Try again later.");
  }
  if (!flags.flag_playwright_ai && fixIds.includes("playwright-ai")) {
    throw new Error("Playwright E2E (AI) is temporarily disabled. Try again later.");
  }
}

export async function aiFixIdsForJobFiltered(fixIds: string[]): Promise<string[]> {
  const flags = await getFeatureFlags();
  return aiFixIdsForJob(fixIds).filter((id) => {
    if (id === "playwright-ai" && !flags.flag_playwright_ai) return false;
    return flags.flag_ai_fixes;
  });
}

// githubToken + scanId are needed for AI test generation.
export async function runFixJob(
  jobId: string,
  repoFullName: string,
  ownerLogin: string,
  effortScore: number,
  fixIds: string[],
  scanId: string,
  githubToken: string,
) {
  const db = getDataStore();
  try {
    await assertFixesAllowed(fixIds);
    // Fetch branch name, default branch, framework and repo name
    const { data: jobMeta } = await db
      .from("fix_requests")
      .select("repo_id, branch_name, repos(default_branch, framework, name)")
      .eq("id", jobId)
      .single();

    const repoId = (jobMeta as { repo_id?: string } | null)?.repo_id ?? "";
    const branchName =
      (jobMeta as { branch_name?: string } | null)?.branch_name ?? defaultFixBranchName();
    const repoMeta = (
      jobMeta as {
        repos?: {
          default_branch?: string | null;
          framework?: string | null;
          name?: string | null;
        } | null;
      } | null
    )?.repos;
    const defaultBranch = repoMeta?.default_branch ?? "main";
    const framework = repoMeta?.framework ?? "unknown";
    const repoName = repoMeta?.name ?? repoFullName.split("/")[1] ?? "project";

    // Check fix_cache first — skip file generation if we have a fresh result
    // Env-example fixes read the current repo file state, so skip cache for them
    type FixFile = { path: string; content: string };
    const ENV_SENSITIVE_IDS = new Set([
      "env-example",
      "env-example-ai",
      "auditor-env-undocumented",
      "auditor-env-gap",
    ]);
    const skipCache = fixIds.some((id) => ENV_SENSITIVE_IDS.has(id));
    let files: FixFile[] | null = skipCache ? null : await getFixCache(db, repoId, fixIds);
    if (files?.length === 0) files = null;
    let aiFilesJson: string | null = null;
    let verificationNotes: VerificationNote[] = [];

    const auditorTargetPaths = await resolveAuditorTargetPaths(db, scanId, fixIds);

    if (files) {
      // Cache hit — still regenerate AI content if present (it may have changed)
      const aiFixIds = await aiFixIdsForJobFiltered(fixIds);
      if (aiFixIds.length > 0) {
        const rawAiFiles = await generateAiTests(
          scanId,
          aiFixIds,
          repoFullName,
          githubToken,
          framework,
        );
        const aiFiles = rawAiFiles
          .filter((f) => !/^playwright\.config\.(ts|js|mjs)$/i.test(f.path))
          .map((f) => ({ path: f.path, content: f.content }));
        aiFilesJson = JSON.stringify(aiFiles);
        const aiPaths = new Set(aiFiles.map((f) => f.path));
        files = [...files.filter((f) => !aiPaths.has(f.path)), ...aiFiles];
      }
    } else {
      // Cache miss — generate everything fresh
      const aiFixIds = await aiFixIdsForJobFiltered(fixIds);
      let aiFiles: AiTestFile[] | undefined;
      if (aiFixIds.length > 0) {
        const rawAiFiles = await generateAiTests(
          scanId,
          aiFixIds,
          repoFullName,
          githubToken,
          framework,
        );
        aiFiles = rawAiFiles.map((f) => ({ path: f.path, content: f.content }));
        aiFilesJson = JSON.stringify(aiFiles);
      }
      const collectResult = await collectFixFiles(githubToken, repoFullName, fixIds, {
        framework,
        repoName,
        aiFiles,
        auditorTargetPaths,
      });
      files = collectResult.files;
      verificationNotes = collectResult.verificationNotes;

      if (collectResult.preflight && !collectResult.preflight.passed) {
        const { preflightBlockMessage } = await import("./fix-preflight.server");
        const { error: failErr } = await db
          .from("fix_requests")
          .update({
            status: "failed",
            error_message: preflightBlockMessage(collectResult.preflight),
            pending_verification_notes: JSON.stringify(verificationNotes),
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
        if (failErr) throw new Error(failErr.message);
        return;
      }

      if (files.length === 0) {
        const { error: failErr } = await db
          .from("fix_requests")
          .update({
            status: "failed",
            error_message: emptyFixJobMessage(fixIds, verificationNotes),
            pending_verification_notes: JSON.stringify(verificationNotes),
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
        if (failErr) throw new Error(failErr.message);
        return;
      }
      // Persist for future jobs on this repo
      await setFixCache(db, repoId, fixIds, framework, files);
    }

    // Phase 8 — multi-agent: prefer agent-generated files when present (before awaiting_review).
    let agentReasoningJson: Json | undefined;
    try {
      const { runAgentFixAttempt, mergeAgentGeneratedFiles } = await import("./agent-fix.server");
      const agentAttempt = await runAgentFixAttempt(scanId, fixIds, repoId);
      if (agentAttempt) {
        let filesApplied = false;
        if (agentAttempt.files.length > 0 && files) {
          files = mergeAgentGeneratedFiles(files, agentAttempt.files);
          filesApplied = true;
        }
        agentReasoningJson = {
          ...agentAttempt.reasoning,
          filesApplied,
        } as unknown as Json;
      }
    } catch (e) {
      console.error("[multi-agent] reasoning/file capture failed:", e);
    }

    // Hold the generated output for user review — nothing is committed to GitHub yet.
    // The user approves (createPRFromFiles runs in approveFixRequest) or regenerates from here.
    const { error: pendErr } = await db
      .from("fix_requests")
      .update({
        status: "awaiting_review",
        pending_files: JSON.stringify(files),
        pending_verification_notes: JSON.stringify(verificationNotes),
        ...(aiFilesJson ? { pending_ai_files: aiFilesJson } : {}),
        ...(agentReasoningJson ? { agent_reasoning: agentReasoningJson } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (pendErr) throw new Error(`Failed to save generated output: ${pendErr.message}`);
  } catch (err) {
    // Preserve the failed job record so the operator can inspect and retry it.
    const { error: failErr } = await db
      .from("fix_requests")
      .update({
        status: "failed",
        error_message: err instanceof Error ? err.message : "Unknown error",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (failErr) console.error("[runFixJob] could not mark job failed:", failErr.message);
  }
}

// Background job: regenerates only the AI-authored files using the user's feedback, keeping
// any template files from the previous attempt untouched. Runs after the user clicks "Try again"
// on the awaiting_review screen. On failure, the previous pending_files are left in place so the
// user can still approve the last good attempt.
export async function regenerateFixJob(
  jobId: string,
  repoFullName: string,
  ownerLogin: string,
  effortScore: number,
  fixIds: string[],
  scanId: string,
  githubToken: string,
  feedback: string,
) {
  const db = getDataStore();
  try {
    await assertFixesAllowed(fixIds);
    const { data: jobMeta } = await db
      .from("fix_requests")
      .select("pending_files, regenerate_count, repos(framework)")
      .eq("id", jobId)
      .single();

    type FixFile = { path: string; content: string };
    const meta = jobMeta as {
      pending_files?: string | null;
      regenerate_count?: number | null;
      repos?: { framework?: string | null } | null;
    } | null;
    const prevFiles: FixFile[] = meta?.pending_files ? JSON.parse(meta.pending_files) : [];
    const framework = meta?.repos?.framework ?? "unknown";
    const regenerateCount = meta?.regenerate_count ?? 0;

    const aiFixIds = await aiFixIdsForJobFiltered(fixIds);
    // bypassCache=true: the user explicitly asked for a new attempt
    // whether or not they wrote feedback, so the retry cannot return the rejected cached result.
    const rawAiFiles = await generateAiTests(
      scanId,
      aiFixIds,
      repoFullName,
      githubToken,
      framework,
      feedback,
      true, // bypassCache
    );
    const aiFiles = rawAiFiles.map((f) => ({ path: f.path, content: f.content }));
    const aiFilesJson = JSON.stringify(aiFiles);
    const aiPaths = new Set(aiFiles.map((f) => f.path));
    const files = [...prevFiles.filter((f) => !aiPaths.has(f.path)), ...aiFiles];

    await db
      .from("fix_requests")
      .update({
        status: "awaiting_review",
        pending_files: JSON.stringify(files),
        pending_ai_files: aiFilesJson,
        regenerate_feedback: feedback || null,
        regenerate_count: regenerateCount + 1,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  } catch (err) {
    // Fall back to awaiting_review — the previous attempt is
    // still sitting in pending_files, so the user hasn't lost anything.
    await db
      .from("fix_requests")
      .update({
        status: "awaiting_review",
        error_message:
          err instanceof Error
            ? err.message
            : "Regeneration failed — your previous version is still available.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }
}

// Transitions a job from pending to running, then starts the background PR job.
