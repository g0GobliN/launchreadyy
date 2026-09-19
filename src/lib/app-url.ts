/**
 * This deployment's public origin, for absolute URLs (og:, canonical, share links).
 * Set VITE_APP_URL (client-visible) and APP_URL (server) to your deployment URL.
 */
export const APP_ORIGIN: string = (
  import.meta.env.VITE_APP_URL ??
  (typeof process !== "undefined" ? (process.env.APP_URL ?? "") : "")
).replace(/\/$/, "");

/**
 * The public source repository, for "View on GitHub" links on the project homepage.
 * Set PUBLIC_GITHUB_URL (and VITE_PUBLIC_GITHUB_URL for the client bundle) to your fork.
 * Unset is fine — the homepage falls back to linking the docs instead.
 */
export const PUBLIC_GITHUB_URL: string = (
  import.meta.env.VITE_PUBLIC_GITHUB_URL ??
  (typeof process !== "undefined" ? (process.env.PUBLIC_GITHUB_URL ?? "") : "")
).replace(/\/$/, "");

/** Absolute URL for a path in this deployment ("" when APP_ORIGIN is unset). */
export function appUrl(path = "/"): string {
  return new URL(path, APP_ORIGIN || "http://localhost")
    .toString()
    .replace(/\/$/, path === "/" ? "" : "");
}
