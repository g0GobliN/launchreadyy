/**
 * Ownership guards for the single-operator app.
 *
 * Community has no sign-in, but the guards stay: `assertRepoOwner` /
 * `assertJobOwner` / `assertScanOwner` keep every query scoped to repos this
 * installation actually connected, and the rate limiter is what stops a retry
 * loop from hammering the operator's own GitHub, E2B and AI accounts. With one
 * database and one identity they are cheap — and they mean a repo id from a
 * stale tab can never touch another installation's data if two operators ever
 * share a network.
 *
 */

import { getLocalUser } from "./github-token.server";
import { getDataStore } from "./data-store.server";
import type { LocalUser } from "./github-token.server";

/**
 * Resolve the installation operator for server functions.
 */
export async function requireAuthUser(): Promise<LocalUser> {
  return getLocalUser();
}

export async function assertRepoOwner(repoId: string, login: string): Promise<void> {
  const db = getDataStore();
  const { data: repo, error } = await db.from("repos").select("owner").eq("id", repoId).single();
  if (error || !repo) throw new Error("Repo not found");
  if (repo.owner !== login) throw new Error("Not authorized for this repo");
}

export async function assertJobOwner(jobId: string, login: string): Promise<void> {
  const db = getDataStore();
  const { data: job, error } = await db
    .from("fix_requests")
    .select("owner_login, repo_id")
    .eq("id", jobId)
    .single();
  if (error || !job) throw new Error("Job not found");
  if (job.owner_login && job.owner_login !== login) {
    throw new Error("Not authorized for this job");
  }
  await assertRepoOwner(job.repo_id, login);
}

export async function assertScanOwner(scanId: string, login: string): Promise<void> {
  const db = getDataStore();
  const { data: scan, error } = await db.from("scans").select("repo_id").eq("id", scanId).single();
  if (error || !scan) throw new Error("Scan not found");
  await assertRepoOwner(scan.repo_id, login);
}

export async function assertRiskAcceptanceOwner(
  acceptanceId: string,
  login: string,
): Promise<void> {
  const db = getDataStore();
  const { data: row, error } = await db
    .from("risk_acceptances")
    .select("repo_id, user_id")
    .eq("id", acceptanceId)
    .single();
  if (error || !row) throw new Error("Risk acceptance not found");
  if (row.user_id !== login) throw new Error("Not authorized");
  await assertRepoOwner(row.repo_id, login);
}
