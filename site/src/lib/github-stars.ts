/**
 * Star count for the public repository.
 *
 * The count is read from the unauthenticated GitHub API in the visitor's browser. That endpoint
 * allows 60 requests per hour per IP, which a shared or corporate network can exhaust on its own,
 * so the answer is cached and a failure is treated as "no number today" rather than an error.
 */
export const REPO_API = "https://api.github.com/repos/g0GobliN/launchreadyy";

const CACHE_KEY = "launchreadyy:stars:v1";
const CACHE_TTL_MS = 60 * 60 * 1000;

type CachedStars = { count: number; at: number };

/**
 * Last known count, or null.
 *
 * Every localStorage access is guarded: private-browsing modes and hardened privacy settings throw
 * on read as well as write, and a marketing page must not break over a badge.
 */
export function readStarsCache(): CachedStars | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { count, at } = parsed as Partial<CachedStars>;
    if (typeof count !== "number" || typeof at !== "number") return null;
    return { count, at };
  } catch {
    return null;
  }
}

export function writeStarsCache(count: number): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ count, at: Date.now() }));
  } catch {
    // Nothing to do: the count is displayed either way.
  }
}

export function isFresh(entry: CachedStars): boolean {
  return Date.now() - entry.at < CACHE_TTL_MS;
}

/**
 * Compact display form: 1284 → "1.3K".
 *
 * `Intl` handles the locale rules; any fallback is for environments without compact notation,
 * where the plain number is still correct.
 */
export function formatStars(count: number): string {
  try {
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
      count,
    );
  } catch {
    return String(count);
  }
}
