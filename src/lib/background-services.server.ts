/**
 * Boots the two background services that share this Node process with the web
 * server: the SQLite job worker and the local scheduler.
 *
 * Called once from the server entry. Both start functions are idempotent, and
 * their timers are unref'd, so only the HTTP server keeps the process alive.
 */

let started = false;

export function startBackgroundServices(): void {
  if (started) return;
  started = true;

  void import("./jobs.server")
    .then(({ startJobWorker }) => startJobWorker())
    .catch((e) => console.error("[boot] job worker failed to start:", e));

  void import("./scheduler.server")
    .then(({ startScheduler }) => startScheduler())
    .catch((e) => console.error("[boot] scheduler failed to start:", e));
}

export async function stopBackgroundServices(): Promise<void> {
  if (!started) return;
  started = false;
  const [{ stopJobWorker }, { stopScheduler }] = await Promise.all([
    import("./jobs.server"),
    import("./scheduler.server"),
  ]);
  stopJobWorker();
  stopScheduler();
}
