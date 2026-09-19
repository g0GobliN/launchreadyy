/**
 * Poll an async status fetch until `isDone` matches or attempts run out.
 * Errors from `fetchStatus` are swallowed and treated as "keep polling" —
 * a transient network blip shouldn't abort the wait.
 */
export async function pollUntil<T>(
  fetchStatus: () => Promise<T>,
  isDone: (result: T) => boolean,
  opts?: { intervalMs?: number; maxAttempts?: number },
): Promise<T | "timeout"> {
  const intervalMs = opts?.intervalMs ?? 1500;
  const maxAttempts = opts?.maxAttempts ?? 40;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const result = await fetchStatus();
      if (isDone(result)) return result;
    } catch {
      /* keep polling */
    }
  }
  return "timeout";
}
