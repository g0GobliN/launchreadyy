/**
 * Reference AST-backed rule (v2 Phase 1): detect unsafe dynamic-execution calls in TS/JS.
 *
 * This is the AST counterpart to the regex `checkUnsafeApis` in scanner/security/unsafe-apis.ts. The
 * regex form matches `eval(` anywhere — including inside string literals (`"never use eval()"`) and
 * trailing comments — producing false positives. Querying the AST reports only real call sites, so a
 * literal or comment mentioning `eval(` is a `string`/comment node, never a `call`.
 *
 * Returns `null` when no AST backend can serve the file, signalling the caller to fall back to the
 * regex rule — the graceful-degradation contract. This module is intentionally standalone: wiring it
 * into the (currently synchronous) security pipeline behind `flag_semantic_scanner` is a tracked
 * Phase 1 follow-up, so existing behavior stays identical while the flag is off.
 *
 * @see docs/README.md  (Phase 1)
 */

import { findCalls, findNew, parseSource } from "../index";

export interface UnsafeCallHit {
  /** Stable label matching the regex rule's vocabulary. */
  label: string;
  /** The callee text as written (e.g. `eval`, `cp.exec`). */
  callee: string;
  /** 1-based line of the call site. */
  line: number;
}

/** Callee last-segment → human label, mirroring the regex rule's categories. */
const UNSAFE_CALLEES: Record<string, string> = {
  eval: "eval()",
  exec: "child_process exec/spawn",
  execSync: "child_process exec/spawn",
  spawn: "child_process exec/spawn",
  spawnSync: "child_process exec/spawn",
  execFile: "child_process exec/spawn",
  execFileSync: "child_process exec/spawn",
};

/**
 * Find unsafe dynamic-execution calls via AST, or `null` if this file has no available parser.
 * An empty array means "parsed, nothing found" — distinct from `null` ("couldn't parse, fall back").
 */
export async function findUnsafeCalls(
  path: string,
  source: string,
): Promise<UnsafeCallHit[] | null> {
  const result = await parseSource(path, source);
  if (!result.available || !result.tree) return null;

  const hits: UnsafeCallHit[] = [];

  for (const [callee, label] of Object.entries(UNSAFE_CALLEES)) {
    for (const node of findCalls(result.tree, callee)) {
      hits.push({ label, callee: node.name ?? callee, line: node.line });
    }
  }

  // `new Function(...)` — dynamic code construction, same risk class as eval.
  for (const node of findNew(result.tree, "Function")) {
    hits.push({ label: "new Function()", callee: node.name ?? "Function", line: node.line });
  }

  hits.sort((a, b) => a.line - b.line);
  return hits;
}
