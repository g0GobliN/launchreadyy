/**
 * Dependency graph — public façade (v2 Phase 4).
 *
 * @see docs/README.md  (Phase 4)
 */

import { detectAstLanguage, findImports, parseSource } from "../scanner/ast";
import { buildDependencyGraph, extractImportsRegex, type FileImports } from "./build";
import type { DependencyGraph, GraphEdge, GraphNode } from "./types";

export type { DependencyGraph, GraphEdge, GraphLayer, GraphNode, NodeKind } from "./types";
export { buildDependencyGraph, extractImportsRegex, inferLayer, type FileImports } from "./build";
export { normalizePath, packageOf, resolveImport } from "./resolve";
export { findCrossFileSecurityIssues } from "./cross-file-findings";

/**
 * Extracts every file's imports in one call, or null to decline. Injected rather than imported so
 * this module stays free of `node:` builtins and keeps working in the Worker.
 *
 * @see src/lib/graph/select.server.ts
 */
export type BulkImportsExtractor = (
  files: { path: string; content: string }[],
) => FileImports[] | null;

/**
 * Build a graph directly from source files by extracting imports via the AST layer. Files whose
 * language has no parser contribute a node with no outgoing import edges (graceful degradation).
 *
 * Pass `extractImports` to use an accelerator (the Rust indexer) for the extraction step; graph
 * assembly stays here either way. A null result from it falls back to the per-file TS path.
 */
export async function buildGraphFromSources(
  files: { path: string; content: string }[],
  opts?: { extractImports?: BulkImportsExtractor },
): Promise<DependencyGraph> {
  const bulk = opts?.extractImports?.(files);
  if (bulk) return buildDependencyGraph(bulk);

  const entries: FileImports[] = [];
  for (const file of files) {
    const parsed = await parseSource(file.path, file.content);
    let imports: string[] = [];
    if (parsed.available && parsed.tree) {
      imports = findImports(parsed.tree);
    } else if (JS_LANGS.has(detectAstLanguage(file.path) ?? "")) {
      // No AST backend here (e.g. the Worker) — fall back to regex so JS/TS edges still appear.
      imports = extractImportsRegex(file.content);
    }
    entries.push({ path: file.path, imports });
  }
  return buildDependencyGraph(entries);
}

const JS_LANGS = new Set(["typescript", "javascript", "tsx", "jsx"]);

export interface SerializedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Serialize a graph to a plain JSON blob (v1 persistence: one blob per scan). */
export function serializeGraph(graph: DependencyGraph): SerializedGraph {
  return { nodes: [...graph.nodes.values()], edges: graph.edges };
}

/** Rehydrate a graph from its serialized blob. */
export function deserializeGraph(blob: SerializedGraph): DependencyGraph {
  return {
    nodes: new Map(blob.nodes.map((n) => [n.id, n])),
    edges: blob.edges,
  };
}
