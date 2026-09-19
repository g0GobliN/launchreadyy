/**
 * Import-extraction backend selector. Priority when `flag_rust_indexer` is on:
 *   1. native `lr-indexer --imports` (Node / sandbox)
 *   2. WASM `extract_imports_json` (runtime) — loaded lazily
 *   3. undefined → `buildGraphFromSources` keeps its per-file TS AST path
 *
 * Never throws.
 *
 * Mirrors `src/lib/indexer/select.server.ts`.
 */

import { isFeatureEnabled } from "../site-config.server";
import { rustIndexerBinary } from "../indexer/rust-backend.server";
import { rustExtractImports } from "./rust-imports.server";
import type { BulkImportsExtractor } from "./index";

export async function getImportsExtractor(): Promise<BulkImportsExtractor | undefined> {
  try {
    if (!(await isFeatureEnabled("flag_rust_indexer"))) return undefined;

    if (rustIndexerBinary()) return rustExtractImports;

    const { rustWasmAvailable, rustWasmExtractImports } =
      await import("../indexer/wasm-backend.server");
    if (rustWasmAvailable()) return rustWasmExtractImports;
  } catch {
    // fall through to the TS AST path
  }
  return undefined;
}
