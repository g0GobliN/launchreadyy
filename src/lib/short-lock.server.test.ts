import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * In-memory stand-in for the acquire_short_lock / release_short_lock RPCs, mirroring the
 * plpgsql in supabase/schema.sql: sweep the key if it has aged past its TTL, then let the
 * primary key decide the winner. Modelled rather than stubbed per-call so the lock's actual
 * exclusion semantics are what gets tested.
 */
const locks = new Map<string, number>();
let now = 1_700_000_000_000;
let rpcError: string | null = null;

vi.mock("./data-store.server", () => ({
  getDataStore: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (rpcError) return { data: null, error: { message: rpcError } };
      const key = args.p_key as string;
      if (fn === "release_short_lock") {
        locks.delete(key);
        return { data: null, error: null };
      }
      const ttlMs = Math.max(1, args.p_ttl_seconds as number) * 1000;
      const held = locks.get(key);
      if (held !== undefined && now - held >= ttlMs) locks.delete(key);
      if (locks.has(key)) return { data: false, error: null };
      locks.set(key, now);
      return { data: true, error: null };
    },
  }),
}));

const { acquireShortLock, releaseShortLock } = await import("./short-lock.server");

beforeEach(() => {
  locks.clear();
  now = 1_700_000_000_000;
  rpcError = null;
});

describe("acquireShortLock", () => {
  it("grants the lock to one caller and denies the rest", async () => {
    const results = await Promise.all([
      acquireShortLock("credit_pack_invoice:octo:small", 30),
      acquireShortLock("credit_pack_invoice:octo:small", 30),
      acquireShortLock("credit_pack_invoice:octo:small", 30),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("does not let one key block a different user or a different pack", async () => {
    expect(await acquireShortLock("credit_pack_invoice:octo:small", 30)).toBe(true);
    expect(await acquireShortLock("credit_pack_invoice:octo:large", 30)).toBe(true);
    expect(await acquireShortLock("credit_pack_invoice:hubot:small", 30)).toBe(true);
  });

  /** A repeat purchase of the same pack must not be blocked by the previous one. */
  it("is reacquirable once released", async () => {
    expect(await acquireShortLock("credit_pack_invoice:octo:small", 30)).toBe(true);
    await releaseShortLock("credit_pack_invoice:octo:small");
    expect(await acquireShortLock("credit_pack_invoice:octo:small", 30)).toBe(true);
  });

  /** A request killed before its release must not wedge the pack forever. */
  it("reclaims a lock whose holder died, once the TTL passes", async () => {
    expect(await acquireShortLock("credit_pack_invoice:octo:small", 30)).toBe(true);

    now += 29_000;
    expect(await acquireShortLock("credit_pack_invoice:octo:small", 30)).toBe(false);

    now += 2_000;
    expect(await acquireShortLock("credit_pack_invoice:octo:small", 30)).toBe(true);
  });

  /** Failing closed here would stop scheduled maintenance over a DB hiccup. */
  it("fails open when the RPC errors", async () => {
    rpcError = "connection refused";
    expect(await acquireShortLock("credit_pack_invoice:octo:small", 30)).toBe(true);
  });
});

describe("releaseShortLock", () => {
  it("is a no-op for a lock that is not held", async () => {
    await expect(releaseShortLock("credit_pack_invoice:octo:small")).resolves.toBeUndefined();
  });

  it("swallows RPC errors so a failed release cannot break the caller's flow", async () => {
    expect(await acquireShortLock("credit_pack_invoice:octo:small", 30)).toBe(true);
    rpcError = "connection refused";
    await expect(releaseShortLock("credit_pack_invoice:octo:small")).resolves.toBeUndefined();
  });
});
