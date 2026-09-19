import { GitHubFileProvider } from "./scan-engine/github-file-provider";
import { runScan, type PriorIncrementalScan, type ScanResult } from "./scan-engine/scan-repository";

export type { IssueInput };
export { SEVERITY_WEIGHT, calcScore, hasReadmeSetupSection } from "./scanner-rules";
export type {
  ReadinessFinding,
  CategoryScore,
  DetectedStack,
  LaunchChecklistItem,
} from "./readiness";
export type { ScanResult, PriorIncrementalScan };

import type { IssueInput } from "./scanner-rules";
import type {
  ReadinessFinding,
  CategoryScore,
  DetectedStack,
  LaunchChecklistItem,
} from "./readiness";

export async function scanRepository(
  token: string,
  fullName: string,
  defaultBranch: string,
  opts?: {
    priorIncremental?: PriorIncrementalScan;
  },
): Promise<ScanResult> {
  const [repoOwner, repoName] = fullName.split("/");
  const provider = new GitHubFileProvider(token, fullName, defaultBranch);
  return runScan(provider, {
    githubToken: token,
    repoOwner,
    repoName,
    priorIncremental: opts?.priorIncremental,
  });
}
