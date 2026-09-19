import { describe, expect, it } from "vitest";
import {
  shouldJoinActiveSandboxRun,
  shouldReuseSandboxRun,
  shouldSkipBudgetKilledCommit,
  type SandboxRunLookup,
} from "./reuse";
import { isReusedSkipReason, REUSED_FAILURE, REUSED_PASS } from "./reuse-reason";

const budgetKilled: SandboxRunLookup = {
  kind: "inconclusive",
  reason: "budget_kill",
  createdAt: "2026-08-01T00:00:00Z",
};

describe("shouldJoinActiveSandboxRun", () => {
  it("joins the build already running for the same analysis", () => {
    expect(
      shouldJoinActiveSandboxRun({
        activeScanId: "scan-1",
        requestedScanId: "scan-1",
        configChangedSinceRun: false,
      }),
    ).toBe(true);
  });

  it("keeps different analyses separate", () => {
    expect(
      shouldJoinActiveSandboxRun({
        activeScanId: "scan-1",
        requestedScanId: "scan-2",
        configChangedSinceRun: false,
      }),
    ).toBe(false);
  });

  it("starts fresh when configuration changed during the active run", () => {
    expect(
      shouldJoinActiveSandboxRun({
        activeScanId: "scan-1",
        requestedScanId: "scan-1",
        configChangedSinceRun: true,
      }),
    ).toBe(false);
  });
});

describe("shouldSkipBudgetKilledCommit", () => {
  it("declines to auto-retry a commit that already blew the budget", () => {
    expect(shouldSkipBudgetKilledCommit({ prior: budgetKilled, origin: "scan" })).toBe(true);
  });

  it("always builds when a person pressed the button", () => {
    expect(shouldSkipBudgetKilledCommit({ prior: budgetKilled, origin: "manual" })).toBe(false);
  });

  /** Raising the memory limit or trimming the build is how someone gets past this. */
  it("retries once build settings or env vars changed", () => {
    expect(
      shouldSkipBudgetKilledCommit({
        prior: budgetKilled,
        origin: "scan",
        configChangedSinceRun: true,
      }),
    ).toBe(false);
  });

  it("does not block a registry flake — that one is meant to be retried", () => {
    expect(
      shouldSkipBudgetKilledCommit({
        prior: { kind: "inconclusive", reason: "flaky_infra", createdAt: "2026-08-01T00:00:00Z" },
        origin: "scan",
      }),
    ).toBe(false);
  });

  it("does not block a commit we have never tried", () => {
    expect(shouldSkipBudgetKilledCommit({ prior: null, origin: "scan" })).toBe(false);
  });
});

describe("shouldReuseSandboxRun", () => {
  it("reuses when SHA matches a prior answer and force is off", () => {
    expect(
      shouldReuseSandboxRun({
        gitSha: "abc123",
        priorRunId: "run-1",
      }),
    ).toBe("run-1");
  });

  it("does not reuse without a tip SHA", () => {
    expect(
      shouldReuseSandboxRun({
        gitSha: null,
        priorRunId: "run-1",
      }),
    ).toBeNull();
  });

  it("does not reuse when env vars or build settings changed after the run", () => {
    expect(
      shouldReuseSandboxRun({
        gitSha: "abc123",
        priorRunId: "run-1",
        configChangedSinceRun: true,
      }),
    ).toBeNull();
  });

  it("still reuses when config is untouched since the run", () => {
    expect(
      shouldReuseSandboxRun({
        gitSha: "abc123",
        priorRunId: "run-1",
        configChangedSinceRun: false,
      }),
    ).toBe("run-1");
  });

  it("does not reuse without a prior run", () => {
    expect(
      shouldReuseSandboxRun({
        gitSha: "abc123",
        priorRunId: null,
      }),
    ).toBeNull();
  });
});

/**
 * Both markers mean the same thing to a caller: this row copied an earlier run and no
 * sandbox run was spent. A failure is as reusable as a pass — re-running a commit that
 * cannot build produces the identical failure, and used to cost a slot every time.
 */
describe("isReusedSkipReason", () => {
  it("counts a reused pass", () => {
    expect(isReusedSkipReason(REUSED_PASS)).toBe(true);
  });

  it("counts a reused failure", () => {
    expect(isReusedSkipReason(REUSED_FAILURE)).toBe(true);
  });

  it("does not count a real skip reason", () => {
    expect(isReusedSkipReason("No supported project manifest found")).toBe(false);
    expect(isReusedSkipReason(null)).toBe(false);
  });
});
