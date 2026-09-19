/**
 * Local scheduler for recurring maintenance and monitoring work.
 *
 * One interval while the app runs; each tick enqueues only what is due:
 *
 *   - repo monitors        → periodic re-scans of connected repositories
 *   - live-site monitors   → periodic production-security scans
 *
 * "Due" is decided from stored timestamps at tick time, so nothing is replayed
 * minute-by-minute after downtime: work simply happens at the next tick. Ticks
 * funnel through the SQLite job queue (`enqueueDurableJob`), whose drain loop
 * also reclaims jobs orphaned by a crash — recovery lives with the queue, not here.
 */

const TICK_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  const startedAt = Date.now();
  try {
    const { enqueueDueRepoMonitors } = await import("./services/repo-monitor.server");
    const { enqueueDueLiveSiteMonitors } =
      await import("./services/security/live-site-monitor.server");

    let enqueued = 0;
    try {
      enqueued += await enqueueDueRepoMonitors();
    } catch (e) {
      console.error("[scheduler] repo monitor tick failed:", e);
    }
    try {
      enqueued += await enqueueDueLiveSiteMonitors();
    } catch (e) {
      console.error("[scheduler] live-site monitor tick failed:", e);
    }
    if (enqueued > 0) {
      console.log(`[scheduler] enqueued ${enqueued} monitor job(s)`);
    }
  } finally {
    ticking = false;
    if (process.env.LR_SCHEDULER_DEBUG) {
      console.log(`[scheduler] tick took ${Date.now() - startedAt}ms`);
    }
  }
}

/** Start the local scheduler. Idempotent. */
export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  // Never hold the process open for the scheduler alone.
  timer.unref?.();
  console.log("[scheduler] started (monitor ticks every 60s)");
  void tick();
}

/** Stop the scheduler (tests, graceful shutdown). */
export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
