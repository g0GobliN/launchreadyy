const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isMonitorDue(
  cadence: "weekly" | "daily",
  lastEnqueuedAt: string | null,
  now = Date.now(),
): boolean {
  if (!lastEnqueuedAt) return true;
  const elapsed = now - new Date(lastEnqueuedAt).getTime();
  return cadence === "daily" ? elapsed >= DAY_MS : elapsed >= WEEK_MS;
}
