import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { idString } from "./schema-primitives";
import { requireAuthUser } from "../auth.server";
import { enforceRateLimit } from "../rate-limit.server";
import {
  deleteProjectEnvVar,
  listProjectEnvVars,
  upsertProjectEnvVar,
  upsertProjectEnvVarsBulk,
} from "../sandbox/project-env-vars.server";
import {
  getProjectBuildSettingsForOwner,
  saveProjectBuildSettings,
} from "../sandbox/build-settings.server";
import { enqueueSandboxVerify, isEnqueueRefusal } from "../sandbox-verify/enqueue";
import { isReusedSkipReason } from "../sandbox-verify/reuse-reason";
import { getDataStore } from "../data-store.server";
import { getGitHubToken } from "../github-token.server";
import { assertRepoOwner } from "../auth.server";

export const listRepoEnvVarsFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await enforceRateLimit("scan", user.login);
    return listProjectEnvVars(data.repoId, user.login);
  });

export const upsertRepoEnvVarFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      repoId: idString,
      key: z.string().min(1).max(128),
      value: z.string().min(1).max(8_000),
      isSecret: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await enforceRateLimit("sandbox", user.login);
    return upsertProjectEnvVar({
      repoId: data.repoId,
      userLogin: user.login,
      key: data.key,
      value: data.value,
      isSecret: data.isSecret,
    });
  });

/** Paste-a-.env bulk import — one rate-limit hit for the whole paste, not one per line. */
export const upsertRepoEnvVarsBulkFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      repoId: idString,
      entries: z
        .array(z.object({ key: z.string().min(1).max(128), value: z.string().min(1).max(8_000) }))
        .min(1)
        .max(100),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await enforceRateLimit("sandbox", user.login);
    return upsertProjectEnvVarsBulk({
      repoId: data.repoId,
      userLogin: user.login,
      entries: data.entries,
    });
  });

export const deleteRepoEnvVarFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ repoId: idString, key: z.string().min(1).max(128) }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await enforceRateLimit("sandbox", user.login);
    await deleteProjectEnvVar({
      repoId: data.repoId,
      userLogin: user.login,
      key: data.key,
    });
    return { ok: true };
  });

/** Build overrides plus the last run's actual commands, so the UI can show what we
 *  detected instead of asking the user to fill in a blank form. */
export const getRepoBuildSettingsFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const settings = await getProjectBuildSettingsForOwner(data.repoId, user.login);
    const db = getDataStore();
    const { data: lastRun } = await db
      .from("sandbox_verify_runs")
      .select("planned_steps, created_at, structured_results")
      .eq("repo_id", data.repoId)
      .not("planned_steps", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // What the sandbox actually reported running, so the Node field can show the real
    // resolved version rather than only echoing back whatever the repo declared.
    const discovered = (lastRun?.structured_results as { discovered?: Record<string, unknown> })
      ?.discovered;
    const nodeVersion = typeof discovered?.nodeVersion === "string" ? discovered.nodeVersion : null;
    return {
      settings,
      lastRun: lastRun
        ? {
            createdAt: lastRun.created_at as string,
            nodeVersion,
            steps:
              (lastRun.planned_steps as Array<{ step: string; command: string; cwd?: string }>) ??
              [],
          }
        : null,
    };
  });

export const saveRepoBuildSettingsFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      repoId: idString,
      rootDir: z.string().max(200).nullable(),
      buildCommand: z.string().max(500).nullable(),
      nodeVersion: z.string().max(20).nullable(),
      includeTest: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await enforceRateLimit("sandbox", user.login);
    return saveProjectBuildSettings({
      repoId: data.repoId,
      userLogin: user.login,
      rootDir: data.rootDir,
      buildCommand: data.buildCommand,
      nodeVersion: data.nodeVersion,
      includeTest: data.includeTest,
    });
  });

export const getSandboxVerifyStatusFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ runId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const db = getDataStore();
    const { data: row, error } = await db
      .from("sandbox_verify_runs")
      .select(
        "status, started_at, finished_at, planned_steps, current_step, completed_steps, live_log, raw_log, structured_results, error_message",
      )
      .eq("id", data.runId)
      .eq("user_id", user.login)
      .single();
    if (error || !row) throw new Error("Sandbox verify run not found");
    const status = row.status as "queued" | "running" | "passed" | "failed" | "skipped";
    const terminal = status === "passed" || status === "failed" || status === "skipped";
    const structured =
      row.structured_results && typeof row.structured_results === "object"
        ? (row.structured_results as Record<string, unknown>)
        : {};
    const skipReason = typeof structured.skipReason === "string" ? structured.skipReason : null;
    // "Install failed." is the wrong sentence for a run that never got to finish — the step
    // did not fail, it was taken away. The UI needs to say which happened.
    const inconclusive =
      structured.inconclusive === "budget_kill" || structured.inconclusive === "flaky_infra"
        ? structured.inconclusive
        : null;
    const errorMessage =
      typeof row.error_message === "string" && row.error_message.trim()
        ? row.error_message.trim()
        : null;
    // Prefer raw_log when present; otherwise live_log. If the run crashed before any step
    // log was written, append error_message so the terminal isn't a lone "queue wait" line.
    let liveLog = ((terminal && row.raw_log) || row.live_log || "") as string;
    if (terminal && errorMessage && !liveLog.includes(errorMessage)) {
      liveLog = `${liveLog}${liveLog && !liveLog.endsWith("\n") ? "\n" : ""}[sandbox] error: ${errorMessage}\n`;
    }
    return {
      status,
      startedAt: row.started_at as string | null,
      finishedAt: row.finished_at as string | null,
      plannedSteps: (row.planned_steps as Array<{ step: string; command: string }> | null) ?? [],
      currentStep: row.current_step as string | null,
      completedSteps:
        (row.completed_steps as Array<{
          step: string;
          command: string;
          exitCode: number;
          durationMs: number;
        }> | null) ?? [],
      liveLog,
      skipReason,
      inconclusive,
      errorMessage,
    };
  });

/** The sandbox row attached to the current scan — the same run the verdict page reads. */
export const getCurrentAnalysisSandboxRunFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    const db = getDataStore();
    const { data: scan } = await db
      .from("scans")
      .select("id")
      .eq("repo_id", data.repoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!scan) return null;

    const { data: run } = await db
      .from("sandbox_verify_runs")
      .select("id, status")
      .eq("scan_id", scan.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return run
      ? {
          id: run.id,
          status: run.status as "queued" | "running" | "passed" | "failed" | "skipped",
        }
      : null;
  });

/**
 * Tab counts are derived from a capped status-only fetch rather than five head counts —
 * run history is bounded, so one small query beats five round trips.
 */
const RUN_COUNT_SCAN_CAP = 2000;

/** Recent sandbox verify runs for a repo — powers the settings-page run history list. */
export const listSandboxVerifyRunsFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      repoId: idString,
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
      status: z.enum(["all", "passed", "failed", "skipped"]).default("all"),
      q: z.string().trim().max(200).optional(),
      /** Off by default — the sandbox page reads one row and must not pay for the scan. */
      includeCounts: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    const db = getDataStore();
    const page = data.page ?? 1;
    const pageSize = data.pageSize ?? 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const status = data.status ?? "all";
    const q = data.q?.trim();

    // Counts span every run, not just the visible page — a tab reading "Failed 3" while
    // page 2 holds a fourth failure is worse than no tab at all.
    const counts = { all: 0, passed: 0, failed: 0, skipped: 0 };
    if (data.includeCounts) {
      const { data: statusRows, error: statusError } = await db
        .from("sandbox_verify_runs")
        .select("status")
        .eq("repo_id", data.repoId)
        .limit(RUN_COUNT_SCAN_CAP);
      if (statusError) throw new Error(statusError.message);
      for (const row of statusRows ?? []) {
        counts.all += 1;
        if (row.status === "passed") counts.passed += 1;
        else if (row.status === "failed" || row.status === "timeout") counts.failed += 1;
        else if (row.status === "skipped") counts.skipped += 1;
      }
    }

    let listQuery = db
      .from("sandbox_verify_runs")
      .select(
        "id, status, created_at, started_at, finished_at, package_manager, error_message, git_sha, branch_name, completed_steps, structured_results",
        { count: "exact" },
      )
      .eq("repo_id", data.repoId);
    // "timeout" is a failure from the user's point of view — it belongs under the Failed tab.
    if (status === "failed") listQuery = listQuery.in("status", ["failed", "timeout"]);
    else if (status !== "all") listQuery = listQuery.eq("status", status);
    if (q) {
      const safe = q.replace(/[%,()]/g, "");
      if (safe) {
        listQuery = listQuery.or(
          `git_sha.ilike.%${safe}%,branch_name.ilike.%${safe}%,error_message.ilike.%${safe}%`,
        );
      }
    }

    const {
      data: rows,
      error,
      count,
    } = await listQuery.order("created_at", { ascending: false }).range(from, to);
    if (error) throw new Error(error.message);

    return {
      runs: (rows ?? []).map((r) => {
        const steps =
          (r.completed_steps as Array<{
            step: string;
            command: string;
            exitCode: number;
            durationMs: number;
          }> | null) ?? [];
        const structured =
          r.structured_results && typeof r.structured_results === "object"
            ? (r.structured_results as Record<string, unknown>)
            : {};
        const failedStep = steps.find((s) => s.exitCode !== 0);
        return {
          id: r.id,
          status: r.status as "queued" | "running" | "passed" | "failed" | "skipped" | "timeout",
          createdAt: r.created_at as string,
          startedAt: r.started_at as string | null,
          finishedAt: r.finished_at as string | null,
          packageManager: r.package_manager as string | null,
          errorMessage: r.error_message as string | null,
          gitSha: r.git_sha as string | null,
          branchName: r.branch_name as string | null,
          stepsPassed: steps.filter((s) => s.exitCode === 0).length,
          stepsTotal: steps.length,
          /** Which step broke — the single most useful thing about a failed run. */
          failedStep: failedStep?.step ?? null,
          /** Set when this row mirrors an earlier result instead of a real build. */
          reused: isReusedSkipReason(structured.skipReason as string | null),
        };
      }),
      counts,
      total: count ?? 0,
      page,
      pageSize,
    };
  });

