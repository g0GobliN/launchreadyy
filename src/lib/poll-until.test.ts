import { describe, expect, it, vi } from "vitest";
import { pollUntil } from "./poll-until";

describe("pollUntil", () => {
  it("returns the first result that satisfies isDone", async () => {
    let calls = 0;
    const fetchStatus = vi.fn(async () => {
      calls++;
      return { status: calls < 3 ? "running" : "passed" };
    });
    const result = await pollUntil(fetchStatus, (r) => r.status === "passed", {
      intervalMs: 0,
      maxAttempts: 10,
    });
    expect(result).toEqual({ status: "passed" });
    expect(calls).toBe(3);
  });

  it("returns 'timeout' when maxAttempts is exhausted without isDone matching", async () => {
    const fetchStatus = vi.fn(async () => ({ status: "running" }));
    const result = await pollUntil(fetchStatus, (r) => r.status === "passed", {
      intervalMs: 0,
      maxAttempts: 3,
    });
    expect(result).toBe("timeout");
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it("treats a fetchStatus rejection as 'keep polling', not a fatal error", async () => {
    let calls = 0;
    const fetchStatus = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new Error("transient network error");
      return { status: "passed" };
    });
    const result = await pollUntil(fetchStatus, (r) => r.status === "passed", {
      intervalMs: 0,
      maxAttempts: 5,
    });
    expect(result).toEqual({ status: "passed" });
  });
});
