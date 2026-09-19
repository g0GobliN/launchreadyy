/**
 * Deep-tier benchmark: Rust native disk-walk vs TS reading the same directory (v2 Phase 5).
 *
 * This is the scenario that matters — files already on disk in the E2B sandbox. Rust walks + reads +
 * indexes natively (no JSON input); TS reads every file via fs then indexes. Removing the JSON bridge
 * is exactly what should let Rust win. Run:
 *   npx tsx scripts/bench-indexer-disk.ts
 * Requires the binary: `cargo build --release --manifest-path rust/Cargo.toml`.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexRepository, shouldIndexFile, type SourceFile } from "../src/lib/indexer/index";
import { rustIndexerBinary } from "../src/lib/indexer/rust-backend.server";

const FILES = 1200;
const LINES = 250;

function writeSynthRepo(root: string): void {
  for (let i = 0; i < FILES; i++) {
    const dir = join(root, "src", "gen", `mod${i % 40}`);
    mkdirSync(dir, { recursive: true });
    const lines: string[] = [];
    for (let l = 0; l < LINES; l++) {
      lines.push(`export const v${l} = doWork(${l}, "item-${i}-${l}") + eval("noop");`);
    }
    writeFileSync(join(dir, `file${i}.ts`), lines.join("\n") + "\n");
  }
}

function tsReadAndIndex(root: string) {
  const entries = readdirSync(root, { recursive: true, withFileTypes: true });
  const files: SourceFile[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const abs = join(e.parentPath ?? (e as unknown as { path: string }).path, e.name);
    const rel = abs.slice(root.length + 1).replaceAll("\\", "/");
    if (!shouldIndexFile(rel)) continue;
    files.push({ path: rel, content: readFileSync(abs, "utf-8") });
  }
  return indexRepository(files);
}

function time<T>(fn: () => T): { ms: number; out: T } {
  const t0 = performance.now();
  const out = fn();
  return { ms: performance.now() - t0, out };
}

// Optional: benchmark an existing directory (e.g. `npx tsx scripts/bench-indexer-disk.ts src`),
// which avoids the %TEMP% + Windows-Defender-scans-fresh-files artifact — apples-to-apples on files
// both processes see as already-scanned. With no arg, a synthetic repo is generated in %TEMP%.
const existingDir = process.argv[2];
const root = existingDir ?? mkdtempSync(join(tmpdir(), "lr-bench-"));
try {
  if (existingDir) {
    console.log(`Benchmarking existing directory: ${root}`);
  } else {
    console.log(`Writing ${FILES} files × ${LINES} lines to ${root} ...`);
    writeSynthRepo(root);
    console.log(`Synthetic repo on disk: ${(FILES * LINES).toLocaleString()} LOC`);
  }

  const ts = time(() => tsReadAndIndex(root));
  console.log(`TS  (fs read + index) : ${ts.ms.toFixed(0)} ms  (${ts.out.files.length} files)`);

  const bin = rustIndexerBinary();
  if (!bin) {
    console.log("Rust binary not found — build it, then re-run.");
  } else {
    const rust = time(() => {
      const res = spawnSync(bin, [root], { maxBuffer: 512 * 1024 * 1024, encoding: "utf-8" });
      return res.status === 0 ? (JSON.parse(res.stdout) as { files: unknown[] }) : null;
    });
    if (rust.out) {
      console.log(
        `Rust (disk-walk)      : ${rust.ms.toFixed(0)} ms  (${rust.out.files.length} files)`,
      );
      const speedup = ts.ms / rust.ms;
      console.log(
        `Speedup: ${speedup.toFixed(2)}× ${speedup >= 1 ? "(Rust faster)" : "(TS faster)"}`,
      );
    }
  }
} finally {
  if (!existingDir) rmSync(root, { recursive: true, force: true });
}
