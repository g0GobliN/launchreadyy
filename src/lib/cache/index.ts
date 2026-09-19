/**
 * Content-addressed caching + bounded parallelism (v2 Phase 11). Cache keys are derived from inputs
 * (content hash + rule/tool version), so an entry is valid exactly while its inputs are — no manual
 * invalidation. The executor runs independent work concurrently with a fixed ceiling. Both are pure,
 * in-process primitives; durable/cross-request caches build on the same key scheme at the call site.
 *
 * @see docs/README.md  (Phase 11)
 */

import { hashContent } from "../scan-engine/incremental";

/** Derive a stable cache key from its parts. NUL-joined so parts can't collide by concatenation. */
export function hashKey(...parts: (string | number)[]): string {
  return hashContent(parts.map(String).join("\0"));
}

/**
 * A content-addressed key for a rule's result over some inputs. Two scans with the same rule
 * version and the same input hashes get the same key → a cache hit that's provably still valid.
 */
export function contentKey(input: {
  ruleId: string;
  version: string | number;
  inputHashes: string[];
}): string {
  return hashKey(input.ruleId, input.version, ...[...input.inputHashes].sort());
}

/** A bounded LRU cache (Map insertion-order eviction). Not thread-shared; per-process. */
export class BoundedCache<V> {
  private readonly store = new Map<string, V>();
  /** In-flight computations, so concurrent `computeIfAbsent` callers share one run per key. */
  private readonly pending = new Map<string, Promise<V>>();
  constructor(private readonly maxSize = 1000) {}

  get size(): number {
    return this.store.size;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  get(key: string): V | undefined {
    const v = this.store.get(key);
    if (v !== undefined) {
      // Touch: move to most-recently-used position.
      this.store.delete(key);
      this.store.set(key, v);
    }
    return v;
  }

  set(key: string, value: V): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, value);
    if (this.store.size > this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  /** Return the cached value or compute, cache, and return it. Concurrent callers dedupe in-flight. */
  async computeIfAbsent(key: string, compute: () => Promise<V>): Promise<V> {
    const existing = this.get(key);
    if (existing !== undefined) return existing;
    // Dedupe concurrent misses: a second caller for the same key awaits the first computation
    // instead of running `compute` again. The pending entry is cleared on settle (success or error).
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const promise = (async () => {
      try {
        const value = await compute();
        this.set(key, value);
        return value;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, promise);
    return promise;
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Map over items with a fixed concurrency ceiling, preserving input order in the results. Used to
 * parallelize independent rule execution without unbounded fan-out.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(limit, items.length || 1));
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}
