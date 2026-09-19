/**
 * GitHub integration adapter — business code depends on this surface,
 * not on fetch/URL details inside github.server.ts.
 */
export type { GitHubUser, GitHubRepo } from "../github.server";

export {
  GitHubApiError,
  fetchGitHubUser,
  fetchGitHubRepos,
  assertGitHubRepoWriteAccess,
  probeGitHubGitWrite,
  githubContentsPath,
  githubHeadRefPath,
} from "../github.server";
