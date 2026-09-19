/**
 * Markers written into `structured_results.skipReason` when a run mirrors an earlier
 * result instead of building for real. Kept in their own module because the UI reads
 * them too, and `reuse.ts` is server-only (it imports the service-role client).
 */
export const REUSED_PASS = "commit_already_passed";
export const REUSED_FAILURE = "commit_already_failed";

/** True when this run was copied from an earlier definitive result. */
export function isReusedSkipReason(skipReason: string | null | undefined): boolean {
  return skipReason === REUSED_PASS || skipReason === REUSED_FAILURE;
}
