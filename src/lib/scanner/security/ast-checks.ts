/**
 * AST-backed security checks (v2 Phase 1 wiring). Runs the semantic unsafe-call rule over JS/TS
 * source and reports (a) which files it actually parsed, so the sync regex `checkUnsafeApis` skips
 * exactly those, and (b) the AST-confirmed hits, which `checkUnsafeApis` folds into its single
 * `security-unsafe-api` finding. Returning hits (not a parallel issue) is deliberate: two issues with
 * the same `fixId` would collide in `dedupeIssues` and silently drop one on a polyglot repo.
 *
 * When `flag_rust_indexer` is on, a bulk Rust/WASM pass handles extractable files first; anything it
 * omits (non-JS, skipped, parse failure) falls through to the per-file TS AST path.
 *
 * @see docs/README.md  (Phase 1)
 */

import { findUnsafeCalls } from "../ast/rules/unsafe-calls";

const SKIP_FILE = /\.(md|mdx|lock|min\.js|map|svg|test|spec)\.|__(tests|mocks)__|\.d\.ts$/i;

export interface AstUnsafeHit {
  file: string;
  line: number;
  label: string;
}

export interface AstUnsafeResult {
  /** Files the AST parser handled — the regex rule skips these (AST supersedes regex per file). */
  handledFiles: Set<string>;
  /** AST-confirmed unsafe call sites, merged into the regex rule's single aggregated finding. */
  hits: AstUnsafeHit[];
}

/**
 * Analyze the sampled source with the AST. A file that parses cleanly is "handled" even with no
 * findings (so regex won't re-scan it); a file with no available parser is left to regex — no gap.
 */
export async function computeAstUnsafeCalls(
  fileContents: Record<string, string>,
): Promise<AstUnsafeResult> {
  const handledFiles = new Set<string>();
  const hits: AstUnsafeHit[] = [];

  const entries = Object.entries(fileContents).filter(
    ([file, content]) => Boolean(content) && !SKIP_FILE.test(file),
  );

  const rustHandled = new Map<string, { line: number; label: string }[]>();
  try {
    const { getUnsafeCallsExtractor } = await import("../ast/select-unsafe.server");
    const extract = await getUnsafeCallsExtractor();
    if (extract) {
      const bulk = extract(entries.map(([path, content]) => ({ path, content })));
      if (bulk) {
        for (const f of bulk) {
          rustHandled.set(
            f.path,
            f.hits.map((h) => ({ line: h.line, label: h.label })),
          );
        }
      }
    }
  } catch {
    // Rust path declined — fall through to per-file TS
  }

  for (const [file, content] of entries) {
    const fromRust = rustHandled.get(file);
    if (fromRust !== undefined) {
      handledFiles.add(file);
      for (const h of fromRust) hits.push({ file, line: h.line, label: h.label });
      continue;
    }

    const found = await findUnsafeCalls(file, content);
    if (found === null) continue; // no parser for this file → leave it to the regex rule
    handledFiles.add(file);
    for (const h of found) hits.push({ file, line: h.line, label: h.label });
  }

  return { handledFiles, hits };
}
