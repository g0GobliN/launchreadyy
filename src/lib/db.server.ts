import { formatDistanceToNow } from "date-fns";
import { getDataStore } from "./data-store.server";
import type {
  Repo,
  Scan,
  Issue,
  Severity,
  FixRequest,
  FixRequestStatus,
  CategoryScore,
  LaunchChecklistItem,
  DetectedStack,
  LaunchTarget,
  LaunchTimeline,
  RiskAcceptance,
  RiskReasonType,
} from "./mock-data";
import type { Database, ScanTrigger } from "./data-store.types";
import type { ArchFinding } from "./arch-scanner.server";
import { isAutoFixableFixId } from "./readiness/enrich-finding";

const supabase = getDataStore();

type RepoRow = Database["public"]["Tables"]["repos"]["Row"];
type ScanRow = Database["public"]["Tables"]["scans"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type RiskAcceptanceRow = Database["public"]["Tables"]["risk_acceptances"]["Row"];

function toRepo(r: RepoRow): Repo {
  return {
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    description: r.description ?? "",
    language: r.language,
    stars: r.stars,
    updated: formatDistanceToNow(new Date(r.updated_at), { addSuffix: true }),
    private: r.private,
    framework: r.framework as Repo["framework"],
  };
}

export async function getRepos(): Promise<Repo[]> {
  const { data, error } = await supabase
    .from("repos")
    .select("*")
    .order("updated_at", { ascending: false })
    .returns<RepoRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(toRepo);
}

export async function getRepo(id: string): Promise<Repo | null> {
  const { data, error } = await supabase
    .from("repos")
    .select("*")
    .eq("id", id)
    .single()
    .returns<RepoRow>();
  if (error || !data) return null;
  return toRepo(data as RepoRow);
}

/** Most recent fix job on a repo that has an opened PR (for legacy /pr redirects). */
export async function getLatestPrJobForRepo(
  repoId: string,
): Promise<{ id: string; pr_url: string } | null> {
  const { data, error } = await supabase
    .from("fix_requests")
    .select("id, pr_url")
    .eq("repo_id", repoId)
    .not("pr_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.pr_url) return null;
  return { id: data.id, pr_url: data.pr_url };
}

export async function getScan(repoId: string): Promise<Scan | null> {
  const { data: scanData, error: scanError } = await supabase
    .from("scans")
    .select("*")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()
    .returns<ScanRow>();

  if (scanError || !scanData) return null;
  const scan = scanData as ScanRow;

  const { data: issueData, error: issueError } = await supabase
    .from("issues")
    .select("*")
    .eq("scan_id", scan.id)
    .returns<IssueRow[]>();

  if (issueError) throw new Error(issueError.message);

  const issues: Issue[] = (issueData ?? []).map((i: IssueRow) => ({
    id: i.id,
    category: i.category,
    title: i.title,
    severity: i.severity as Severity,
    why: i.why,
    timeSaved: i.time_saved,
    fixId: i.fix_id,
    riskLevel: (i.risk_level as Issue["riskLevel"]) ?? undefined,
    businessImpact: i.business_impact ?? undefined,
    productionScenario: i.production_scenario ?? undefined,
    affectedAudience: (i.affected_audience as Issue["affectedAudience"]) ?? undefined,
    fixDifficulty: (i.fix_difficulty as Issue["fixDifficulty"]) ?? undefined,
    priority: i.priority ?? undefined,
    autoFixable: isAutoFixableFixId(i.fix_id),
    source: (i.source as Issue["source"]) ?? undefined,
    readinessCategory: i.readiness_category ?? undefined,
    fixPackId: i.fix_pack_id ?? undefined,
    checkedFor: (i.checked_for as string[] | null) ?? undefined,
    foundEvidence: i.found_evidence ?? undefined,
    confidence: (i.confidence as Issue["confidence"]) ?? undefined,
    recommendedFix: i.recommended_fix ?? undefined,
    aiEffort: i.ai_effort ?? undefined,
    detection: (i.detection as Issue["detection"]) ?? undefined,
    verifiedAt: i.verified_at ?? undefined,
  }));

  let warnings: string[] = [];
  if (scan.warnings) {
    try {
      warnings = JSON.parse(scan.warnings) as string[];
    } catch {
      warnings = [];
    }
  }

  let categoryScores: CategoryScore[] | undefined;
  if (scan.category_scores) {
    categoryScores = scan.category_scores as CategoryScore[];
  }

  let checklist: LaunchChecklistItem[] | undefined;
  if (scan.checklist) {
    checklist = scan.checklist as LaunchChecklistItem[];
  }

  let stackDetected: DetectedStack | undefined;
  if (scan.stack_detected) {
    stackDetected = scan.stack_detected as DetectedStack;
  }

  const { data: sandboxRun } = await supabase
    .from("sandbox_verify_runs")
    .select("status, finished_at, structured_results")
    .eq("scan_id", scan.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    id: scan.id,
    repoId: scan.repo_id,
    score: scan.score,
    createdAt: formatDistanceToNow(new Date(scan.created_at), { addSuffix: true }),
    /** Raw, so the UI can compare it against the verification time — a scan much older than its
     *  verification means the commit was unchanged and the scan was reused. */
    createdAtIso: scan.created_at,
    issues,
    warnings,
    categoryScores,
    checklist,
    stackDetected,
    launchTarget: (scan.launch_target as LaunchTarget | null) ?? null,
    launchTimeline: (scan.launch_timeline as LaunchTimeline | null) ?? null,
    sandboxVerify: sandboxRun
      ? {
          status: sandboxRun.status as "queued" | "running" | "passed" | "failed" | "skipped",
          finishedAt: sandboxRun.finished_at,
        }
      : null,
  };
}

export async function updateScanContext(
  scanId: string,
  launchTarget: LaunchTarget | null,
  launchTimeline: LaunchTimeline | null,
): Promise<void> {
  const { error } = await supabase
    .from("scans")
    .update({
      launch_target: launchTarget,
      launch_timeline: launchTimeline,
    })
    .eq("id", scanId);
  if (error) throw new Error(error.message);
}

export async function acceptRisk(
  repoId: string,
  fixId: string,
  userId: string,
  reasonType: RiskReasonType,
  note?: string,
): Promise<RiskAcceptance> {
  const { data, error } = await supabase
    .from("risk_acceptances")
    .insert({
      repo_id: repoId,
      fix_id: fixId,
      user_id: userId,
      reason_type: reasonType,
      note: note?.trim() ? note.trim() : null,
    })
    .select("*")
    .single()
    .returns<RiskAcceptanceRow>();
  if (error || !data) throw new Error(error?.message ?? "Failed to accept risk");
  return {
    id: data.id,
    repoId: data.repo_id,
    fixId: data.fix_id,
    userId: data.user_id,
    reasonType: data.reason_type as RiskReasonType,
    note: data.note ?? undefined,
    acceptedAt: data.accepted_at,
  };
}

export async function revokeRiskAcceptance(id: string): Promise<void> {
  const { error } = await supabase.from("risk_acceptances").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getRiskAcceptances(repoId: string): Promise<RiskAcceptance[]> {
  const { data, error } = await supabase
    .from("risk_acceptances")
    .select("*")
    .eq("repo_id", repoId)
    .order("accepted_at", { ascending: false })
    .returns<RiskAcceptanceRow[]>();
  if (error) {
    console.warn("[getRiskAcceptances]", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    repoId: row.repo_id,
    fixId: row.fix_id,
    userId: row.user_id,
    reasonType: row.reason_type as RiskReasonType,
    note: row.note ?? undefined,
    acceptedAt: row.accepted_at,
  }));
}

export interface ScanTrend {
  currentScore: number;
  previousScore: number;
  previousCreatedAt: string;
  newIssues: { title: string; severity: Severity }[];
  resolvedIssues: { title: string; severity: Severity }[];
}

// Compares the two most recent scans for a repo so the UI can show "score went from X to Y
// because of these new/resolved issues" — something only possible because we keep scan history,
// not a one-shot generation tool. Returns null when there's no previous scan to compare against.
export async function getScanTrend(repoId: string): Promise<ScanTrend | null> {
  const { data: scanRows } = await supabase
    .from("scans")
    .select("*")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(2)
    .returns<ScanRow[]>();

  const scans = scanRows ?? [];
  if (scans.length < 2) return null;
  const [current, previous] = scans;

  const [{ data: currentIssueRows }, { data: prevIssueRows }] = await Promise.all([
    supabase
      .from("issues")
      .select("fix_id, title, severity, fingerprint, found_evidence, checked_for")
      .eq("scan_id", current.id),
    supabase
      .from("issues")
      .select("fix_id, title, severity, fingerprint, found_evidence, checked_for")
      .eq("scan_id", previous.id),
  ]);
  type IssueSlice = {
    fix_id: string;
    title: string;
    severity: string;
    fingerprint?: string | null;
    found_evidence?: string | null;
    checked_for?: string[] | null;
  };
  const currentIssues = (currentIssueRows ?? []) as IssueSlice[];
  const prevIssues = (prevIssueRows ?? []) as IssueSlice[];

  const { findingFingerprint } = await import("./finding-fingerprint");
  const fpOf = (i: IssueSlice) =>
    i.fingerprint ||
    findingFingerprint({
      fixId: i.fix_id,
      title: i.title,
      foundEvidence: i.found_evidence ?? undefined,
      checkedFor: i.checked_for ?? undefined,
    });

  const currentFps = new Set(currentIssues.map(fpOf));
  const prevFps = new Set(prevIssues.map(fpOf));

  return {
    currentScore: current.score,
    previousScore: previous.score,
    previousCreatedAt: formatDistanceToNow(new Date(previous.created_at), { addSuffix: true }),
    newIssues: currentIssues
      .filter((i) => !prevFps.has(fpOf(i)))
      .map((i) => ({ title: i.title, severity: i.severity as Severity })),
    resolvedIssues: prevIssues
      .filter((i) => !currentFps.has(fpOf(i)))
      .map((i) => ({ title: i.title, severity: i.severity as Severity })),
  };
}

type FixRequestRow = Database["public"]["Tables"]["fix_requests"]["Row"];

function toFixRequest(r: FixRequestRow): FixRequest {
  return {
    id: r.id,
    repoId: r.repo_id,
    scanId: r.scan_id,
    fixes: r.fixes ? r.fixes.split(",").filter(Boolean) : [],
    status: r.status as FixRequestStatus,
    branchName: r.branch_name,
    prNumber: r.pr_number,
    prUrl: r.pr_url,
    errorMessage: r.error_message,
    estFilesAdded: r.est_files_added,
    estFilesChanged: r.est_files_changed,
    estDeps: r.est_deps,
    effortScore: r.effort_score,
    createdAt: formatDistanceToNow(new Date(r.created_at), { addSuffix: true }),
  };
}

export async function getFixRequest(id: string): Promise<FixRequest | null> {
  const { data, error } = await supabase
    .from("fix_requests")
    .select("*")
    .eq("id", id)
    .single()
    .returns<FixRequestRow>();
  if (error || !data) return null;
  return toFixRequest(data as FixRequestRow);
}

export async function getRecentFixRequests(
  owner?: string,
): Promise<Array<FixRequest & { repoFullName: string }>> {
  let repoIds: string[] | undefined;

  if (owner) {
    const { data: repos } = await supabase.from("repos").select("id").eq("owner", owner);
    repoIds = ((repos ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (repoIds.length === 0) return [];
  }

  let query = supabase
    .from("fix_requests")
    .select("*, repos(full_name)")
    .order("created_at", { ascending: false })
    .limit(10);

  if (repoIds) {
    query = query.in("repo_id", repoIds);
  }

  const { data, error } =
    await query.returns<Array<FixRequestRow & { repos: { full_name: string } | null }>>();
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    ...toFixRequest(r),
    repoFullName: r.repos?.full_name ?? "unknown",
  }));
}

export async function getRecentScans(owner?: string): Promise<
  Array<{
    repo: string;
    repoId: string;
    score: number;
    when: string;
    blockers: number;
    checklistPassed: number;
    checklistTotal: number;
  }>
> {
  let repoIds: string[] | undefined;

  if (owner) {
    const { data: repos } = await supabase.from("repos").select("id").eq("owner", owner);
    repoIds = ((repos ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (repoIds.length === 0) return [];
  }

  let query = supabase
    .from("scans")
    .select("id, score, created_at, repo_id, checklist, repos(full_name, id)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (repoIds) {
    query = query.in("repo_id", repoIds);
  }

  const { data, error } = await query.returns<
    Array<{
      id: string;
      score: number;
      created_at: string;
      repo_id: string;
      checklist: LaunchChecklistItem[] | null;
      repos: { full_name: string; id: string } | null;
    }>
  >();

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const deduped: (typeof data)[number][] = [];
  for (const s of data ?? []) {
    const name = s.repos?.full_name ?? "unknown";
    if (!seen.has(name)) {
      seen.add(name);
      deduped.push(s);
    }
    if (deduped.length === 5) break;
  }

  const scanIds = deduped.map((s) => s.id);
  const blockerCounts = new Map<string, number>();
  if (scanIds.length > 0) {
    const { data: issueRows } = await supabase
      .from("issues")
      .select("scan_id, risk_level")
      .in("scan_id", scanIds);
    for (const row of issueRows ?? []) {
      if (row.risk_level === "blocker") {
        blockerCounts.set(row.scan_id, (blockerCounts.get(row.scan_id) ?? 0) + 1);
      }
    }
  }

  return deduped.map((s) => {
    const checklist = (s.checklist as LaunchChecklistItem[] | null) ?? [];
    const applicable = checklist.filter((i) => i.status !== "na");
    const passed = applicable.filter((i) => i.status === "pass").length;
    return {
      repo: s.repos?.full_name ?? "unknown",
      repoId: s.repo_id,
      score: s.score,
      when: formatDistanceToNow(new Date(s.created_at), { addSuffix: true }),
      blockers: blockerCounts.get(s.id) ?? 0,
      checklistPassed: passed,
      checklistTotal: applicable.length,
    };
  });
}

// Raw, un-deduped scan history for charting — every scan event, oldest to
// newest, unlike getRecentScans (which dedupes to latest-per-repo).
export async function getScanHistory(owner: string): Promise<
  Array<{
    score: number;
    when: string;
    repo: string;
    blockers: number;
    checklistPct: number | null;
  }>
> {
  const page = await getScanHistoryPage(owner, 1, 200);
  // Charts expect chronological (oldest → newest).
  return page.items.slice().reverse();
}

export async function getScanHistoryPage(
  owner: string,
  page = 1,
  pageSize = 20,
): Promise<{
  items: Array<{
    score: number;
    when: string;
    repo: string;
    blockers: number;
    checklistPct: number | null;
    trigger: ScanTrigger;
  }>;
  total: number;
  page: number;
  pageSize: number;
}> {
  const { data: repos } = await supabase.from("repos").select("id").eq("owner", owner);
  const repoIds = ((repos ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (repoIds.length === 0) {
    return { items: [], total: 0, page, pageSize };
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { count, error: countError } = await supabase
    .from("scans")
    .select("id", { count: "exact", head: true })
    .in("repo_id", repoIds);
  if (countError) throw new Error(countError.message);

  const { data: rows, error } = await supabase
    .from("scans")
    .select("id, score, created_at, checklist, trigger, repos(full_name)")
    .in("repo_id", repoIds)
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<
      Array<{
        id: string;
        score: number;
        created_at: string;
        checklist: LaunchChecklistItem[] | null;
        trigger: ScanTrigger | null;
        repos: { full_name: string } | null;
      }>
    >();

  if (error) throw new Error(error.message);

  const data = rows ?? [];
  const scanIds = data.map((s) => s.id);
  const blockerCounts = new Map<string, number>();
  if (scanIds.length > 0) {
    const { data: issueRows } = await supabase
      .from("issues")
      .select("scan_id, risk_level")
      .in("scan_id", scanIds);
    for (const row of issueRows ?? []) {
      if (row.risk_level === "blocker") {
        blockerCounts.set(row.scan_id, (blockerCounts.get(row.scan_id) ?? 0) + 1);
      }
    }
  }

  const items = data.map((s) => {
    const checklist = (s.checklist as LaunchChecklistItem[] | null) ?? [];
    const applicable = checklist.filter((i) => i.status !== "na");
    const passed = applicable.filter((i) => i.status === "pass").length;
    return {
      score: s.score,
      when: s.created_at,
      repo: s.repos?.full_name ?? "unknown",
      blockers: blockerCounts.get(s.id) ?? 0,
      checklistPct: applicable.length > 0 ? Math.round((100 * passed) / applicable.length) : null,
      trigger: s.trigger ?? "manual",
    };
  });

  return { items, total: count ?? 0, page, pageSize };
}

export interface ArchScanRecord {
  id: string;
  repoId: string;
  score: number;
  findings: ArchFinding[];
  scannedFiles: number;
  createdAt: string;
}

type ArchScanRow = Database["public"]["Tables"]["arch_scans"]["Row"];

export async function getArchScan(repoId: string): Promise<ArchScanRecord | null> {
  const { data, error } = await supabase
    .from("arch_scans")
    .select("*")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()
    .returns<ArchScanRow>();

  if (error || !data) return null;
  return {
    id: data.id,
    repoId: data.repo_id,
    score: data.score,
    findings: JSON.parse(data.findings) as ArchFinding[],
    scannedFiles: data.scanned_files,
    createdAt: formatDistanceToNow(new Date(data.created_at), { addSuffix: true }),
  };
}

export async function saveArchScan(
  repoId: string,
  score: number,
  findings: ArchFinding[],
  scannedFiles: number,
): Promise<ArchScanRecord> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from("arch_scans").insert({
    id,
    repo_id: repoId,
    score,
    findings: JSON.stringify(findings),
    scanned_files: scannedFiles,
  });
  if (error) throw new Error(error.message);
  return { id, repoId, score, findings, scannedFiles, createdAt: "just now" };
}
