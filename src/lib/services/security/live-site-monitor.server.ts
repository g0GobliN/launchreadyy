import { getDataStore } from "../../data-store.server";
import { enqueueDurableJob } from "../../jobs.server";
import { isMonitorDue } from "./live-site-monitor";

export { isMonitorDue } from "./live-site-monitor";

const CONFIRM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH = 10;
/** Domains listed on the page. Past this the list stops being readable anyway. */
const MONITOR_LIST_CAP = 20;

/** Upsert monitor row after a successful live scan (weekly cadence). */
export async function upsertLiveSiteMonitor(opts: {
  userLogin: string;
  domain: string;
  repoId?: string | null;
}): Promise<void> {
  const cadence = "weekly" as const;

  const db = getDataStore();
  const { data: existing } = await db
    .from("live_site_monitors")
    .select("id")
    .eq("user_id", opts.userLogin)
    .eq("domain", opts.domain)
    .maybeSingle();

  const row = {
    user_id: opts.userLogin,
    domain: opts.domain,
    repo_id: opts.repoId ?? null,
    cadence,
    enabled: true,
    last_enqueued_at: new Date().toISOString(),
  };

  if (existing?.id) {
    await db.from("live_site_monitors").update(row).eq("id", existing.id);
  } else {
    await db.from("live_site_monitors").insert({ id: crypto.randomUUID(), ...row });
  }
}

export type LiveSiteMonitorState = {
  domain: string;
  enabled: boolean;
  cadence: "weekly" | "daily";
  lastCheckedAt: string | null;
  /**
   * When the domain-ownership confirmation lapses. Past this the scheduler skips the monitor
   * silently (see the CONFIRM_TTL_MS check below), so the UI has to say it out loud —
   * otherwise checks just stop and nothing anywhere reports why.
   */
  confirmationExpiresAt: string | null;
};

/**
 * Every domain monitored for this repo, newest first.
 *
 * Returns a list, not one row: the monitor table is keyed by domain, so an operator scanning
 * three sites from one repo genuinely has three independent monitors with their own cadence
 * clock and their own pause switch. Showing only one would leave the other two running with
 * no way to see or stop them.
 */
export async function getLiveSiteMonitorsForRepo(
  userLogin: string,
  repoId: string,
): Promise<LiveSiteMonitorState[]> {
  const db = getDataStore();
  const { data: rows } = await db
    .from("live_site_monitors")
    .select("domain, enabled, cadence, last_enqueued_at")
    .eq("user_id", userLogin)
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false })
    .limit(MONITOR_LIST_CAP);

  if (!rows?.length) return [];

  // One confirmation lookup covers every domain — the per-domain filter used to run inside
  // the loop, which turned a domain list into N round-trips per page load.
  const { data: confirmations } = await db
    .from("domain_scan_confirmations")
    .select("domain, confirmed_at")
    .eq("user_id", userLogin)
    .in(
      "domain",
      rows.map((r) => r.domain),
    )
    .order("confirmed_at", { ascending: false });

  const newestConfirmation = new Map<string, string>();
  for (const c of confirmations ?? []) {
    if (!newestConfirmation.has(c.domain)) newestConfirmation.set(c.domain, c.confirmed_at);
  }

  return rows.map((monitor) => {
    const confirmedAt = newestConfirmation.get(monitor.domain);
    return {
      domain: monitor.domain,
      enabled: monitor.enabled,
      cadence: monitor.cadence === "daily" ? ("daily" as const) : ("weekly" as const),
      lastCheckedAt: monitor.last_enqueued_at,
      confirmationExpiresAt: confirmedAt
        ? new Date(new Date(confirmedAt).getTime() + CONFIRM_TTL_MS).toISOString()
        : null,
    };
  });
}

/** Pause or resume one monitored domain. */
export async function setLiveSiteMonitorEnabled(
  userLogin: string,
  domain: string,
  enabled: boolean,
): Promise<void> {
  const db = getDataStore();
  await db
    .from("live_site_monitors")
    .update({ enabled })
    .eq("user_id", userLogin)
    .eq("domain", domain);
}

/**
 * Enqueue due monitored live scans. Called from the local scheduler.
 * Caps batch size so a scheduler tick stays cheap.
 */
export async function enqueueDueLiveSiteMonitors(limit = BATCH): Promise<number> {
  const db = getDataStore();
  const { data: monitors, error } = await db
    .from("live_site_monitors")
    .select("id, user_id, domain, repo_id, cadence, last_enqueued_at")
    .eq("enabled", true)
    .limit(100);

  if (error || !monitors?.length) return 0;

  let enqueued = 0;
  for (const mon of monitors) {
    if (enqueued >= limit) break;
    const cadence = mon.cadence === "daily" ? "daily" : "weekly";
    if (!isMonitorDue(cadence, mon.last_enqueued_at)) continue;

    // Domain confirmation still valid?
    const { data: confirmations } = await db
      .from("domain_scan_confirmations")
      .select("confirmed_at")
      .eq("user_id", mon.user_id)
      .eq("domain", mon.domain)
      .order("confirmed_at", { ascending: false })
      .limit(1);
    const latest = confirmations?.[0]?.confirmed_at
      ? new Date(confirmations[0].confirmed_at).getTime()
      : 0;
    if (!latest || Date.now() - latest > CONFIRM_TTL_MS) continue;

    const liveScanId = crypto.randomUUID();
    const { error: insertErr } = await db.from("live_site_scans").insert({
      id: liveScanId,
      user_id: mon.user_id,
      domain: mon.domain,
      repo_id: mon.repo_id,
      status: "queued",
      results: [],
    });
    if (insertErr) continue;

    await enqueueDurableJob({
      type: "live_site_scan",
      liveScanId,
      userLogin: mon.user_id,
      domain: mon.domain,
      repoId: mon.repo_id ?? undefined,
    });

    await db
      .from("live_site_monitors")
      .update({ last_enqueued_at: new Date().toISOString(), cadence })
      .eq("id", mon.id);

    enqueued++;
  }
  return enqueued;
}