/** Full detail (step checklist + raw log) for one sandbox verify run. */
export const getSandboxVerifyRunDetailFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ runId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const db = getDataStore();
    const { data: row, error } = await db
      .from("sandbox_verify_runs")
      .select(
        "id, repo_id, status, created_at, started_at, finished_at, planned_steps, completed_steps, raw_log, live_log, error_message",
      )
      .eq("id", data.runId)
      .single();
    if (error || !row) throw new Error("Sandbox verify run not found");
    await assertRepoOwner(row.repo_id, user.login);
    return {
      id: row.id,
      status: row.status as "queued" | "running" | "passed" | "failed" | "skipped",
      createdAt: row.created_at as string,
      startedAt: row.started_at as string | null,
      finishedAt: row.finished_at as string | null,
      plannedSteps: (row.planned_steps as Array<{ step: string; command: string }> | null) ?? [],
      completedSteps:
        (row.completed_steps as Array<{
          step: string;
          command: string;
          exitCode: number;
          durationMs: number;
        }> | null) ?? [],
      // raw_log is the complete final log; live_log is the best-effort streamed
      // capture — fall back to it when a run was interrupted before finishing.
      rawLog: (row.raw_log as string | null) || (row.live_log as string | null),
      errorMessage: row.error_message as string | null,
    };
  });

/** Manual "verify this repo" action. */
export const triggerSandboxVerifyFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      repoId: idString,
      includeTest: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await enforceRateLimit("sandbox", user.login);
    await assertRepoOwner(data.repoId, user.login);

    const token = getGitHubToken();
    if (!token) throw new Error("GitHub token unavailable — please reconnect.");

    const db = getDataStore();
    const { data: repo, error } = await db
      .from("repos")
      .select("full_name, default_branch")
      .eq("id", data.repoId)
      .single();
    if (error || !repo) throw new Error("Repo not found");

    // Link to the repo's current scan so the verdict page's sandbox status updates
    // immediately — without this, a manual retry here left the verdict page showing
    // the *previous* run's outcome (e.g. "skipped") forever, even after a fresh run
    // actually passed.
    const { data: latestScan } = await db
      .from("scans")
      .select("id")
      .eq("repo_id", data.repoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const result = await enqueueSandboxVerify({
      repoId: data.repoId,
      repoFullName: repo.full_name,
      userLogin: user.login,
      defaultBranch: repo.default_branch ?? "main",
      githubToken: token,
      includeTest: data.includeTest,
      scanId: latestScan?.id,
      origin: "manual",
    });
    // Each refusal carries the sentence that explains the provider or concurrency condition.
    if (isEnqueueRefusal(result)) throw new Error(result.message);
    return result;
  });
