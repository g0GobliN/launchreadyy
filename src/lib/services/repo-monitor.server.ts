/**
 * Scheduled repo re-scanning.
 *
 * Single-operator monitoring: every connected repo can be monitored, each tick runs
 * a cheap head-SHA check before spending a scan, and results surface in the app —
 * no email involved.
 */
import { getDataStore } from "../data-store.server";
import { enqueueDurableJob } from "../jobs.server";
import { isMonitorDue } from "./security/live-site-monitor";
import { decideMonitorScan, type MonitorCadence } from "./repo-monitor";
import { getGitHubToken } from "../github-token.server";
import { resolveBranchHeadSha } from "../github.server";

export { decideMonitorScan, type MonitorCadence } from "./repo-monitor";

const BATCH = 10;
/** Cap the rows we consider per tick so a large table can't stall the scheduler. */
const SCAN_WINDOW = 100;

/** Register (or refresh) monitoring for a repo. Called on connect and after a manual scan. */
export async function upsertRepoMonitor(opts: {
  userLogin: string;
  repoId: string;
}): Promise<void> {
  if (!opts.userLogin || !opts.repoId) return;
  const db = getDataStore();

  const { data: existing } = await db
    .from("repo_monitors")
    .select("id")
    .eq("user_id", opts.userLogin)
    .eq("repo_id", opts.repoId)
    .maybeSingle();

  if (existing?.id) {
    // Already registered — nothing to refresh. Never re-enable: if the operator
    // paused monitoring for this repo, a later manual scan must not silently
    // switch it back on.
    return;
  }

  await db.from("repo_monitors").insert({
    id: crypto.randomUUID(),
    repo_id: opts.repoId,
    user_id: opts.userLogin,
    cadence: "weekly",
    enabled: true,
    // Start the clock now so connecting a repo doesn't immediately re-scan what
    // was just scanned by hand.
    last_enqueued_at: new Date().toISOString(),
  });
}

/**
 * Enqueue due repo re-scans. Called from the local scheduler.
 * Returns the number of scans actually enqueued (skips are not counted).
 */
export async function enqueueDueRepoMonitors(limit = BATCH): Promise<number> {
  const { isFeatureEnabled } = await import("../site-config.server");
  if (!(await isFeatureEnabled("flag_repo_monitoring"))) return 0;

  const db = getDataStore();
  const { data: monitors, error } = await db
    .from("repo_monitors")
    .select("id, user_id, repo_id, cadence, last_enqueued_at, last_head_sha")
    .eq("enabled", true)
    .limit(SCAN_WINDOW);

  if (error || !monitors?.length) return 0;

  let enqueued = 0;

  for (const mon of monitors) {
    if (enqueued >= limit) break;
    const cadence: MonitorCadence = mon.cadence === "daily" ? "daily" : "weekly";
    if (!isMonitorDue(cadence, mon.last_enqueued_at)) continue;

    // No GITHUB_TOKEN configured yet. Leave the monitor enabled so it resumes
    // once the operator finishes setup.
    const token = getGitHubToken();
    if (!token) continue;

    const { data: repo } = await db
      .from("repos")
      .select("full_name, default_branch")
      .eq("id", mon.repo_id)
      .maybeSingle();
    if (!repo?.full_name) continue;

    const { data: lastScan } = await db
      .from("scans")
      .select("created_at")
      .eq("repo_id", mon.repo_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const headSha = await resolveBranchHeadSha(
      token,
      repo.full_name,
      repo.default_branch ?? "main",
    ).catch(() => null);

    const decision = decideMonitorScan({
      headSha,
      lastHeadSha: mon.last_head_sha,
      lastScanAt: lastScan?.created_at ?? null,
    });

    const now = new Date().toISOString();
    if (!decision.run) {
      // Nothing to do, but the monitor was still checked — bump the clock so we
      // don't re-check on every tick for the rest of the period.
      await db.from("repo_monitors").update({ last_enqueued_at: now }).eq("id", mon.id);
      continue;
    }

    await enqueueDurableJob({
      type: "repo_scan",
      repoId: mon.repo_id,
      userLogin: mon.user_id,
      trigger: "monitor",
    });

    await db
      .from("repo_monitors")
      .update({
        last_enqueued_at: now,
        ...(headSha ? { last_head_sha: headSha } : {}),
      })
      .eq("id", mon.id);

    enqueued++;
  }
  return enqueued;
}

/** Turn monitoring on or off for one repo. */
export async function setRepoMonitorEnabled(
  userLogin: string,
  repoId: string,
  enabled: boolean,
): Promise<void> {
  const db = getDataStore();
  const { data: existing } = await db
    .from("repo_monitors")
    .select("id")
    .eq("user_id", userLogin)
    .eq("repo_id", repoId)
    .maybeSingle();

  if (!existing?.id) {
    if (!enabled) return;
    await upsertRepoMonitor({ userLogin, repoId });
    return;
  }
  await db.from("repo_monitors").update({ enabled }).eq("id", existing.id);
}

/** Monitoring state for the repo page. */
export async function getRepoMonitor(
  userLogin: string,
  repoId: string,
): Promise<{
  enabled: boolean;
  cadence: MonitorCadence;
  lastCheckedAt: string | null;
} | null> {
  const db = getDataStore();
  const { data } = await db
    .from("repo_monitors")
    .select("enabled, cadence, last_enqueued_at")
    .eq("user_id", userLogin)
    .eq("repo_id", repoId)
    .maybeSingle();
  if (!data) return null;
  return {
    enabled: data.enabled,
    cadence: data.cadence === "daily" ? "daily" : "weekly",
    lastCheckedAt: data.last_enqueued_at,
  };
}

/** Whether scheduled re-scans are currently enabled for at least one repo. */
export async function hasEnabledRepoMonitors(userLogin: string): Promise<boolean> {
  const db = getDataStore();
  const { data } = await db
    .from("repo_monitors")
    .select("id")
    .eq("user_id", userLogin)
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

/**
 * Turn every repo monitor for this installation off at once — used when GitHub
 * rejects `GITHUB_TOKEN` (401/403) so a dead token stops being retried, and when
 * the operator turns background monitoring off from settings.
 */
export async function disableAllRepoMonitors(userLogin: string, reason: string): Promise<void> {
  const db = getDataStore();
  await db
    .from("repo_monitors")
    .update({ enabled: false })
    .eq("user_id", userLogin)
    .eq("enabled", true);
  console.warn(`[repo-monitor] disabled for ${userLogin}: ${reason}`);
}

/** Re-enable the monitors `disableAllRepoMonitors` switched off. */
export async function enableAllRepoMonitors(userLogin: string): Promise<void> {
  const db = getDataStore();
  await db
    .from("repo_monitors")
    .update({ enabled: true })
    .eq("user_id", userLogin)
    .eq("enabled", false);
}
