import { describe, expect, it } from "vitest";
import { indexRepository, sweepSecretCandidates, tsIndexer } from "./index";
import { hashContent } from "../scan-engine/incremental";

describe("indexRepository", () => {
  it("computes per-file hash/size/lines and totals", () => {
    const idx = indexRepository([
      { path: "a.ts", content: "line1\nline2\n" },
      { path: "b.ts", content: "x" },
    ]);
    expect(idx.files).toHaveLength(2);
    expect(idx.files[0]).toMatchObject({ path: "a.ts", lines: 2, size: 12 });
    expect(idx.files[1]).toMatchObject({ path: "b.ts", lines: 1, size: 1 });
    expect(idx.totalBytes).toBe(13);
    expect(idx.totalLines).toBe(3);
  });

  it("hashes identically to hashContent (parity with the Rust FNV-1a accelerator)", () => {
    const idx = indexRepository([{ path: "a.ts", content: "hello world" }]);
    expect(idx.files[0].hash).toBe(hashContent("hello world"));
  });

  it("counts an empty file as zero lines", () => {
    const idx = indexRepository([{ path: "empty.ts", content: "" }]);
    expect(idx.files[0].lines).toBe(0);
    expect(idx.totalLines).toBe(0);
  });

  it("does not count a trailing newline as an extra line (matches Rust lines())", () => {
    expect(indexRepository([{ path: "a", content: "one\ntwo" }]).files[0].lines).toBe(2);
    expect(indexRepository([{ path: "a", content: "one\ntwo\n" }]).files[0].lines).toBe(2);
  });

  it("exposes the Indexer contract", () => {
    expect(tsIndexer.id).toBe("ts-reference");
    expect(tsIndexer.index([{ path: "a", content: "y" }]).files).toHaveLength(1);
  });
});

describe("sweepSecretCandidates", () => {
  it("flags high-signal secret shapes with file+line", () => {
    const hits = sweepSecretCandidates([
      {
        path: "src/config.ts",
        content: ["const region = 'us-east-1';", "const key = 'AKIAIOSFODNN7EXAMPLE';"].join("\n"),
      },
    ]);
    expect(hits).toEqual([{ path: "src/config.ts", line: 2, kind: "aws-access-key" }]);
  });

  it("caps hits per file", () => {
    const line = "token sk_live_abcdefghijklmnopqrstuvwxyz0123456789\n";
    const hits = sweepSecretCandidates([{ path: "f", content: line.repeat(50) }], {
      maxPerFile: 5,
    });
    expect(hits).toHaveLength(5);
  });

  it("returns nothing for clean files", () => {
    expect(sweepSecretCandidates([{ path: "a.ts", content: "export const x = 1;" }])).toEqual([]);
  });
});
