import { describe, expect, it } from "vitest";
import { sandboxRunForCurrentAnalysis } from "./current-analysis";

const activeScan = {
  running: true,
  failed: false,
  queuedAt: "2026-08-28T06:00:00.000Z",
};

describe("sandboxRunForCurrentAnalysis", () => {
  it("waits while the repository scan is still creating its sandbox run", () => {
    expect(
      sandboxRunForCurrentAnalysis({
        latestRun: { id: "old-run", status: "failed" },
        scanJob: activeScan,
      }),
    ).toEqual({ runId: null, waitingForScan: true });
  });

  it("shows the sandbox linked to the current scan when the scan job finishes", () => {
    expect(
      sandboxRunForCurrentAnalysis({
        latestRun: { id: "new-run", status: "running" },
        scanJob: { ...activeScan, running: false },
      }),
    ).toEqual({ runId: "new-run", waitingForScan: false });
  });

  it("shows no run when the current scan has no linked sandbox", () => {
    expect(
      sandboxRunForCurrentAnalysis({
        latestRun: null,
        scanJob: { ...activeScan, running: false },
      }),
    ).toEqual({ runId: null, waitingForScan: false });
  });

  it("allows an explicit historical run to be opened", () => {
    expect(
      sandboxRunForCurrentAnalysis({
        explicitRunId: "history-run",
        latestRun: null,
        scanJob: activeScan,
      }),
    ).toEqual({ runId: "history-run", waitingForScan: false });
  });
});
