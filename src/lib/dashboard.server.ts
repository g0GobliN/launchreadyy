import { getRecentFixRequests, getRecentScans, getScanHistory } from "./db.server";
import { getGitHubToken, getLocalUser } from "./github-token.server";
import { fetchGitHubRepos, GitHubApiError } from "./github.server";
import type { GitHubRepo } from "./github.server";

export async function loadDashboardData() {
  const githubToken = getGitHubToken();
  const storedUser = getLocalUser();

  if (!githubToken || !storedUser) {
    return {
      user: null,
      githubRepos: [] as GitHubRepo[],
      recentScans: [],
      recentJobs: [],
      scanHistory: [],
      tokenExpired: false,
    };
  }

  const login = storedUser.login;
  let tokenExpired = false;

  const [githubRepos, recentScans, scanHistory, recentJobs] = await Promise.all([
    fetchGitHubRepos(githubToken).catch((e) => {
      if (e instanceof GitHubApiError && e.status === 401) tokenExpired = true;
      else console.error("[dashboard] fetchGitHubRepos failed:", e);
      return [] as GitHubRepo[];
    }),
    getRecentScans(login).catch(() => []),
    getScanHistory(login).catch(() => []),
    getRecentFixRequests(login).catch(() => []),
  ]);

  return {
    user: {
      id: storedUser.id,
      login,
      avatarUrl: storedUser.avatarUrl,
      email: storedUser.email,
    },
    githubRepos,
    recentScans,
    scanHistory,
    recentJobs,
    tokenExpired,
  };
}
