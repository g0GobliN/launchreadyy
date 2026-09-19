export type LiveScanPoint = {
  domain: string;
  status: string;
  security_score: number | null;
  created_at: string;
};

/**
 * Chartable security-score points for one domain, oldest-first.
 *
 * Scoped to a single domain because a repo can have been scanned against several, and
 * mixing them into one line would draw a trend that never happened to any single site.
 * Queued and failed rows carry no score and would otherwise plot as a drop to zero.
 */
export function liveScanPoints(
  history: LiveScanPoint[],
  domain: string,
): Array<{ value: number; at: string }> {
  return history
    .filter(
      (row) => row.domain === domain && row.status === "completed" && row.security_score !== null,
    )
    .map((row) => ({ value: row.security_score as number, at: row.created_at }))
    .reverse();
}
