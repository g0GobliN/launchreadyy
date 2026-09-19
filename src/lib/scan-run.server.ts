/**
 * Runs a scan and persists it, independent of who asked for it.
 *
 * Shared by interactive scans and scheduled monitoring so both use the exact same
 * path. The caller supplies identity and verification policy; nothing in here reads a
 * cookie or a request context, so it is safe to call from a durable job.
 *
 * `enqueueSandbox` controls E2B verification because automatic monitor runs must not start
 * sandbox work the operator requested only for interactive scans.
 */
import { getDataStore } from "./data-store.server";
import { scanRepository } from "./scanner.server";
import { toPublicError } from "./utils";
import type { Json, ScanTrigger } from "./data-store.types";

export interface RunAndPersistScanOptions {
  token: string;
  repoId: string;
  login: string;
  trigger: ScanTrigger;
  enqueueSandbox: boolean;
}

export interface RunAndPersistScanResult {
  scanId: string;
  score: number;
  issueCount: number;
  repoFullName: string;
  sandboxRunId: string | null;
  sandboxJobId: string | null;
  /** True when the commit was already scanned and its result was reused. */
  reused?: boolean;
}

/**
 * How long a scan of an unchanged commit stays valid.
 *
 * The sandbox has reused passed runs by commit for months; the scan never did, so pressing
 * re-analyze twice with no new commits wastes minutes of work for a
 * byte-identical result. Bounded by time as well as by commit because the rules themselves
 * change when we deploy — a day-old result for the same commit is worth reusing, a month-old
 * one may predate checks that now exist.
 */
const SCAN_REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Load the previous scan's hashes + findings so unaffected rules can be skipped. */
async function loadPriorIncremental(
  db: ReturnType<typeof getDataStore>,
  repoId: string,
): Promise<import("./scanner.server").PriorIncrementalScan | undefined> {
  try {
    const { isFeatureEnabled } = await import("./site-config.server");
    if (!(await isFeatureEnabled("flag_incremental_scan"))) return undefined;

    const { data: prev } = await db
      .from("scans")
      .select("id, file_hashes")
      .eq("repo_id", repoId)
      .not("file_hashes", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!prev?.file_hashes || typeof prev.file_hashes !== "object") return undefined;

    const { data: prevIssues } = await db
      .from("issues")
      .select(
        "category, title, severity, why, time_saved, fix_id, checked_for, found_evidence, confidence, recommended_fix, ai_effort, detection, verified_at, risk_level, business_impact, production_scenario, affected_audience, fix_difficulty, priority, auto_fixable, source, readiness_category, fix_pack_id",
      )
      .eq("scan_id", prev.id);

    return {
      fileHashes: prev.file_hashes as Record<string, string>,
      findings: (prevIssues ?? []).map((row) => ({
        category: row.category,
        title: row.title,
        severity: row.severity as "critical" | "high" | "medium" | "low",
        why: row.why ?? "",
        timeSaved: row.time_saved ?? "",
        fixId: row.fix_id ?? "",
        ruleId: row.fix_id ?? "",
        checkedFor: row.checked_for ?? undefined,
        foundEvidence: row.found_evidence ?? undefined,
        confidence: row.confidence as "high" | "medium" | "low" | undefined,
        recommendedFix: row.recommended_fix ?? undefined,
        aiEffort: row.ai_effort ?? undefined,
        detection: row.detection as import("./scanner-rules").DetectionMethod[] | undefined,
        verifiedAt: row.verified_at ?? undefined,
        // These rows were written by enrichFindings, so they already hold valid members of
        // the readiness unions — cast to those types rather than to hand-written literals.
        riskLevel: (row.risk_level as import("./readiness/types").RiskLevel) ?? "medium",
        businessImpact: row.business_impact ?? "",
        productionScenario: row.production_scenario ?? "",
        affectedAudience:
          (row.affected_audience as import("./readiness/types").AffectedAudience) ?? "users",
        fixDifficulty:
          (row.fix_difficulty as import("./readiness/types").FixDifficulty) ?? "medium",
        priority: row.priority ?? 50,
        autoFixable: row.auto_fixable ?? false,
        source: (row.source as import("./readiness/types").FindingSource) ?? "rule",
        readinessCategory: (row.readiness_category ??
          row.category) as import("./readiness/types").ReadinessCategory,
        fixPackId: row.fix_pack_id ?? undefined,
      })),
    };
  } catch (e) {
    console.warn("[incremental] prior load failed:", e);
    return undefined;
  }
}

