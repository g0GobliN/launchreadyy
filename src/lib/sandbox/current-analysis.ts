export type CurrentAnalysisScanJob = {
  running: boolean;
  failed: boolean;
  queuedAt: string;
} | null;

export type CurrentAnalysisSandboxRun = {
  id: string;
  status: "queued" | "running" | "passed" | "failed" | "skipped";
} | null;

/** Keep the sandbox tab on the analysis the user just started, never an older build. */
export function sandboxRunForCurrentAnalysis(opts: {
  explicitRunId?: string;
  latestRun: CurrentAnalysisSandboxRun;
  scanJob: CurrentAnalysisScanJob;
}): { runId: string | null; waitingForScan: boolean } {
  if (opts.explicitRunId) return { runId: opts.explicitRunId, waitingForScan: false };
  if (opts.scanJob?.running) return { runId: null, waitingForScan: true };
  return { runId: opts.latestRun?.id ?? null, waitingForScan: false };
}
