import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const rpc = vi.fn();
vi.mock("../data-store.server", () => ({
  getDataStore: () => ({ rpc }),
}));

import {
  acquireSandboxSlot,
  busyRetrySeconds,
  isSandboxPoolBusyError,
  maxConcurrentSandboxes,
  releaseSandboxSlot,
  SandboxPoolBusyError,
  slotStaleSeconds,
} from "./concurrency";
import { SANDBOX_TIMEOUT_MS } from "../fix-meta";

const envBackup = process.env.SANDBOX_MAX_CONCURRENT;

beforeEach(() => {
  rpc.mockReset();
  delete process.env.SANDBOX_MAX_CONCURRENT;
});

afterEach(() => {
  if (envBackup === undefined) delete process.env.SANDBOX_MAX_CONCURRENT;
  else process.env.SANDBOX_MAX_CONCURRENT = envBackup;
  vi.restoreAllMocks();
});

describe("maxConcurrentSandboxes", () => {
  it("defaults when unset", () => {
    expect(maxConcurrentSandboxes()).toBe(8);
  });

  it("reads SANDBOX_MAX_CONCURRENT", () => {
    process.env.SANDBOX_MAX_CONCURRENT = "40";
    expect(maxConcurrentSandboxes()).toBe(40);
  });

  it.each(["0", "-5", "abc", ""])("falls back to the default for %o", (raw) => {
    process.env.SANDBOX_MAX_CONCURRENT = raw;
    expect(maxConcurrentSandboxes()).toBe(8);
  });
});

describe("slotStaleSeconds", () => {
  it("outlasts the longest plan budget", () => {
    // A slot must never be reclaimed while its sandbox could still be running, or two
    // sandboxes end up sharing one slot and the cap silently drifts upward.
    expect(slotStaleSeconds() * 1_000).toBeGreaterThan(SANDBOX_TIMEOUT_MS);
  });
});

describe("busyRetrySeconds", () => {
  it("stays inside the jitter window", () => {
    for (let i = 0; i < 50; i++) {
      const s = busyRetrySeconds();
      expect(s).toBeGreaterThanOrEqual(15);
      expect(s).toBeLessThan(30);
    }
  });

  it("does not return the same delay every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => busyRetrySeconds()));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("acquireSandboxSlot", () => {
  it("resolves when the pool grants a slot", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(acquireSandboxSlot("run-1")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("acquire_sandbox_slot", {
      p_run_id: "run-1",
      p_max: 8,
      p_stale_seconds: slotStaleSeconds(),
    });
  });

  it("throws a busy error when the pool is full", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(acquireSandboxSlot("run-1")).rejects.toBeInstanceOf(SandboxPoolBusyError);
  });

  it("fails closed when the counter errors", async () => {
    // An unverifiable cap is not a cap. Handing out a slot here would lift the limit
    // exactly when load is high enough to break the counter.
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    await expect(acquireSandboxSlot("run-1")).rejects.toBeInstanceOf(SandboxPoolBusyError);
  });

  it("fails closed when the rpc throws", async () => {
    rpc.mockRejectedValue(new Error("socket hang up"));
    await expect(acquireSandboxSlot("run-1")).rejects.toBeInstanceOf(SandboxPoolBusyError);
  });

  it("carries a retry delay", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await acquireSandboxSlot("run-1").catch((err: SandboxPoolBusyError) => {
      expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(15);
    });
  });
});

describe("releaseSandboxSlot", () => {
  it("releases by run id", async () => {
    rpc.mockResolvedValue({ error: null });
    await releaseSandboxSlot("run-1");
    expect(rpc).toHaveBeenCalledWith("release_sandbox_slot", { p_run_id: "run-1" });
  });

  it("swallows failures so it cannot mask the run outcome", async () => {
    // Runs in a finally block — throwing here would replace the real error with this one.
    rpc.mockRejectedValue(new Error("db down"));
    await expect(releaseSandboxSlot("run-1")).resolves.toBeUndefined();
  });
});

describe("isSandboxPoolBusyError", () => {
  it("matches by name, so a duplicate class identity still counts", () => {
    const lookalike = new Error("busy");
    lookalike.name = "SandboxPoolBusyError";
    expect(isSandboxPoolBusyError(lookalike)).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isSandboxPoolBusyError(new Error("build failed"))).toBe(false);
    expect(isSandboxPoolBusyError("busy")).toBe(false);
    expect(isSandboxPoolBusyError(null)).toBe(false);
  });
});
