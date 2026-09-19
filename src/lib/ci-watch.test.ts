import { describe, expect, it } from "vitest";
import {
  summariseChecks,
  userHasPushed,
  MAX_AUTO_ATTEMPTS,
  WATCH_WINDOW_MS,
} from "./ci-watch.server";

const run = (name: string, status: string, conclusion: string | null) => ({
  name,
  status,
  conclusion,
  id: 1,
});

describe("summariseChecks", () => {
  it("is pending while any check is still running", () => {
    expect(summariseChecks([run("a", "completed", "success"), run("b", "in_progress", null)])).toBe(
      "pending",
    );
  });

  it("is pending when GitHub reports no checks yet", () => {
    expect(summariseChecks([])).toBe("pending");
  });

  it("passes when every completed check succeeded", () => {
    expect(
      summariseChecks([run("a", "completed", "success"), run("b", "completed", "success")]),
    ).toBe("passed");
  });

  // A job skipped by a path filter is the workflow working as designed, not a failure.
  it("treats skipped and neutral as not-a-failure", () => {
    expect(
      summariseChecks([
        run("a", "completed", "success"),
        run("b", "completed", "skipped"),
        run("c", "completed", "neutral"),
      ]),
    ).toBe("passed");
  });

  it("fails when any completed check failed", () => {
    expect(
      summariseChecks([run("a", "completed", "success"), run("b", "completed", "failure")]),
    ).toBe("failed");
  });

  it("counts timed_out and cancelled as failures", () => {
    expect(summariseChecks([run("a", "completed", "timed_out")])).toBe("failed");
    expect(summariseChecks([run("a", "completed", "cancelled")])).toBe("failed");
  });

  // Acting on a partial result would repair against a failure a later job explains.
  it("stays pending even when one check has already failed but others are running", () => {
    expect(summariseChecks([run("a", "completed", "failure"), run("b", "queued", null)])).toBe(
      "pending",
    );
  });
});

describe("userHasPushed", () => {
  it("is true when the branch tip moved off our commit", () => {
    expect(userHasPushed("abc123", "def456")).toBe(true);
  });

  it("is false when the tip is still ours", () => {
    expect(userHasPushed("abc123", "abc123")).toBe(false);
  });

  // Before our first repair there is nothing to compare against; that is not a takeover.
  it("is false when we have not pushed anything yet", () => {
    expect(userHasPushed("abc123", null)).toBe(false);
  });
});

describe("loop bounds", () => {
  it("caps automatic repairs at two, matching verifyBeforePr", () => {
    expect(MAX_AUTO_ATTEMPTS).toBe(2);
  });

  it("gives up watching well inside a normal CI runtime", () => {
    expect(WATCH_WINDOW_MS).toBeGreaterThan(10 * 60 * 1000);
    expect(WATCH_WINDOW_MS).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});