export async function runAndPersistScan(
  opts: RunAndPersistScanOptions,
): Promise<RunAndPersistScanResult> {
  const db = getDataStore();

  const { data: repo, error: repoErr } = await db
    .from("repos")
    .select("full_name, default_branch")
    .eq("id", opts.repoId)
    .single();
  if (repoErr || !repo) throw new Error("Repo not found in database.");

  const branch = repo.default_branch ?? "main";
  // The commit is the identity of the code being judged — the same key the sandbox reuses on.
  const { resolveBranchHeadSha } = await import("./github.server");
  const headSha = await resolveBranchHeadSha(opts.token, repo.full_name, branch).catch(() => null);

  /** Everything after a scan exists is shared by the fresh and the reused path. */
  const withSandbox = async (
    scanId: string,
    score: number,
    issueCount: number,
    reused: boolean,
  ): Promise<RunAndPersistScanResult> => {
    let sandboxRunId: string | null = null;
    let sandboxJobId: string | null = null;
    if (opts.enqueueSandbox) {
      try {
        const { enqueueSandboxVerify, isEnqueueRefusal } = await import("./sandbox-verify/enqueue");
        const enqueued = await enqueueSandboxVerify({
          repoId: opts.repoId,
          repoFullName: repo.full_name,
          userLogin: opts.login,
          defaultBranch: branch,
          githubToken: opts.token,
          scanId,
          origin: "scan",
        });
        if (isEnqueueRefusal(enqueued)) {
          // The scan still stands on its static findings; only verification is missing.
          console.warn(`[sandbox-verify] not enqueued (${enqueued.refused}) for ${repo.full_name}`);
        } else {
          sandboxRunId = enqueued.runId;
          sandboxJobId = enqueued.jobId;
        }
      } catch (e) {
        console.error("[sandbox-verify] enqueue after scan failed:", e);
      }
    }
    return {
      scanId,
      score,
      issueCount,
      repoFullName: repo.full_name,
      sandboxRunId,
      sandboxJobId,
      ...(reused ? { reused: true } : {}),
    };
  };

  // Nothing has been committed since the last look? Then there is nothing new to find. Charge
  // nothing, re-verify in the sandbox (which does its own reuse), and hand back what we have.
  if (headSha) {
    const reusable = await findReusableScan(db, opts.repoId, headSha);
    if (reusable) {
      return withSandbox(reusable.id, reusable.score, reusable.issueCount, true);
    }
  }

  const priorIncremental = await loadPriorIncremental(db, opts.repoId);

  const result = await scanRepository(opts.token, repo.full_name, repo.default_branch ?? "main", {
    priorIncremental,
  });

  // Update detected framework on the repo row
  await db.from("repos").update({ framework: result.framework }).eq("id", opts.repoId);

  // Insert scan row
  const scanId = crypto.randomUUID();
  const { error: scanErr } = await db.from("scans").insert({
    id: scanId,
    repo_id: opts.repoId,
    score: result.score,
    warnings: result.warnings.length > 0 ? JSON.stringify(result.warnings) : null,
    category_scores: result.categoryScores,
    stack_detected: result.stackDetected,
    checklist: result.checklist,
    trigger: opts.trigger,
    // v2 — keys are OMITTED unless a flag populated them, so a DB without the (hand-applied) v2
    // columns still accepts the insert. Sending `key: null` would reference the column and fail
    // PostgREST when the migration hasn't been run — breaking scans even with all flags off.
    ...(result.fileHashes ? { file_hashes: result.fileHashes } : {}),
    // The branch head commit, not the engine's tree SHA — the same identifier sandbox runs
    // store, so a scan and a verification can finally be told apart or matched up. Falls back
    // to the tree SHA only when the commit lookup failed.
    ...(headSha || result.gitSha ? { git_sha: headSha ?? result.gitSha } : {}),
    ...(result.dependencyGraph
      ? { dependency_graph: result.dependencyGraph as unknown as Json }
      : {}),
  });
  if (scanErr) throw new Error(toPublicError(scanErr));

  // Phase 2 — capture repository knowledge (no-op unless flag_repo_knowledge_v2 is enabled).
  if (result.knowledgeInput) {
    const { recordScanKnowledge } = await import("./knowledge/writer.server");
    await recordScanKnowledge(opts.repoId, result.knowledgeInput).catch(() => {});
  }

  // Phase 10 — suppress accepted-risk findings when learning flag is on.
  let findingsToPersist = result.findings;
  try {
    const { filterFindingsWithLearning } = await import("./knowledge/apply-learning.server");
    findingsToPersist = await filterFindingsWithLearning(opts.repoId, result.findings);
  } catch (e) {
    console.warn("[repo-learning] filter failed:", e);
  }

  // Insert issue rows
  if (findingsToPersist.length > 0) {
    const { findingFingerprint } = await import("./finding-fingerprint");
    const { error: issueErr } = await db.from("issues").insert(
      findingsToPersist.map((finding, idx) => ({
        id: `${scanId}-${idx}`,
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
        source: finding.source,
        readiness_category: finding.readinessCategory,
        fix_pack_id: finding.fixPackId ?? null,
        checked_for: finding.checkedFor ?? null,
        found_evidence: finding.foundEvidence ?? null,
        confidence: finding.confidence ?? null,
        recommended_fix: finding.recommendedFix ?? null,
        ai_effort: finding.aiEffort ?? null,
        detection: finding.detection ?? null,
        verified_at: finding.verifiedAt ?? null,
        fingerprint: findingFingerprint(finding),
      })),
    );
    if (issueErr) throw new Error(toPublicError(issueErr));
  }

  // Sandbox verification is awaited by the interactive client — it polls
  // sandboxRunId before showing results, so a scan can't present a static guess
  // as if it were fact when a real verification run is available. Null means
  // the provider is unavailable (or this is a monitor run, which never verifies).
  return withSandbox(scanId, result.score, findingsToPersist.length, false);
}

/** The newest scan of this exact commit, if one is recent enough to still be trusted. */
async function findReusableScan(
  db: ReturnType<typeof getDataStore>,
  repoId: string,
  headSha: string,
): Promise<{ id: string; score: number; issueCount: number } | null> {
  const { data: prior } = await db
    .from("scans")
    .select("id, score, created_at")
    .eq("repo_id", repoId)
    .eq("git_sha", headSha)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prior) return null;

  if (Date.now() - new Date(prior.created_at).getTime() > SCAN_REUSE_WINDOW_MS) return null;

  const { count } = await db
    .from("issues")
    .select("id", { count: "exact", head: true })
    .eq("scan_id", prior.id);

  return { id: prior.id, score: prior.score, issueCount: count ?? 0 };
}
