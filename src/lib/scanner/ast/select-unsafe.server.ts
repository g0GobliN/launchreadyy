/**
 * Unsafe-call backend selector. Priority when `flag_rust_indexer` is on:
 *   1. native `lr-indexer --unsafe-calls`
 *   2. WASM `extract_unsafe_calls_json`
 *   3. undefined → per-file TS `findUnsafeCalls`
 *
 * Independent of `flag_semantic_scanner` (which gates whether AST unsafe-calls run at all).
 */

import { isFeatureEnabled } from "../../site-config.server";
import { rustIndexerBinary } from "../../indexer/rust-backend.server";
import { rustExtractUnsafeCalls, type FileUnsafeCalls } from "./rust-unsafe.server";

export type UnsafeCallsExtractor = (
  files: { path: string; content: string }[],
) => FileUnsafeCalls[] | null;

export async function getUnsafeCallsExtractor(): Promise<UnsafeCallsExtractor | undefined> {
  try {
    if (!(await isFeatureEnabled("flag_rust_indexer"))) return undefined;

    if (rustIndexerBinary()) return rustExtractUnsafeCalls;

    const { rustWasmAvailable, rustWasmExtractUnsafeCalls } =
      await import("../../indexer/wasm-backend.server");
    if (rustWasmAvailable()) return rustWasmExtractUnsafeCalls;
  } catch {
    // fall through
  }
  return undefined;
}
