import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  inconclusiveReason,
  isBudgetKill,
  isFlakyInstallFailure,
  missingImageToolchains,
} from "./failure-classify";
import type { SandboxStepResult } from "../adapters/sandbox";

function step(
  partial: Partial<SandboxStepResult> & Pick<SandboxStepResult, "step">,
): SandboxStepResult {
  return {
    command: "x",
    exitCode: 1,
    stdout: "",
    stderr: "",
    durationMs: 1,
    ...partial,
  };
}

describe("classifyFailure", () => {
  it("detects dependency failures", () => {
    expect(
      classifyFailure([
        step({ step: "install", stderr: "npm ERR! code ERESOLVE\npeer dep conflict" }),
      ]),
    ).toBe("dependency");
  });

  it("detects missing env failures", () => {
    expect(
      classifyFailure([
        step({ step: "build", stderr: "Missing environment variable DATABASE_URL" }),
      ]),
    ).toBe("env");
  });

  it("detects source/build failures", () => {
    expect(
      classifyFailure([step({ step: "build", stderr: "error TS2304: Cannot find name" })]),
    ).toBe("source");
  });
});

/**
 * The gate on caching a failure. Anything this returns true for is re-run on the next
 * Analyze instead of replayed, so a repo that is merely slow is never frozen into "failed".
 */
describe("isBudgetKill", () => {
  it("detects a step that ran out of time", () => {
    expect(
      isBudgetKill([step({ step: "install", stderr: "process timed out after 90000ms" })]),
    ).toBe(true);
  });

  it("detects the OOM killer", () => {
    expect(
      isBudgetKill([
        step({
          step: "build",
          stderr:
            "Sandbox process was killed (out of memory) — this repo's dependency tree likely exceeded the sandbox's memory limit.",
        }),
      ]),
    ).toBe(true);
  });

  it("detects a V8 heap exhaustion", () => {
    expect(
      isBudgetKill([step({ step: "build", stdout: "FATAL ERROR: JavaScript heap out of memory" })]),
    ).toBe(true);
  });

  it("leaves an ordinary build failure alone", () => {
    expect(isBudgetKill([step({ step: "build", stderr: "error TS2304: Cannot find name" })])).toBe(
      false,
    );
  });

  /** A green test suite is free to print the word "timeout" — only failing steps are read. */
  it("ignores the word in a step that passed", () => {
    expect(
      isBudgetKill([
        step({ step: "test", exitCode: 0, stdout: "✓ retries on timeout (12ms)" }),
        step({ step: "build", stderr: "error TS2304: Cannot find name" }),
      ]),
    ).toBe(false);
  });

  it("trusts the adapter's flag over the log text", () => {
    expect(isBudgetKill([step({ step: "install", killed: true, stderr: "" })])).toBe(true);
  });

  /**
   * The reason the text match is narrow. Every one of these is a *failing* step in a repo
   * whose build is genuinely broken — if any of them counted as a budget kill, that repo
   * would never get a cached result and would burn a slot on every single Analyze.
   */
  it.each([
    ["a Jest async timeout", "Timeout - Async callback was not invoked within the 5000 ms timeout"],
    ["a Vitest timeout", "Error: Test timed out in 5000ms"],
    ["an assertion mentioning one", "AssertionError: expected 200 to equal 504 (gateway timeout)"],
    ["a filename", "src/api/timeout.ts:12:3 - error TS2304: Cannot find name"],
    ["a lint rule", "error  Promises must be awaited  @typescript-eslint/no-floating-promises"],
  ])("does not fire on %s", (_label, output) => {
    expect(isBudgetKill([step({ step: "test", stdout: output })])).toBe(false);
  });
});

describe("isFlakyInstallFailure", () => {
  it("detects a registry that dropped the connection", () => {
    expect(
      isFlakyInstallFailure([
        step({
          step: "install",
          stderr:
            "npm ERR! network request to https://registry.npmjs.org/react failed, reason: ECONNRESET",
        }),
      ]),
    ).toBe(true);
  });

  it("detects DNS failing inside the sandbox", () => {
    expect(
      isFlakyInstallFailure([
        step({ step: "install", stderr: "getaddrinfo EAI_AGAIN registry.npmjs.org" }),
      ]),
    ).toBe(true);
  });

  it("leaves a real dependency conflict alone", () => {
    expect(
      isFlakyInstallFailure([
        step({
          step: "install",
          stderr: "npm ERR! code ERESOLVE\nunable to resolve dependency tree",
        }),
      ]),
    ).toBe(false);
  });

  /**
   * A test suite that cannot reach a service it needs is a genuine production-readiness
   * finding, not our flake — it has to stay cacheable and stay reported.
   */
  it("ignores a network error outside the install step", () => {
    expect(
      isFlakyInstallFailure([
        step({ step: "test", stderr: "connect ECONNREFUSED 127.0.0.1:5432" }),
      ]),
    ).toBe(false);
  });
});

describe("inconclusiveReason", () => {
  it("prefers the budget kill when a run hit both", () => {
    expect(
      inconclusiveReason([step({ step: "install", killed: true, stderr: "ECONNRESET" })]),
    ).toBe("budget_kill");
  });

  it("returns null for a real build failure", () => {
    expect(inconclusiveReason([step({ step: "build", stderr: "error TS2304" })])).toBe(null);
  });
});

describe("missingImageToolchains", () => {
  // Verbatim output from a real E2B run against a stale template — the exact strings that
  // were being reported to users as "your repository failed to build".
  it("detects a missing Go toolchain", () => {
    expect(
      missingImageToolchains([
        step({
          step: "install",
          command: "go mod download",
          exitCode: 127,
          stderr: "/bin/bash: line 1: go: command not found",
        }),
      ]),
    ).toEqual(["go"]);
  });

  it("detects missing pnpm, cargo, mise and mix", () => {
    const steps = [
      step({
        step: "install",
        exitCode: 127,
        stderr: "/bin/bash: line 1: pnpm: command not found",
      }),
      step({
        step: "install",
        exitCode: 127,
        stderr: "/bin/bash: line 1: cargo: command not found",
      }),
      step({
        step: "install",
        exitCode: 127,
        stderr: "/bin/bash: line 1: mise: command not found",
      }),
      step({ step: "install", exitCode: 127, stderr: "/bin/bash: line 1: mix: command not found" }),
    ];
    expect(missingImageToolchains(steps)).toEqual(["cargo", "mise", "mix", "pnpm"]);
  });

  it("reports each missing toolchain once", () => {
    expect(
      missingImageToolchains([
        step({
          step: "install",
          exitCode: 127,
          stderr:
            "/bin/bash: line 1: mise: command not found | /bin/bash: line 1: mise: command not found",
        }),
      ]),
    ).toEqual(["mise"]);
  });

  it("ignores a binary the repo's own script failed to find", () => {
    // Not something we promise to provide — that is a genuine repo defect and must stay a failure.
    expect(
      missingImageToolchains([
        step({
          step: "build",
          exitCode: 127,
          stderr: "/bin/bash: line 1: some-custom-tool: command not found",
        }),
      ]),
    ).toEqual([]);
  });

  it("ignores non-127 failures that merely mention a tool name", () => {
    expect(
      missingImageToolchains([
        step({ step: "build", exitCode: 1, stderr: "go: command not found" }),
      ]),
    ).toEqual([]);
  });

  it("is empty for a clean run", () => {
    expect(missingImageToolchains([step({ step: "install", exitCode: 0 })])).toEqual([]);
  });
});
