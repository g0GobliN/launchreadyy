/**
 * Identity and canonical links for the public site, in one place so pages cannot drift apart.
 * The public site never duplicates the repository documentation; it links into it.
 */
export const REPO_URL = "https://github.com/g0GobliN/launchreadyy";
export const EMAIL = "launchreadyy@gmail.com";

/** The application's default local address, quoted in install instructions. */
export const LOCAL_URL = "http://localhost:5174";

/**
 * The origin this site is deployed at, from `VITE_SITE_URL` at build time (see `.env.example`).
 *
 * Empty when it was not configured. Canonical and social-preview tags are then omitted rather than
 * pointed at a guess: a wrong canonical URL is worse than a missing one, because it tells crawlers
 * the real page lives elsewhere.
 */
export const SITE_URL = (import.meta.env.VITE_SITE_URL ?? "").replace(/\/+$/, "");

/** Absolute URL for a route, or null when no site origin is configured. */
export function pageUrl(path: string): string | null {
  return SITE_URL ? `${SITE_URL}${path}` : null;
}

/** A file at the repository root: LICENSE, SECURITY.md, TRADEMARKS.md. */
export function repoFile(path: string): string {
  return `${REPO_URL}/blob/main/${path}`;
}

/** A documentation chapter or guide under `docs/`. */
export function repoDoc(path: string): string {
  return `${REPO_URL}/blob/main/docs/${path}`;
}
