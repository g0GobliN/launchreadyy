import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { domainString, idString } from "./schema-primitives";
import { requireAuthUser, assertRepoOwner } from "../auth.server";
import { getDataStore } from "../data-store.server";
import type { ScanTrigger } from "../data-store.types";

export interface ScoreHistoryPoint {
  scanId: string;
  score: number;
  createdAt: string;
  gitSha: string | null;
  trigger: ScanTrigger;
}

const HISTORY_LIMIT = 30;

/**
 * Readiness score over time for one repo.
 *
 * The series has always existed — every scan writes a row — it just had no
 * reader. Ordered oldest-first so it can be charted directly.
 */
export const getRepoScoreHistoryFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }): Promise<ScoreHistoryPoint[]> => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);

    const db = getDataStore();
    const { data: rows } = await db
      .from("scans")
      .select("id, score, created_at, git_sha, trigger")
      .eq("repo_id", data.repoId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);

    return (rows ?? [])
      .map((r) => ({
        scanId: r.id,
        score: r.score,
        createdAt: r.created_at,
        gitSha: r.git_sha,
        trigger: (r.trigger ?? "manual") as ScanTrigger,
      }))
      .reverse();
  });

/** Monitoring state for the repo page panel. Null when never registered. */
export const getRepoMonitorFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    const { getRepoMonitor } = await import("../services/repo-monitor.server");
    return await getRepoMonitor(user.login, data.repoId);
  });

/** Per-repo pause/resume beneath the installation-wide settings switch. */
export const setRepoMonitorEnabledFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ repoId: idString, enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    const { setRepoMonitorEnabled } = await import("../services/repo-monitor.server");
    await setRepoMonitorEnabled(user.login, data.repoId, data.enabled);
    return { enabled: data.enabled };
  });

/** Every domain monitored for this repo. Empty when none are registered yet. */
export const getLiveSiteMonitorsFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    const { getLiveSiteMonitorsForRepo } =
      await import("../services/security/live-site-monitor.server");
    return await getLiveSiteMonitorsForRepo(user.login, data.repoId);
  });

/**
 * Pause/resume one monitored domain.
 *
 * Scoped by user and domain, not by repo: the monitor row is keyed that way, and a domain
 * the caller does not own simply matches nothing.
 */
export const setLiveSiteMonitorEnabledFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ domain: domainString, enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { setLiveSiteMonitorEnabled } =
      await import("../services/security/live-site-monitor.server");
    await setLiveSiteMonitorEnabled(user.login, data.domain, data.enabled);
    return { enabled: data.enabled };
  });

/**
 * Whether background monitoring can act at all, and the switch on both sides of
 * it. Revoking disables every monitor; granting re-enables them. GitHub access
 * itself is always the operator's `GITHUB_TOKEN` from .env — there is nothing to
 * store or seal here.
 */
export const getBackgroundAccessFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuthUser();
  const { isGitHubConfigured } = await import("../github-token.server");
  const { hasEnabledRepoMonitors } = await import("../services/repo-monitor.server");
  return { granted: isGitHubConfigured() && (await hasEnabledRepoMonitors(user.login)) };
});

export const revokeBackgroundAccessFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireAuthUser();
  const { disableAllRepoMonitors } = await import("../services/repo-monitor.server");
  await disableAllRepoMonitors(user.login, "operator turned off background access");
  return { granted: false };
});

/** Turn background monitoring back on. */
export const grantBackgroundAccessFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireAuthUser();
  const { getGitHubToken } = await import("../github-token.server");
  const token = getGitHubToken();
  if (!token) return { granted: false, needsConfiguration: true };

  const { enableAllRepoMonitors, hasEnabledRepoMonitors } =
    await import("../services/repo-monitor.server");
  await enableAllRepoMonitors(user.login);
  return {
    granted: await hasEnabledRepoMonitors(user.login),
    needsConfiguration: false,
  };
});
