/**
 * Native Rust import-extraction bridge. Invokes `lr-indexer --imports` — the same binary the indexer
 * bridge uses — piping `{path,content}[]` in and parsing `[{path,imports}]` out.
 *
 * Rust parses; TypeScript still assembles the graph (`buildDependencyGraph` owns node kinds, layers
 * and resolution). One process handles the whole file set, versus the TS path's per-file parse.
 *
 * Synchronous (spawnSync) and never throws: a missing binary, non-zero exit, or unparseable output
 * all return null so callers fall back to the TS AST layer.
 *
 * @see rust/crates/indexer/src/ast.rs
 * @see src/lib/indexer/rust-backend.server.ts  (the same pattern, for indexing)
 */

import { spawnSync } from "node:child_process";
import { rustIndexerBinary } from "../indexer/rust-backend.server";
import type { FileImports } from "./build";

/** Shape the binary emits. Validated before use — never trusted structurally. */
function isFileImports(value: unknown): value is FileImports {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.path === "string" &&
    Array.isArray(v.imports) &&
    v.imports.every((i) => typeof i === "string")
  );
}

/**
 * Extract imports for every file via the Rust binary, or null on any failure.
 *
 * One entry per input file, in order — files that contribute no imports (non-JS, `.d.ts`, minified,
 * test/spec) come back with an empty array rather than being dropped, so the graph's node set is the
 * same as the TS path's.
 */
export function rustExtractImports(
  files: { path: string; content: string }[],
): FileImports[] | null {
  const bin = rustIndexerBinary();
  if (!bin) return null;
  try {
    const res = spawnSync(bin, ["--imports"], {
      input: JSON.stringify(files),
      maxBuffer: 512 * 1024 * 1024,
      encoding: "utf-8",
    });
    if (res.status !== 0 || !res.stdout) return null;
    const parsed: unknown = JSON.parse(res.stdout);
    if (!Array.isArray(parsed) || !parsed.every(isFileImports)) return null;
    return parsed;
  } catch {
    return null;
  }
}
