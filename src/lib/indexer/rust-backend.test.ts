import { describe, expect, it } from "vitest";
import { indexRepository } from "./index";
import { rustIndexerBinary, rustNativeIndex } from "./rust-backend.server";

// These tests spawn the real `lr-indexer` binary. When it isn't built (e.g. CI without a Rust
// toolchain) they skip — the binary is an optional accelerator, so its absence must never fail `npm
// test`. Build it with `cargo build --release --manifest-path rust/Cargo.toml`.
const binary = rustIndexerBinary();

describe.skipIf(!binary)("rustNativeIndex — functional parity with the TS reference", () => {
  const files = [
    { path: "src/a.ts", content: "export const x = 1;\neval(y);\n" },
    { path: "src/b.ts", content: "你好\nconst k = 'AKIAIOSFODNN7EXAMPLE';\n" },
    { path: "node_modules/dep/i.js", content: "skip me" }, // filtered by both
    { path: "assets/logo.png", content: "binary-ish" }, // filtered by both
  ];

  it("produces the same file set, hashes, sizes, and line counts as the TS indexer", () => {
    const rust = rustNativeIndex(files);
    const ts = indexRepository(files);
    expect(rust).not.toBeNull();

    expect(rust!.files.map((f) => f.path).sort()).toEqual(ts.files.map((f) => f.path).sort());
    const byPath = Object.fromEntries(rust!.files.map((f) => [f.path, f]));
    for (const t of ts.files) {
      expect(byPath[t.path].hash, `hash ${t.path}`).toBe(t.hash);
      expect(byPath[t.path].size, `size ${t.path}`).toBe(t.size);
      expect(byPath[t.path].lines, `lines ${t.path}`).toBe(t.lines);
    }
    expect(rust!.totalBytes).toBe(ts.totalBytes);
    expect(rust!.totalLines).toBe(ts.totalLines);
  });

  it("returns a camelCase RepoIndex the TS type can consume directly", () => {
    const idx = rustNativeIndex([{ path: "a.ts", content: "x" }])!;
    expect(idx).toHaveProperty("totalBytes");
    expect(idx).toHaveProperty("totalLines");
    expect(idx.files[0]).toMatchObject({ path: "a.ts", size: 1, lines: 1 });
  });
});
