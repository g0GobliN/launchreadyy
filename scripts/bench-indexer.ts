/**
 * Benchmark: TS reference indexer vs the native Rust `lr-indexer` binary (v2 Phase 5).
 *
 * Generates a large synthetic repo and times both paths. The Rust path here goes through the
 * stdin/stdout JSON bridge, so it includes process-spawn + JSON (de)serialization overhead — the
 * realistic cost when the Worker/Node hands content to the binary. Run:
 *   npx tsx scripts/bench-indexer.ts
 * Requires the binary: `cargo build --release --manifest-path rust/Cargo.toml`.
 */

import { indexRepository, type SourceFile } from "../src/lib/indexer/index";
import { rustIndexerBinary, rustNativeIndex } from "../src/lib/indexer/rust-backend.server";

function synthRepo(fileCount: number, linesPerFile: number): SourceFile[] {
  const files: SourceFile[] = [];
  for (let i = 0; i < fileCount; i++) {
    const lines: string[] = [];
    for (let l = 0; l < linesPerFile; l++) {
      lines.push(`export const v${l} = doWork(${l}, "item-${i}-${l}") + eval("noop");`);
    }
    files.push({ path: `src/gen/mod${i}/file${i}.ts`, content: lines.join("\n") + "\n" });
  }
  return files;
}

function time<T>(fn: () => T): { ms: number; out: T } {
  const t0 = performance.now();
  const out = fn();
  return { ms: performance.now() - t0, out };
}

const FILES = 1200;
const LINES = 250;
const repo = synthRepo(FILES, LINES);
const totalLoc = FILES * LINES;
console.log(`Synthetic repo: ${FILES} files × ${LINES} lines = ${totalLoc.toLocaleString()} LOC`);

const bin = rustIndexerBinary();
if (!bin) {
  console.log("Rust binary not found — build it, then re-run. Timing TS only.");
}

// warm up
indexRepository(repo.slice(0, 10));

const ts = time(() => indexRepository(repo));
console.log(`TS reference : ${ts.ms.toFixed(0)} ms  (${ts.out.files.length} files indexed)`);

if (bin) {
  const rust = time(() => rustNativeIndex(repo));
  if (rust.out) {
    console.log(
      `Rust (bridge): ${rust.ms.toFixed(0)} ms  (${rust.out.files.length} files indexed)`,
    );
    const speedup = ts.ms / rust.ms;
    console.log(
      `Speedup: ${speedup.toFixed(2)}× ${speedup >= 1 ? "(Rust faster)" : "(TS faster — IPC/JSON dominates at this size)"}`,
    );
  } else {
    console.log("Rust run returned null (unexpected).");
  }
}
