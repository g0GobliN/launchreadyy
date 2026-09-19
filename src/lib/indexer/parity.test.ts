import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hashContent } from "../scan-engine/incremental";

/**
 * Hash-parity: the TS `hashContent` must match the shared fixture — the same file the Rust
 * `fnv1a_hex` integration test asserts against (`rust/crates/indexer/tests/parity.rs`). Proving both
 * implementations equal this one fixture proves they equal each other, which is the contract that
 * keeps content-addressed cache keys stable whether the TS or the Rust indexer produced them.
 */
const FIXTURE = "rust/crates/indexer/tests/hash-parity.json";

interface ParityEntry {
  input: string;
  hex: string;
}

describe("hash parity (TS ⇄ Rust)", () => {
  const entries = JSON.parse(readFileSync(FIXTURE, "utf-8")) as ParityEntry[];

  it("has fixtures including Unicode and emoji surrogate pairs", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => /\p{Emoji}/u.test(e.input))).toBe(true);
  });

  it("hashContent matches the shared fixture for every input", () => {
    for (const { input, hex } of entries) {
      expect(hashContent(input), `hash mismatch for ${JSON.stringify(input)}`).toBe(hex);
    }
  });
});
