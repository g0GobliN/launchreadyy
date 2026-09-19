/** Soft notice (Status banner on, maintenance off). */
export const DEFAULT_STATUS_BANNER_MESSAGE =
  "We're making improvements that may briefly affect scans or fix PRs. Thanks for your patience.";

/** Shown when maintenance mode is on and no custom message is saved. */
export const DEFAULT_MAINTENANCE_BANNER_MESSAGE =
  "We're performing maintenance. New scans and fix jobs are paused — login and past results still work.";

export function resolveStatusBannerMessage(
  rawMessage: string | undefined,
  maintenanceMode: boolean,
): string {
  const trimmed = (rawMessage ?? "").trim();
  if (trimmed) return trimmed;
  return maintenanceMode ? DEFAULT_MAINTENANCE_BANNER_MESSAGE : DEFAULT_STATUS_BANNER_MESSAGE;
}
