import { describe, expect, it } from "vitest";
import { BoundedCache, contentKey, hashKey, mapWithConcurrency } from "./index";

describe("keys", () => {
  it("hashKey is stable and order-sensitive across parts", () => {
    expect(hashKey("a", "b")).toBe(hashKey("a", "b"));
    expect(hashKey("a", "b")).not.toBe(hashKey("b", "a"));
  });

  it("hashKey does not collide across different part boundaries (NUL-joined, not space)", () => {
    // With a space separator these would both be "a b c" and collide; NUL-joining keeps them distinct.
    expect(hashKey("a b", "c")).not.toBe(hashKey("a", "b c"));
  });

  it("contentKey is stable regardless of inputHash ordering and changes when inputs change", () => {
    const a = contentKey({ ruleId: "unsafe-api", version: 3, inputHashes: ["h1", "h2"] });
    const b = contentKey({ ruleId: "unsafe-api", version: 3, inputHashes: ["h2", "h1"] });
    const c = contentKey({ ruleId: "unsafe-api", version: 3, inputHashes: ["h2", "h3"] });
    const d = contentKey({ ruleId: "unsafe-api", version: 4, inputHashes: ["h1", "h2"] });
    expect(a).toBe(b); // order-insensitive
    expect(a).not.toBe(c); // different inputs
    expect(a).not.toBe(d); // different rule version → cache miss (correct invalidation)
  });
});

describe("BoundedCache", () => {
  it("stores, retrieves, and reports size", () => {
    const cache = new BoundedCache<number>(10);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.has("a")).toBe(true);
    expect(cache.size).toBe(1);
  });

  it("evicts the least-recently-used entry past capacity", () => {
    const cache = new BoundedCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // touch a → b is now LRU
    cache.set("c", 3); // evicts b
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("computeIfAbsent computes once then serves from cache", async () => {
    const cache = new BoundedCache<number>();
    let calls = 0;
    const compute = async () => {
      calls++;
      return 42;
    };
    expect(await cache.computeIfAbsent("k", compute)).toBe(42);
    expect(await cache.computeIfAbsent("k", compute)).toBe(42);
    expect(calls).toBe(1);
  });

  it("computeIfAbsent dedupes concurrent in-flight callers (computes once)", async () => {
    const cache = new BoundedCache<number>();
    let calls = 0;
    const compute = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return 7;
    };
    // Both start before either resolves — they must share the single in-flight computation.
    const [a, b] = await Promise.all([
      cache.computeIfAbsent("k", compute),
      cache.computeIfAbsent("k", compute),
    ]);
    expect([a, b]).toEqual([7, 7]);
    expect(calls).toBe(1);
  });

  it("computeIfAbsent recomputes after an in-flight computation rejects", async () => {
    const cache = new BoundedCache<number>();
    let calls = 0;
    const compute = async () => {
      calls++;
      if (calls === 1) throw new Error("transient");
      return 9;
    };
    await expect(cache.computeIfAbsent("k", compute)).rejects.toThrow("transient");
    expect(await cache.computeIfAbsent("k", compute)).toBe(9); // pending cleared → retry works
    expect(calls).toBe(2);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves order and never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const results = await mapWithConcurrency(items, 3, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // actually ran in parallel
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
  });
});
