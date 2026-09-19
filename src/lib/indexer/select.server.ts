/**
 * Indexer backend selector (v2 Phase 5). Priority when `flag_rust_indexer` is on:
 *   1. native `lr-indexer` binary (Node / sandbox)
 *   2. WASM module — loaded lazily so disabled installations skip the ~1.6 MB artifact
 *   3. TypeScript reference
 *
 * Never throws — and even a chosen Rust backend falls back to TS per-call if a run fails.
 *
 * @see docs/README.md  (Phase 5)
 */

import { isFeatureEnabled } from "../site-config.server";
import { indexRepository, tsIndexer, type Indexer } from "./index";
import { rustIndexerBinary, rustNativeIndex } from "./rust-backend.server";

export async function getIndexer(): Promise<Indexer> {
  try {
    if (!(await isFeatureEnabled("flag_rust_indexer"))) return tsIndexer;

    if (rustIndexerBinary()) {
      return {
        id: "rust-native",
        index: (files) => rustNativeIndex(files) ?? indexRepository(files),
      };
    }

    const { rustWasmAvailable, rustWasmIndex } = await import("./wasm-backend.server");
    if (rustWasmAvailable()) {
      return {
        id: "rust-wasm",
        index: (files) => rustWasmIndex(files) ?? indexRepository(files),
      };
    }
  } catch {
    // fall through to the TS reference
  }
  return tsIndexer;
}
