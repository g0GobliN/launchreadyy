/**
 * Build a dependency graph from per-file import lists (v2 Phase 4). Pure: callers extract imports
 * (via the AST layer's `findImports`, or a Rust indexer later) and pass them here. Local imports
 * become file→file edges; bare specifiers become external module nodes.
 *
 * @see docs/README.md  (Phase 4)
 */

import type { DependencyGraph, GraphLayer, GraphNode } from "./types";
import { packageOf, resolveImport } from "./resolve";

export interface FileImports {
  path: string;
  /** Module specifiers imported by the file (from AST `findImports`). */
  imports: string[];
}

const IMPORT_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g, // import x from '...' / export ... from '...'
  /\bimport\s+['"]([^'"]+)['"]/g, // import '...'
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, // require('...')
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('...')
];

/**
 * Regex-based import extraction for JS/TS source — the fallback used when no AST backend is available
 * (e.g. in the runtime, where the TypeScript compiler can't load). Less precise than the
 * AST (`findImports`), but it keeps the graph's edges populated instead of nodes-only. Apply only to
 * JS/TS files: quote-delimited patterns won't match Python `from x import y`, but Go `import "fmt"`
 * would — so callers gate this behind a JS/TS language check.
 */
export function extractImportsRegex(content: string): string[] {
  const specs = new Set<string>();
  for (const re of IMPORT_PATTERNS) {
    for (const m of content.matchAll(re)) specs.add(m[1]);
  }
  return [...specs].sort();
}

/** Heuristic layer from path/filename conventions. Deliberately conservative → `unknown`. */
export function inferLayer(path: string): GraphLayer {
  const p = path.toLowerCase();
  if (/(^|\/)(migrations|prisma|schema|db|database)(\/|\.|$)/.test(p)) return "database";
  if (/(^|\/)(repositories|repository|dao|data-access)(\/|$)/.test(p)) return "repository";
  if (/(^|\/)(services|service|domain|usecases)(\/|$)/.test(p)) return "service";
  if (/(^|\/)(api|routes\/api|controllers|handlers|endpoints)(\/|$)/.test(p)) return "api";
  if (
    /(^|\/)(components|pages|app|views|ui|screens)(\/|$)/.test(p) ||
    /\.(tsx|jsx|vue|svelte)$/.test(p)
  ) {
    return "frontend";
  }
  if (/(^|\/)(infra|infrastructure|terraform|k8s|kubernetes)(\/|$)/.test(p))
    return "infrastructure";
  if (/(wrangler\.toml|vercel\.json|netlify\.toml|fly\.toml|dockerfile)/.test(p))
    return "deployment";
  return "unknown";
}

function fileNode(path: string): GraphNode {
  return { id: path, kind: "file", layer: inferLayer(path), label: path, external: false };
}

/**
 * Assemble the graph. `entries` are the repo's source files with their import specifiers; every
 * imported module — local or external — becomes a node, and each import becomes an `import` edge.
 */
export function buildDependencyGraph(entries: FileImports[]): DependencyGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: DependencyGraph["edges"] = [];
  const fileSet = new Set(entries.map((e) => e.path));

  for (const entry of entries) {
    if (!nodes.has(entry.path)) nodes.set(entry.path, fileNode(entry.path));

    for (const spec of entry.imports) {
      const local = resolveImport(entry.path, spec, fileSet);
      if (local) {
        if (!nodes.has(local)) nodes.set(local, fileNode(local));
        edges.push({ from: entry.path, to: local, kind: "import" });
      } else if (spec.startsWith(".")) {
        // Relative import that didn't resolve (missing file / unsupported ext) — skip silently.
        continue;
      } else {
        const pkg = packageOf(spec);
        const id = `npm:${pkg}`;
        if (!nodes.has(id)) {
          nodes.set(id, { id, kind: "module", layer: "unknown", label: pkg, external: true });
        }
        edges.push({ from: entry.path, to: id, kind: "import" });
      }
    }
  }

  return { nodes, edges };
}
