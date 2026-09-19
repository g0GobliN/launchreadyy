import { getDataStore } from "../data-store.server";
import type { SandboxVerifyJobPayload } from "../jobs.server";
import { getSandboxAdapter } from "../adapters/sandbox";
import {
  detectSandboxCommands,
  detectSandboxEcosystem,
  sandboxImageSupports,
} from "../sandbox/commands";
import { repoPath } from "../sandbox/build-settings";
import { getProjectBuildSettings } from "../sandbox/build-settings.server";
import {
  mergeEnvVars,
  parseEnvExampleLiterals,
  redactableEnvValues,
} from "../sandbox/env-placeholder";
import { resolveExactNodeVersion, resolveSandboxNodeVersion } from "../sandbox/node-version";
import { redactSecrets, truncateLog } from "../sandbox/redact";
import { isFeatureEnabled } from "../site-config.server";
import { loadDecryptedProjectEnvVars } from "../sandbox/project-env-vars.server";
import { acquireSandboxSlot, releaseSandboxSlot } from "./concurrency";
import { secretSweepCommand } from "./secret-sweep";
import {
  inconclusiveReason,
  missingImageToolchains,
  type InconclusiveReason,
} from "./failure-classify";
import { SANDBOX_TIMEOUT_MS } from "../fix-meta";
import { writeSandboxAudit } from "../sandbox/audit.server";
import { estimateSandboxCostUsd, resolveSandboxDurationMs } from "../sandbox/cost";
import { upsertKnowledgeFact } from "../repo-knowledge.server";
import { findingFingerprint } from "../finding-fingerprint";
import type { IssueInput } from "../scanner-rules";
import { isProbeStep, type SandboxStepResult } from "../adapters/sandbox";

/** Wall-clock ceiling for one sandbox run. */
const MAX_LOG_CHARS = 32_000;

export type StructuredResults = {
  issues: IssueInput[];
  discovered: Record<string, unknown>;
  steps: Array<{
    step: string;
    command: string;
    exitCode: number;
    durationMs: number;
  }>;
  skipReason?: string;
  /** Set when the run reached no verdict about the repo — never cached for reuse. */
  inconclusive?: InconclusiveReason;
};

export function githubCloneUrl(fullName: string): string {
  return `https://github.com/${fullName}.git`;
}

export function stepsToIssues(steps: SandboxStepResult[], verifiedAt: string): IssueInput[] {
  const issues: IssueInput[] = [];
  for (const step of steps) {
    if (step.exitCode === 0) continue;
    // A probe reports through its output, not its exit status — a non-zero sweep is a
    // problem with our tooling, not a "Deployment" defect in the user's repo.
    if (isProbeStep(step.step)) continue;
    const evidence = (step.stderr || step.stdout).trim().slice(0, 500) || `exit ${step.exitCode}`;
    issues.push({
      category: step.step === "lint" ? "Code Quality" : "Deployment",
      title: `${step.step} failed in sandboxed verification`,
      severity: step.step === "install" || step.step === "build" ? "high" : "medium",
      why: `Command \`${step.command}\` exited with code ${step.exitCode} inside an isolated sandbox.`,
      timeSaved: "30m",
      fixId: `sandbox-${step.step}`,
      checkedFor: [step.command],
      foundEvidence: evidence,
      confidence: "high",
      detection: ["sandbox-verified"],
      recommendedFix: `Fix the ${step.step} failure locally, then re-run verification.`,
      verifiedAt,
    });
  }
  return issues;
}

/**
 * Process a sandbox_verify durable job.
 * Additive: provider unavailable / kill-switch → status=skipped, never blocks the caller hard.
 */
