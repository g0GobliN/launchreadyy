/**
 * The operator identity and GitHub credential.
 *
 * LaunchReadyy Community is a single-operator, self-hosted application. There are no
 * accounts, no sessions, and no cookies: the operator is whoever can reach the server,
 * and their GitHub access comes from `GITHUB_TOKEN` in `.env` (set via `launchreadyy setup`).
 *
 * All values come from local configuration. The token never crosses the wire.
 */

/** Identity shape used throughout the app. Deliberately tiny — there is only one user. */
export type LocalUser = {
  /** Stable database key (`owner` / `owner_login` / `user_id` columns). */
  id: string;
  /** GitHub username this installation acts as. */
  login: string;
  avatarUrl: string;
  email: string;
};

const DEFAULT_LOGIN = "local";

/** The operator. Always answers — a fresh install is "local" until configured. */
export function getLocalUser(): LocalUser {
  const login = process.env.LOCAL_USER_LOGIN?.trim() || DEFAULT_LOGIN;
  return {
    id: login,
    login,
    avatarUrl: process.env.LOCAL_USER_AVATAR_URL?.trim() ?? "",
    email: process.env.LOCAL_USER_EMAIL?.trim() ?? "",
  };
}

/**
 * The GitHub credential, from `.env` only.
 *
 * Never read from a request: the browser must not be able to influence which token the
 * server uses, and the token must never reach the browser bundle.
 */
export function getGitHubToken(): string | null {
  return process.env.GITHUB_TOKEN?.trim() || null;
}

/** Whether GitHub-backed features (repo listing, scans, fix PRs) can run at all. */
export function isGitHubConfigured(): boolean {
  return getGitHubToken() !== null;
}

/**
 * The message GitHub-dependent paths show when `GITHUB_TOKEN` is missing, with the fix
 * attached so it is actionable wherever a user first hits it.
 */
export const GITHUB_TOKEN_MISSING =
  "GITHUB_TOKEN is not configured. Run `launchreadyy setup`, or create a personal access " +
  "token at https://github.com/settings/tokens (scopes: repo, read:user, workflow) and set " +
  "it in .env.";

/** True when a GitHub failure means the token is dead rather than flaky. */
export function isAuthFailure(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /\b(401|403)\b|bad credentials|requires authentication/i.test(msg);
}
