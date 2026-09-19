/**
 * Public API facade — domain operations for routes/components.
 *
 * Handlers remain TanStack `createServerFn`s today; this module is the
 * stable import surface so call sites do not reach into individual
 * `*.functions.ts` files (easier to swap for HTTP later).
 *
 * Public server-function exports used by the Community application.
 */

// Repos / scans / fixes
export {
  getCurrentUser,
  listGitHubRepos,
  saveSelectedRepo,
  triggerScan,
  createFixRequest,
  createAndStartFixRequest,
  confirmFixRequest,
  approveFixRequest,
  regenerateFixRequest,
  cancelFixRequest,
  getPendingDiffsFn,
  getFixRequestFn,
  getFixPreviewFn,
  loadDashboardFn,
  getAllJobsFn,
} from "./github.functions";

// Session (the local operator)
export { getSessionUserFn, getInstallationStatusFn } from "./session.functions";

// DB reads
export {
  getRepoFn,
  getScanFn,
  getScanTrendFn,
  getRecentScansFn,
  getRecentFixRequestsFn,
} from "./db.functions";

// Continuous monitoring (scheduled re-scans + score history)
export {
  getRepoScoreHistoryFn,
  getRepoMonitorFn,
  setRepoMonitorEnabledFn,
  type ScoreHistoryPoint,
} from "./monitor.functions";

// Production Security (live site + AI explain)
export {
  getDomainVerifyChallengeFn,
  confirmDomainFn,
  startLiveSiteScanFn,
  getLiveSiteScanFn,
  listLiveSiteScansFn,
  getSecurityHistoryFn,
  explainSecurityFindingFn,
} from "./security.functions";
