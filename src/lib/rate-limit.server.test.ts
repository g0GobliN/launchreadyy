import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RateLimitUnavailableError,
  checkRateLimit,
  enforceRateLimit,
  rateLimitByUser,
  resetRateLimitsForTests,
} from "./rate-limit.server";

describe("rate-limit.server", () => {
  afterEach(() => {
    resetRateLimitsForTests();
  });

  it("allows requests under the limit", () => {
    for (let i = 0; i < 6; i++) {
      expect(() => checkRateLimit("scan", "user:test")).not.toThrow();
    }
  });

  it("blocks when the limit is exceeded", () => {
    for (let i = 0; i < 6; i++) checkRateLimit("scan", "user:test");
    expect(() => checkRateLimit("scan", "user:test")).toThrow(/Too many requests/);
  });

  it("tracks tiers independently", () => {
    for (let i = 0; i < 6; i++) checkRateLimit("scan", "user:a");
    expect(() => checkRateLimit("ai", "user:a")).not.toThrow();
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 6; i++) checkRateLimit("scan", "user:a");
    expect(() => checkRateLimit("scan", "user:b")).not.toThrow();
  });

  // Under NODE_ENV=test the durable DB layer is skipped, so enforceRateLimit
  // exercises the in-memory layer — the fast path that must still hold.
  it("enforceRateLimit blocks once the in-memory limit is exceeded", async () => {
    for (let i = 0; i < 6; i++) await enforceRateLimit("scan", "user:e");
    await expect(enforceRateLimit("scan", "user:e")).rejects.toThrow(/Too many requests/);
  });

  it("rateLimitByUser namespaces keys under the user prefix", async () => {
    for (let i = 0; i < 6; i++) await rateLimitByUser("ai", "octocat");
    await expect(rateLimitByUser("ai", "octocat")).rejects.toThrow(/Too many requests/);
    // A different login is an independent bucket.
    await expect(rateLimitByUser("ai", "someone-else")).resolves.toBeUndefined();
  });
});

/**
 * The durable-counter path is skipped under NODE_ENV=test, so these lift that skip and stub
 * the data store to throw — the case that decides whether an unavailable limiter becomes a
 * cost-DoS window.
 */
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("./data-store.server", () => ({
  getDataStore: () => ({ rpc: rpcMock }),
}));

describe("enforceRateLimit when the durable counter is unavailable", () => {
  const prevEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    rpcMock.mockReset();
    rpcMock.mockImplementation(() => {
      throw new Error("connection refused");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = prevEnv;
    resetRateLimitsForTests();
    vi.restoreAllMocks();
  });

  it.each(["ai", "sandbox", "scan"] as const)(
    "fails closed on the metered %s tier",
    async (tier) => {
      await expect(enforceRateLimit(tier, "user:x")).rejects.toBeInstanceOf(
        RateLimitUnavailableError,
      );
    },
  );

  it("fails closed when the counter reports an error instead of throwing", async () => {
    rpcMock.mockImplementation(() => ({ data: null, error: { message: "database is locked" } }));
    await expect(enforceRateLimit("scan", "user:x")).rejects.toBeInstanceOf(
      RateLimitUnavailableError,
    );
  });

  it("still applies the in-memory limit before reaching the counter", async () => {
    rpcMock.mockImplementation(() => ({ data: { allowed: true, retry_after: 0 }, error: null }));
    for (let i = 0; i < 6; i++) await enforceRateLimit("scan", "user:y");
    await expect(enforceRateLimit("scan", "user:y")).rejects.toThrow(/Too many requests/);
  });

  it("rejects once the durable counter reports no headroom", async () => {
    rpcMock.mockImplementation(() => ({ data: { allowed: false, retry_after: 30 }, error: null }));
    await expect(enforceRateLimit("ai", "user:z")).rejects.toThrow(/Try again in 30 seconds/);
  });
});
