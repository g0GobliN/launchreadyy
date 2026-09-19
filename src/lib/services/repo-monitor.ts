const STALE_SCAN_MS = 7 * 24 * 60 * 60 * 1000;

export type MonitorCadence = "weekly" | "daily";

/**
 * Re-scan cadence. Community monitors weekly; a live-site monitor may run daily.
 */
export function repoMonitorCadence(): MonitorCadence {
  return "weekly";
}

/** Decision returned by the pre-scan cost guard. */
export type MonitorScanDecision =
  | { run: true; reason: "code-changed" | "stale" }
  | { run: false; reason: "unchanged" };

/**
 * Whether a due monitor should actually spend a scan.
 *
 * A full scan costs a repo tarball plus GitHub API calls, so we first compare
 * the branch head SHA (one cheap call). Unchanged code is skipped — but only
 * for a week, because findings are not purely a function of the code: the
 * Dependabot check queries GitHub's live advisory API on every scan, so new
 * CVEs land against a frozen repo. That periodic re-scan is what gives a user
 * who shipped nothing a reason to come back.
 */
export function decideMonitorScan(opts: {
  headSha: string | null;
  lastHeadSha: string | null;
  lastScanAt: string | null;
  now?: number;
}): MonitorScanDecision {
  const now = opts.now ?? Date.now();

  // No baseline (first tick, or head lookup failed) — scan and establish one.
  if (!opts.headSha || !opts.lastHeadSha) return { run: true, reason: "code-changed" };
  if (opts.headSha !== opts.lastHeadSha) return { run: true, reason: "code-changed" };

  if (!opts.lastScanAt) return { run: true, reason: "stale" };
  const age = now - new Date(opts.lastScanAt).getTime();
  if (Number.isNaN(age) || age >= STALE_SCAN_MS) return { run: true, reason: "stale" };

  return { run: false, reason: "unchanged" };
}
