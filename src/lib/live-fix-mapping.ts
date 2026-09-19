/**
 * Live-site fixIds that the repo-side "helmet" fix (security headers middleware) addresses.
 * `live-http-redirect` and `live-cookie-flags` are deliberately excluded — different fix
 * shape (edge/infra config vs. app middleware), not handled by this mapping.
 */
export const HELMET_LIVE_FIX_IDS = [
  "live-header-strict-transport-security",
  "live-header-content-security-policy",
  "live-header-x-frame-options",
  "live-header-x-content-type-options",
  "live-header-referrer-policy",
  "live-header-permissions-policy",
  "live-server-fingerprint",
] as const;

const HELMET_LIVE_FIX_ID_SET = new Set<string>(HELMET_LIVE_FIX_IDS);

/** Which of a live scan's finding fixIds would be resolved by the "helmet" fix. */
export function helmetAddressableFixIds(findingFixIds: Iterable<string>): string[] {
  const ids = new Set(findingFixIds);
  return HELMET_LIVE_FIX_IDS.filter((id) => ids.has(id));
}

/** Live-site fixId → repo-side fixId for the two 1:1 (non-helmet) auto-fix mappings. */
export const LIVE_TO_REPO_FIX_ID: Record<string, string> = {
  "live-cookie-flags": "security-cookie-flags",
  "live-http-redirect": "https-redirect",
};

/** Map one live finding to the repo Fix PR id that addresses it, if any. */
export function liveFindingToRepoFixId(liveFixId: string | undefined): string | null {
  if (!liveFixId) return null;
  if (HELMET_LIVE_FIX_ID_SET.has(liveFixId)) return "helmet";
  return LIVE_TO_REPO_FIX_ID[liveFixId] ?? null;
}

/** Whether a live scan's findings include a fixId resolved by the given repo-side fixId. */
export function isLiveFixAddressable(findingFixIds: Iterable<string>, repoFixId: string): boolean {
  const ids = new Set(findingFixIds);
  if (repoFixId === "helmet") return HELMET_LIVE_FIX_IDS.some((id) => ids.has(id));
  return Object.entries(LIVE_TO_REPO_FIX_ID).some(
    ([liveId, mapped]) => mapped === repoFixId && ids.has(liveId),
  );
}