export async function processSandboxVerifyJob(payload: SandboxVerifyJobPayload): Promise<void> {
  const db = getDataStore();
  const runId = payload.runId;

  // Before the row flips to "running": a job waiting on a free slot has not started, and
  // saying otherwise would strand it as a running row with no sandbox behind it. Throws
  // SandboxPoolBusyError when the pool is full, which the job runner defers rather than
  // counts as an attempt. The run stays queued, and queueWaitMs below measures the real wait.
  await acquireSandboxSlot(runId);

  const startedAt = new Date();
  const { data: runRow } = await db
    .from("sandbox_verify_runs")
    .update({ status: "running", started_at: startedAt.toISOString() })
    .eq("id", runId)
    .select("created_at")
    .single();
  // How long the job sat in the queue before a worker picked it up — the first hop
  // people notice as "why is this run slower than the last one."
  const queueWaitMs = runRow
    ? startedAt.getTime() - new Date(runRow.created_at).getTime()
    : undefined;

  try {
    if (!(await isFeatureEnabled("flag_sandbox_verify"))) {
      await markSkipped(runId, "Sandbox verification is disabled (flag_sandbox_verify)", payload);
      return;
    }

    const adapter = getSandboxAdapter();
    if (!adapter.available()) {
      await markSkipped(runId, "Sandbox provider not configured (missing E2B_API_KEY)", payload);
      return;
    }

    const { getGitHubToken, GITHUB_TOKEN_MISSING } = await import("../github-token.server");
    const token = getGitHubToken();
    if (!token) {
      throw new Error(GITHUB_TOKEN_MISSING);
    }

    const { GitHubFileProvider } = await import("../scan-engine/github-file-provider");
    // Planning the build needs the file list plus two or three manifests. Waiting on the repo
    // tarball for that put ~90s of silence in front of every run — the sandbox had already
    // booted and cloned, and the UI had nothing to show. The tarball still downloads in the
    // background for the secret sweep, which reads in bulk and genuinely wants it.
    const provider = new GitHubFileProvider(token, payload.repoFullName, payload.defaultBranch, {
      deferSnapshot: true,
    });
    const filePaths = await provider.listFiles();

    // Saved overrides, if the user ever corrected our detection. Everything below
    // reads the app's files through `rootDir` so a monorepo subdirectory is looked
    // at instead of the repo root.
    const buildSettings = await getProjectBuildSettings(payload.repoId);
    const rootDir = buildSettings.rootDir;

    let scripts: Record<string, string> = {};
    let envKeys: string[] = [];
    let exampleValues: Record<string, string> = {};
    let enginesNode: string | undefined;

    try {
      const pkgRaw = await provider.readFile(repoPath(rootDir, "package.json"));
      if (pkgRaw) {
        const pkg = JSON.parse(pkgRaw) as {
          scripts?: Record<string, string>;
          engines?: { node?: string };
        };
        scripts = pkg.scripts ?? {};
        enginesNode = pkg.engines?.node;
      }
    } catch {
      /* non-node, or malformed package.json — polyglot path may still apply */
    }

    const ecosystem = detectSandboxEcosystem(filePaths, rootDir);
    // Without a supported manifest, install/build commands cannot succeed, and a
    // *failed* run hard-gates the score UI. Skipping releases the verdict; static
    // analysis still ran.
    if (!ecosystem) {
      await markSkipped(
        runId,
        rootDir
          ? `No supported project manifest under "${rootDir}" (package.json, go.mod, pyproject.toml, requirements.txt, Gemfile, composer.json, Cargo.toml, pom.xml/gradle, *.csproj, mix.exs). Static analysis results are unaffected.`
          : "No supported project manifest found for sandbox verification. Static analysis results are unaffected.",
        payload,
      );
      return;
    }

    if (!sandboxImageSupports(ecosystem)) {
      await markSkipped(
        runId,
        `Live install/build sandbox does not include the ${ecosystem} toolchain in this template. Rebuild launchreadyy (npm run e2b:build:prod) or use static analysis only; static analysis and fixes still apply.`,
        payload,
      );
      return;
    }

    // Node version pin only applies to Node ecosystems.
    let nvmrc: string | undefined;
    let requestedNodeVersion: string | undefined;
    let nodeVersion: string | undefined;
    let nodeResolutionNote: string | undefined;
    if (ecosystem === "node") {
      for (const candidate of [repoPath(rootDir, ".nvmrc"), ".nvmrc"]) {
        if (nvmrc || !filePaths.includes(candidate)) continue;
        try {
          nvmrc = (await provider.readFile(candidate)) ?? undefined;
        } catch {
          /* ignore */
        }
      }

      // Explicit setting wins: it exists precisely for repos whose own files declare
      // nothing, or declare a version that turns out to be wrong.
      requestedNodeVersion =
        buildSettings.nodeVersion ?? resolveSandboxNodeVersion({ nvmrc, enginesNode });
      nodeVersion = requestedNodeVersion
        ? await resolveExactNodeVersion(requestedNodeVersion)
        : undefined;
      // Surfaced even when nothing downloads yet — otherwise "repo wants Node 22 but we
      // couldn't resolve an exact release for it" looks identical to "repo never asked
      // for a specific Node version," and both look like silence in the log.
      nodeResolutionNote =
        requestedNodeVersion && !nodeVersion
          ? `[sandbox] repo wants Node ${requestedNodeVersion}, but couldn't resolve an exact release from nodejs.org — continuing with the sandbox's default Node\n`
          : undefined;
    }

    for (const name of [".env.example", ".env.sample", ".env.template"]) {
      if (!filePaths.includes(name)) continue;
      try {
        const content = await provider.readFile(name);
        if (content) {
          const parsed = parseEnvExampleLiterals(content);
          exampleValues = { ...exampleValues, ...parsed };
          envKeys = [...new Set([...envKeys, ...Object.keys(parsed)])];
        }
      } catch {
        /* ignore */
      }
    }

    let userValues: Record<string, string> = {};
    try {
      userValues = await loadDecryptedProjectEnvVars(payload.repoId, payload.userLogin, runId);
      envKeys = [...new Set([...envKeys, ...Object.keys(userValues)])];
    } catch (e) {
      console.error("[sandbox-verify] env decrypt failed:", e);
    }

    // Phase 9 priming — pre-seed env key names learned from prior runs.
    try {
      const { loadSandboxPriming } = await import("../sandbox/learning.server");
      const priming = await loadSandboxPriming(payload.repoId);
      if (priming.envVarNames.length > 0) {
        envKeys = [...new Set([...envKeys, ...priming.envVarNames])];
      }
    } catch (e) {
      console.error("[sandbox-priming]", e);
    }

    const merged = mergeEnvVars({ keys: envKeys, userValues, exampleValues });
    const env = merged.valuesAsRecord();
    // Not every env value is a secret. Scrubbing all of them blanked ordinary config words
    // wherever they appeared in the build output — including the synthesized `false` for an
    // ENABLE_* key, which turned a real "Type 'true' is not assignable to type 'false'" into
    // "type [REDACTED]" in the one artifact users read when a build fails.
    const secretValues = redactableEnvValues(merged.entries);

    const commandSet = detectSandboxCommands({
      filePaths,
      scripts,
      // Either the run asked for tests explicitly, or the repo has them switched on.
      includeTest: payload.includeTest === true || buildSettings.includeTest,
      rootDir,
      buildCommand: buildSettings.buildCommand,
    });

    if (commandSet.commands.length === 0) {
      await markSkipped(
        runId,
        `Detected ${ecosystem} project but no sandbox commands could be planned. Static analysis results are unaffected.`,
        payload,
      );
      return;
    }

    // Whole-repo secret sweep runs *first*, deliberately:
    //   1. before `install` writes node_modules, which would dwarf the tree it greps;
    //   2. it needs no dependencies, so it still runs on repos whose install or build fails —
    //      and the adapter stops at the first non-zero step, so anything queued after a broken
    //      install would never execute.
    //
    // Restricted to the default branch: the sweep lists candidate paths from whichever ref the
    // sandbox cloned, but the authoritative re-read goes through the repo snapshot, which fetches
    // `/tarball` with no ref and so is always the default branch. On a fix branch that would pair
    // one branch's paths with another branch's content.
    const sweepRunsOnClonedRef =
      (payload.branchName ?? payload.defaultBranch) === payload.defaultBranch;
    if (sweepRunsOnClonedRef) {
      commandSet.commands.unshift({ step: "secret-sweep", command: secretSweepCommand() });
    }

    await writeSandboxAudit({
      userId: payload.userLogin,
      repoId: payload.repoId,
      action: "sandbox_dispatch",
      jobId: runId,
      meta: {
        commands: commandSet.commands.map((c) => c.step),
        packageManager: commandSet.packageManager,
        ecosystem: commandSet.ecosystem,
        rootDir,
        buildCommandOverridden: Boolean(buildSettings.buildCommand),
      },
    });

    await db
      .from("sandbox_verify_runs")
      .update({
        planned_steps: commandSet.commands,
        current_step: commandSet.commands[0]?.step ?? null,
      })
      .eq("id", runId);

    const completedSteps: Array<{
      step: string;
      command: string;
      exitCode: number;
      durationMs: number;
    }> = [];

    // Best-effort live log stream — throttled so a chatty `npm install` doesn't
    // fire a DB write per line. The final raw_log write below is the complete,
    // authoritative record regardless of what this throttle drops.
    let liveLogBuffer = "";
    let lastLiveLogFlush = 0;
    const LIVE_LOG_FLUSH_MS = 400;
    async function flushLiveLog(force: boolean) {
      const now = Date.now();
      if (!force && now - lastLiveLogFlush < LIVE_LOG_FLUSH_MS) return;
      lastLiveLogFlush = now;
      await db
        .from("sandbox_verify_runs")
        .update({ live_log: truncateLog(liveLogBuffer, MAX_LOG_CHARS * 2) })
        .eq("id", runId);
    }

    if (queueWaitMs !== undefined) {
      liveLogBuffer += `[sandbox] queue wait ${queueWaitMs}ms\n`;
    }
    if (nodeResolutionNote) {
      liveLogBuffer += nodeResolutionNote;
    }
    if (queueWaitMs !== undefined || nodeResolutionNote) {
      await flushLiveLog(true);
    }

    const raw = await adapter.run({
      source: {
        kind: "git",
        url: githubCloneUrl(payload.repoFullName),
        ref: payload.branchName ?? payload.defaultBranch,
        token,
      },
      env,
      commands: commandSet.commands,
      timeoutMs: SANDBOX_TIMEOUT_MS,
      runtime:
        ecosystem === "node"
          ? { language: "node", version: payload.runtimeVersion ?? nodeVersion }
          : undefined,
      onStepStart: async (cmd) => {
        await db.from("sandbox_verify_runs").update({ current_step: cmd.step }).eq("id", runId);
      },
      onStepDone: async (result) => {
        completedSteps.push({
          step: result.step,
          command: result.command,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        });
        await db
          .from("sandbox_verify_runs")
          .update({ completed_steps: completedSteps })
          .eq("id", runId);
        await flushLiveLog(true);
      },
      onLogChunk: async (chunk) => {
        liveLogBuffer += redactSecrets(chunk.text, secretValues);
        await flushLiveLog(false);
      },
    });
    await flushLiveLog(true);

    if (raw.skipped) {
      await markSkipped(runId, raw.skipReason ?? raw.providerError ?? "Sandbox skipped", payload);
      return;
    }

    if (raw.providerError && raw.steps.length === 0) {
      await markSkipped(runId, raw.providerError, payload);
      return;
    }

    // Our image is missing a toolchain it claims to provide. Skipping is the honest outcome:
    // we learned nothing about this repository, and recording "failed" would drive the launch
    // verdict to not_ready over our own gap. See `missingImageToolchains`.
    const missingToolchains = missingImageToolchains(raw.steps);
    if (missingToolchains.length > 0) {
      await markSkipped(
        runId,
        `Sandbox image is missing ${missingToolchains.join(", ")} — this is a problem with our verification environment, not your repository. Your score is unaffected; we're on it.`,
        payload,
      );
      console.error(
        `[sandbox-verify] image missing toolchains: ${missingToolchains.join(", ")} — rebuild the E2B template (npm run e2b:build:prod) and update E2B_TEMPLATE_ID`,
      );
      return;
    }

    // Partial progress before a crash (e.g. Build threw instead of just exiting non-zero)
    // still needs the crash reason visible — otherwise the run just looks like it stopped
    // after Install for no reason.
    if (raw.providerError) {
      liveLogBuffer += `[sandbox] crashed: ${redactSecrets(raw.providerError, secretValues)}\n`;
      await flushLiveLog(true);
    }

    // Redaction is plain substring replacement, so machine-readable step output stays parseable.
    // Truncation is not: truncateLog keeps the *tail* behind a "…[truncated]" prefix, so anything
    // that has to be parsed must be read before it is truncated below.
    const redacted = raw.steps.map((s) => ({
      ...s,
      stdout: redactSecrets(s.stdout, secretValues),
      stderr: redactSecrets(s.stderr, secretValues),
    }));

    const finishedAtDate = new Date();
    const finishedAt = finishedAtDate.toISOString();
    const durationMs = resolveSandboxDurationMs({
      discoveredDurationMs: raw.discovered?.durationMs,
      startedAt,
      finishedAt: finishedAtDate,
    });
    const estCostUsd = estimateSandboxCostUsd(durationMs);
    // The sweep only tells us *which* files look suspicious; the authoritative secret check then
    // reads those few files and decides what is actually reported.
    let sweepIssues: IssueInput[] = [];
    const sweepStep = redacted.find((s) => s.step === "secret-sweep");
    if (sweepStep) {
      try {
        const { issuesFromSecretSweep } = await import("./secret-sweep");
        sweepIssues = await issuesFromSecretSweep({
          stdout: sweepStep.stdout,
          readFile: (p) => provider.readFile(p),
          verifiedAt: finishedAt,
        });
      } catch (e) {
        console.error("[secret-sweep] failed:", e);
      }
    }

    const steps = redacted.map((s) => ({
      ...s,
      stdout: truncateLog(s.stdout, MAX_LOG_CHARS),
      stderr: truncateLog(s.stderr, MAX_LOG_CHARS),
    }));

    // A run that ran out of time or memory, or one whose install died on the package registry,
    // reached no verdict about the repo — so it must not be cached as one. See
    // `inconclusiveReason`. A budget kill stays charged (the minutes were genuinely spent);
    // a registry flake is refunded below, since nothing was learned and it was not the repo's
    // fault either.
    const inconclusive = raw.ok ? null : inconclusiveReason(raw.steps);

    const structured: StructuredResults = {
      ...(inconclusive ? { inconclusive } : {}),
      issues: [...stepsToIssues(steps, finishedAt), ...sweepIssues],
      discovered: {
        packageManager: commandSet.packageManager,
        ...(raw.discovered ?? {}),
        sweepIssueCount: sweepIssues.length,
      },
      steps: steps.map((s) => ({
        step: s.step,
        command: s.command,
        exitCode: s.exitCode,
        durationMs: s.durationMs,
      })),
    };

    const runLog = redactSecrets(
      steps.map((s) => `## ${s.step}\n$ ${s.command}\n${s.stdout}\n${s.stderr}`).join("\n\n"),
      secretValues,
    );

    await db
      .from("sandbox_verify_runs")
      .update({
        status: raw.ok ? "passed" : "failed",
        current_step: null,
        finished_at: finishedAt,
        duration_ms: durationMs,
        est_cost_usd: estCostUsd,
        raw_log: truncateLog(runLog, MAX_LOG_CHARS * 2),
        structured_results: structured,
        package_manager: commandSet.packageManager,
        error_message: raw.providerError ?? null,
      })
      .eq("id", runId);

    // The sandbox died on us partway through, or the package registry did. The steps that did
    // run are worth keeping and showing, but neither is the repo's fault and neither answered
    // the question — so the user should not pay for it. A budget kill is the deliberate
    // exception: it stays charged, because the minutes were really spent on their build.
    await writeDiscoveredFacts(payload, structured, runId);
    // Phase 9 — learn required services/env vars from the run log (no-op unless the flag is on).
    try {
      const { recordSandboxLearning } = await import("../sandbox/learning.server");
      await recordSandboxLearning(payload.repoId, runLog, runId);
    } catch (e) {
      console.error("[sandbox-learning]", e);
    }
    if (payload.scanId) {
      const { SWEEP_SUPERSEDES_FIX_IDS } = await import("./secret-sweep");
      await syncSandboxIssuesToScan(
        payload.scanId,
        structured.issues,
        sweepIssues.length > 0 ? [...SWEEP_SUPERSEDES_FIX_IDS] : [],
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sandbox verify failed";
    // Surface the crash in live_log — otherwise the UI only shows a lone "queue wait"
    // line and a generic "Sandbox build failed." with the real reason buried in DB.
    const prior = (
      await db.from("sandbox_verify_runs").select("live_log").eq("id", runId).maybeSingle()
    ).data?.live_log;
    const liveLog =
      typeof prior === "string" && prior.length > 0
        ? `${prior.endsWith("\n") ? prior : `${prior}\n`}[sandbox] error: ${message}\n`
        : `[sandbox] error: ${message}\n`;
    const failedAt = new Date();
    const durationMs = resolveSandboxDurationMs({
      startedAt,
      finishedAt: failedAt,
    });
    await db
      .from("sandbox_verify_runs")
      .update({
        status: "failed",
        current_step: null,
        finished_at: failedAt.toISOString(),
        duration_ms: durationMs,
        est_cost_usd: estimateSandboxCostUsd(durationMs),
        error_message: message,
        live_log: liveLog,
      })
      .eq("id", runId);
    throw err;
  } finally {
    // Covers the skip paths too — they return early, and a slot held for a disabled
    // feature flag is a slot nobody can use.
    await releaseSandboxSlot(runId);
  }
}

async function markSkipped(
  runId: string,
  reason: string,
  payload?: SandboxVerifyJobPayload,
): Promise<void> {
  const db = getDataStore();
  await db
    .from("sandbox_verify_runs")
    .update({
      status: "skipped",
      current_step: null,
      finished_at: new Date().toISOString(),
      error_message: reason,
      structured_results: { issues: [], discovered: {}, steps: [], skipReason: reason },
    })
    .eq("id", runId);
  if (payload) {
    await writeSandboxAudit({
      userId: payload.userLogin,
      repoId: payload.repoId,
      action: "sandbox_skipped",
      jobId: runId,
      meta: { reason },
    }).catch(() => {});
  }
}

async function writeDiscoveredFacts(
  payload: SandboxVerifyJobPayload,
  structured: StructuredResults,
  runId: string,
): Promise<void> {
  const d = structured.discovered;
  const writes: Promise<unknown>[] = [];
  if (typeof d.packageManager === "string") {
    writes.push(
      upsertKnowledgeFact({
        repoId: payload.repoId,
        factKey: "package_manager",
        scope: "build-sandbox",
        value: d.packageManager,
        tier: 1,
        producer: "sandbox",
        evidenceRef: runId,
        verified: true,
      }),
    );
  }
  if (typeof d.nodeVersion === "string") {
    writes.push(
      upsertKnowledgeFact({
        repoId: payload.repoId,
        factKey: "node_version",
        scope: "build-sandbox",
        value: d.nodeVersion,
        tier: 1,
        producer: "sandbox",
        evidenceRef: runId,
        verified: true,
      }),
    );
  }
  if (typeof d.buildOutputDir === "string") {
    writes.push(
      upsertKnowledgeFact({
        repoId: payload.repoId,
        factKey: "build_output_dir",
        scope: "build-sandbox",
        value: d.buildOutputDir,
        tier: 1,
        producer: "sandbox",
        evidenceRef: runId,
        verified: true,
      }),
    );
  }
  await Promise.all(writes.map((p) => p.catch((e) => console.error("[knowledge]", e))));
}

/**
 * Attach a run's findings to a scan, replacing whatever the last run left there.
 * Exported for `reuse.ts`: a reused run mirrors its status onto a new scan, and the
 * findings have to travel with it or the verdict is drawn from a build nobody checked.
 */
export async function syncSandboxIssuesToScan(
  scanId: string,
  issues: IssueInput[],
  supersedeFixIds: string[] = [],
): Promise<void> {
  const db = getDataStore();
  // Each definitive run (pass or fail) replaces the previous one's sandbox findings for
  // this scan — otherwise every retry (fix one failure, hit the next) stacked a new
  // "install failed" row on top of the old ones instead of superseding it, so a repo
  // that failed five times and then passed still showed five failures forever.
  const { error: deleteError } = await db
    .from("issues")
    .delete()
    .eq("scan_id", scanId)
    .eq("source", "sandbox");
  if (deleteError) {
    console.error("[sandbox-verify] clear stale sandbox issues failed:", deleteError.message);
  }

  // The whole-repo sweep is a strict superset of the fast tier's ~35-file sample, so its finding
  // replaces the sampled one instead of sitting beside it with a different count. Callers only
  // pass ids here when the sweep actually produced findings — superseding on an empty sweep
  // could delete a true positive, which is far worse than showing it twice.
  // Safe to match on fix_id alone: this runs after the stale-sandbox delete above and before the
  // insert below, so no sandbox-sourced row for this scan exists right now — only the fast tier's
  // ("rule"/"auditor") findings can match.
  if (supersedeFixIds.length > 0) {
    const { error } = await db
      .from("issues")
      .delete()
      .eq("scan_id", scanId)
      .in("fix_id", supersedeFixIds);
    if (error) {
      console.error("[sandbox-verify] supersede sampled findings failed:", error.message);
    }
  }

  // A pass produces zero issues but the delete above may have removed a prior run's
  // failures — the score has to come back up, so recompute before returning.
  if (issues.length === 0) {
    await recomputeScanScore(scanId);
    return;
  }

  // Community shows the full finding set — no plan cap.
  const gated = issues;
  if (gated.length === 0) {
    await recomputeScanScore(scanId);
    return;
  }

  // Enrich before insert. These rows used to go in raw, with no risk_level/priority/
  // readiness_category, so the UI sorted them by `priority ?? 99` — putting a leaked
  // credential *below* "add a Prettier config" — and `launchVerdictForScan` could never
  // count one as a blocker, because blockers are `riskLevel === "blocker"`. The deep tier
  // finds the most severe things we detect; it must rank like the fast tier does.
  const { enrichFindings } = await import("../readiness/enrich-finding");
  const enriched = enrichFindings(gated);

  const rows = enriched.map((finding, idx) => ({
    id: `${scanId}-sandbox-${idx}`,
    scan_id: scanId,
    category: finding.category,
    title: finding.title,
    severity: finding.severity,
    why: finding.why,
    time_saved: finding.timeSaved,
    fix_id: finding.fixId,
    risk_level: finding.riskLevel,
    business_impact: finding.businessImpact,
    production_scenario: finding.productionScenario,
    affected_audience: finding.affectedAudience,
    fix_difficulty: finding.fixDifficulty,
    priority: finding.priority,
    auto_fixable: finding.autoFixable,
    readiness_category: finding.readinessCategory,
    checked_for: finding.checkedFor ?? null,
    found_evidence: finding.foundEvidence ?? null,
    confidence: finding.confidence ?? null,
    recommended_fix: finding.recommendedFix ?? null,
    ai_effort: finding.aiEffort ?? null,
    detection: finding.detection ?? null,
    verified_at: finding.verifiedAt ?? null,
    fingerprint: findingFingerprint(finding),
    // Not a FindingSource — a DB-only marker the stale-run delete above matches on.
    source: "sandbox",
  }));
  const { error } = await db.from("issues").insert(rows);
  if (error) console.error("[sandbox-verify] append issues failed:", error.message);

  await recomputeScanScore(scanId);
}

/**
 * Recompute `scans.score` + `category_scores` from the scan's current issue set.
 *
 * The score was computed exactly once, at the end of the static scan, and nothing ever
 * revisited it. The deep tier then inserts secret-sweep and build/lint findings
 * into that same scan minutes later — so a repo whose whole-repo sweep found a committed
 * credential outside the ~35-file static sample still displayed the pre-sweep score, and
 * the headline read "Launch Readyy — can likely be deployed safely" directly above it.
 *
 * Best-effort: a failure here leaves the prior score in place rather than losing the run.
 */
async function recomputeScanScore(scanId: string): Promise<void> {
  const db = getDataStore();
  try {
    const { data, error } = await db
      .from("issues")
      .select(
        "category, title, severity, why, time_saved, fix_id, checked_for, found_evidence, confidence, recommended_fix, ai_effort, detection, verified_at",
      )
      .eq("scan_id", scanId);
    if (error || !data) {
      console.error("[sandbox-verify] score recompute read failed:", error?.message);
      return;
    }

    const { enrichFindings } = await import("../readiness/enrich-finding");
    const { computeReadinessScore } = await import("../readiness/scorer");
    const findings = enrichFindings(
      data.map((row) => ({
        category: row.category,
        title: row.title,
        severity: row.severity as IssueInput["severity"],
        why: row.why,
        timeSaved: row.time_saved ?? "",
        fixId: row.fix_id ?? "",
        checkedFor: (row.checked_for as string[] | null) ?? undefined,
        foundEvidence: row.found_evidence ?? undefined,
        confidence: (row.confidence as IssueInput["confidence"]) ?? undefined,
        recommendedFix: row.recommended_fix ?? undefined,
        aiEffort: row.ai_effort ?? undefined,
        detection: (row.detection as IssueInput["detection"]) ?? undefined,
        verifiedAt: row.verified_at ?? undefined,
      })),
    );

    const { overallScore, categoryScores } = computeReadinessScore(findings);
    const { error: updateError } = await db
      .from("scans")
      .update({ score: overallScore, category_scores: categoryScores })
      .eq("id", scanId);
    if (updateError) {
      console.error("[sandbox-verify] score recompute write failed:", updateError.message);
    }
  } catch (e) {
    console.error("[sandbox-verify] score recompute failed:", e);
  }
}
