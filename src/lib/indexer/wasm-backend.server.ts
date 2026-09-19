/**
 * WASM indexer / import-extraction bridge for the runtime (fast tier).
 *
 * Loads the wasm-pack artifact through Vite. Prefer the native binary
 * (`rust-backend.server.ts`) when present.
 *
 * Never throws: missing artifact, init failure, or bad JSON all return null/false so callers keep
 * the TS reference. Gated by `flag_rust_indexer` in the selectors.
 *
 * @see rust/crates/indexer/pkg/ (built by `npm run wasm:build`, gitignored)
 * @see src/lib/indexer/wasm.test.ts  (parity against the same exports)
 */

import {
  extract_imports_json,
  extract_unsafe_calls_json,
  index_files_json,
  initSync,
} from "../../../rust/crates/indexer/pkg/launchreadyy_indexer.js";
import wasmModule from "../../../rust/crates/indexer/pkg/launchreadyy_indexer_bg.wasm";
import type { FileImports } from "../graph/build";
import type { FileUnsafeCalls } from "../scanner/ast/rust-unsafe.server";
import type { RepoIndex, SourceFile } from "./index";

let available: boolean | null = null;

/** Whether the WASM module inited successfully in this runtime. Cached after the first probe. */
export function rustWasmAvailable(): boolean {
  if (available !== null) return available;
  try {
    initSync({ module: wasmModule as WebAssembly.Module | BufferSource });
    available = true;
  } catch {
    available = false;
  }
  return available;
}

/** Index via WASM, or null on any failure (caller falls back to TS). */
export function rustWasmIndex(files: SourceFile[]): RepoIndex | null {
  if (!rustWasmAvailable()) return null;
  try {
    const parsed: unknown = JSON.parse(index_files_json(JSON.stringify(files)));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as RepoIndex).files)
    ) {
      return null;
    }
    return parsed as RepoIndex;
  } catch {
    return null;
  }
}

function isFileImports(value: unknown): value is FileImports {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.path === "string" &&
    Array.isArray(v.imports) &&
    v.imports.every((i) => typeof i === "string")
  );
}

/** Extract imports via WASM, or null on any failure (caller falls back to TS AST). */
export function rustWasmExtractImports(
  files: { path: string; content: string }[],
): FileImports[] | null {
  if (!rustWasmAvailable()) return null;
  try {
    const parsed: unknown = JSON.parse(extract_imports_json(JSON.stringify(files)));
    if (!Array.isArray(parsed) || !parsed.every(isFileImports)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isUnsafeHit(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.label === "string" && typeof v.callee === "string" && typeof v.line === "number";
}

function isFileUnsafe(value: unknown): value is FileUnsafeCalls {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.path === "string" && Array.isArray(v.hits) && v.hits.every(isUnsafeHit);
}

/** Extract unsafe calls via WASM, or null on any failure. */
export function rustWasmExtractUnsafeCalls(
  files: { path: string; content: string }[],
): FileUnsafeCalls[] | null {
  if (!rustWasmAvailable()) return null;
  try {
    const parsed: unknown = JSON.parse(extract_unsafe_calls_json(JSON.stringify(files)));
    if (!Array.isArray(parsed) || !parsed.every(isFileUnsafe)) return null;
    return parsed;
  } catch {
    return null;
  }
}
