/**
 * Executes one scheduled repo re-scan and records any regression for the dashboard.
 *
 * Runs with no request present, so it reads `GITHUB_TOKEN` itself and treats a
 * GitHub rejection as terminal rather than retryable — retrying a revoked token
 * three times into the DLQ just delays telling the operator to reconnect.
 *
 * Community has no email: regression results are visible on the repo page and in
 * the monitor's last-notified timestamp, which throttles repeat notices.
 */
import { getDataStore } from "../data-store.server";
import { getGitHubToken, isAuthFailure } from "../github-token.server";
import { runAndPersistScan } from "../scan-run.server";
import { decideRegressionNotice, type RegressionFinding } from "./repo-regression";
import { repoMonitorCadence, type MonitorCadence } from "./repo-monitor";
import { disableAllRepoMonitors } from "./repo-monitor.server";
import type { RepoScanJobPayload } from "../jobs.server";

interface IssueSlice {
  fix_id: string | null;
  title: string;
  severity: string;
  risk_level: string | null;
  fingerprint: string | null;
  found_evidence: string | null;
  checked_for: string[] | null;
}

const ISSUE_COLUMNS =
  "fix_id, title, severity, risk_level, fingerprint, found_evidence, checked_for";

async function fingerprintOf(i: IssueSlice): Promise<string> {
  if (i.fingerprint) return i.fingerprint;
  const { findingFingerprint } = await import("../finding-fingerprint");
  return findingFingerprint({
    fixId: i.fix_id ?? "",
    title: i.title,
    foundEvidence: i.found_evidence ?? undefined,
    checkedFor: i.checked_for ?? undefined,
  });
}

export async function processRepoScanJob(payload: RepoScanJobPayload): Promise<void> {
  const db = getDataStore();
  const login = payload.userLogin;
  const isManual = payload.trigger === "manual";

  const token = getGitHubToken();
  if (!token) {
    if (isManual) throw new Error("GitHub token unavailable — set GITHUB_TOKEN in .env.");
    // Token went away between enqueue and execute. Nothing to retry.
    console.warn(`[repo-scan] no GITHUB_TOKEN configured; skipping monitor scan for ${login}`);
    return;
  }

  const cadence: MonitorCadence = repoMonitorCadence();

  // The scan we are about to replace — captured before the new one lands so we
  // can diff against it.
  const { data: previousScan } = await db
    .from("scans")
    .select("id, score")
    .eq("repo_id", payload.repoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let result: Awaited<ReturnType<typeof runAndPersistScan>>;
  try {
    result = await runAndPersistScan({
      token,
      repoId: payload.repoId,
      login,
      trigger: payload.trigger,
      enqueueSandbox: payload.enqueueSandbox ?? false,
    });
  } catch (err) {
    if (isAuthFailure(err)) {
      if (isManual) throw err;
      await disableAllRepoMonitors(login, "GitHub rejected GITHUB_TOKEN during a monitor scan");
      return; // terminal — do not burn retries on a dead token
    }
    throw err;
  }

  // Everything below reports on *drift* since the last automatic look. A run the
  // operator just asked for is already on screen, so it ends here.
  if (isManual) return;
  await recordMonitorRegression({
    login,
    repoId: payload.repoId,
    repoFullName: result.repoFullName,
    scanId: result.scanId,
    score: result.score,
    previousScanId: previousScan?.id ?? null,
    previousScore: previousScan?.score ?? null,
    cadence,
  });
}

async function recordMonitorRegression(opts: {
  login: string;
  repoId: string;
  repoFullName: string;
  scanId: string;
  score: number;
  previousScanId: string | null;
  previousScore: number | null;
  cadence: MonitorCadence;
}): Promise<void> {
  const db = getDataStore();

  const { data: monitor } = await db
    .from("repo_monitors")
    .select("id, last_notified_at")
    .eq("user_id", opts.login)
    .eq("repo_id", opts.repoId)
    .maybeSingle();

  // Diff the new scan against the one it replaced, by fingerprint.
  const [{ data: currentRows }, { data: prevRows }] = await Promise.all([
    db.from("issues").select(ISSUE_COLUMNS).eq("scan_id", opts.scanId),
    opts.previousScanId
      ? db.from("issues").select(ISSUE_COLUMNS).eq("scan_id", opts.previousScanId)
      : Promise.resolve({ data: [] as IssueSlice[] }),
  ]);

  const current = (currentRows ?? []) as IssueSlice[];
  const previous = (prevRows ?? []) as IssueSlice[];

  const prevFps = new Set(await Promise.all(previous.map(fingerprintOf)));
  const currentFps = new Set(await Promise.all(current.map(fingerprintOf)));

  const newFindings: RegressionFinding[] = [];
  for (const issue of current) {
    if (prevFps.has(await fingerprintOf(issue))) continue;
    newFindings.push({
      title: issue.title,
      severity: issue.severity,
      riskLevel: issue.risk_level ?? "medium",
    });
  }
  let resolvedCount = 0;
  for (const issue of previous) {
    if (!currentFps.has(await fingerprintOf(issue))) resolvedCount++;
  }

  const decision = decideRegressionNotice({
    hasBaseline: opts.previousScanId !== null,
    newFindings,
    resolvedCount,
    score: opts.score,
    previousScore: opts.previousScore,
    lastNotifiedAt: monitor?.last_notified_at ?? null,
    cadence: opts.cadence,
  });

  if (!decision.notify) return;

  // The notice itself is dashboard-visible: the monitor's last_notified_at moves and
  // the regression summary is derivable from scan history. No email in Community.
  console.log(
    `[repo-scan] regression on ${opts.repoFullName}: ${decision.headline}` +
      (decision.scoreNote ? ` (${decision.scoreNote})` : ""),
  );

  if (monitor?.id) {
    await db
      .from("repo_monitors")
      .update({ last_notified_at: new Date().toISOString() })
      .eq("id", monitor.id);
  }
}
