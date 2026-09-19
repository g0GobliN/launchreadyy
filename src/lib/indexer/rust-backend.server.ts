/**
 * Native Rust indexer bridge (v2 Phase 5, deep tier). Invokes the `lr-indexer` binary — the same
 * mechanism the E2B sandbox uses — piping `{path,content}[]` in and parsing the `RepoIndex` JSON out
 * (camelCase, identical shape to the TS reference). Synchronous (spawnSync) and never throws: a
 * missing binary, non-zero exit, or unparseable output all return null so callers fall back to TS.
 *
 * @see docs/README.md  (Phase 5)
 * @see rust/crates/indexer/src/bin/lr-indexer.rs
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { RepoIndex, SourceFile } from "./index";

/**
 * Locate the native indexer binary, or null when it isn't built or `fs` isn't available (e.g. the
 * the runtime has no filesystem — the caller then uses WASM or the TS reference).
 */
export function rustIndexerBinary(): string | null {
  try {
    const fromEnv = process.env.LR_RUST_INDEXER;
    if (fromEnv && existsSync(fromEnv)) return fromEnv;
    const ext = process.platform === "win32" ? ".exe" : "";
    const candidate = `rust/target/release/lr-indexer${ext}`;
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/** Run the native indexer, or null on any failure (missing binary, spawn error, bad JSON). */
export function rustNativeIndex(files: SourceFile[]): RepoIndex | null {
  const bin = rustIndexerBinary();
  if (!bin) return null;
  try {
    const res = spawnSync(bin, {
      input: JSON.stringify(files),
      maxBuffer: 512 * 1024 * 1024,
      encoding: "utf-8",
    });
    if (res.status !== 0 || !res.stdout) return null;
    return JSON.parse(res.stdout) as RepoIndex;
  } catch {
    return null;
  }
}
