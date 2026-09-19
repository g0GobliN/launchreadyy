/**
 * Dependency-graph query API (v2 Phase 4): neighbors, impact analysis, path finding, layer lookups.
 * `impactedBy` is the reverse-reachability that gives Phase 3 precise, cross-file invalidation.
 *
 * @see docs/README.md  (Phase 4)
 */

import type { DependencyGraph, GraphLayer } from "./types";

/** Outgoing targets of a node (what it depends on). */
export function getNeighbors(graph: DependencyGraph, id: string): string[] {
  return graph.edges.filter((e) => e.from === id).map((e) => e.to);
}

/** Incoming sources of a node (who depends on it). */
export function getDependents(graph: DependencyGraph, id: string): string[] {
  return graph.edges.filter((e) => e.to === id).map((e) => e.from);
}

function reverseAdjacency(graph: DependencyGraph): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = rev.get(e.to);
    if (list) list.push(e.from);
    else rev.set(e.to, [e.from]);
  }
  return rev;
}

/**
 * Every node transitively affected by a change to `id` — i.e. everything that imports it, directly
 * or indirectly. Excludes `id` itself. Feeds incremental invalidation: a changed file's dependents
 * are the files whose findings might now be wrong.
 */
export function impactedBy(graph: DependencyGraph, id: string): string[] {
  const rev = reverseAdjacency(graph);
  const seen = new Set<string>();
  const queue = [...(rev.get(id) ?? [])];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const dep of rev.get(node) ?? []) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return [...seen];
}

/** Shortest dependency path from `a` to `b` (inclusive), or null if `b` is unreachable from `a`. */
export function pathBetween(graph: DependencyGraph, a: string, b: string): string[] | null {
  if (a === b) return [a];
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = adj.get(e.from);
    if (list) list.push(e.to);
    else adj.set(e.from, [e.to]);
  }
  const prev = new Map<string, string>();
  const seen = new Set<string>([a]);
  const queue = [a];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of adj.get(node) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, node);
      if (next === b) {
        const path = [b];
        let cur = b;
        while (cur !== a) {
          cur = prev.get(cur)!;
          path.unshift(cur);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

export function layerOf(graph: DependencyGraph, id: string): GraphLayer | null {
  return graph.nodes.get(id)?.layer ?? null;
}

export function nodesInLayer(graph: DependencyGraph, layer: GraphLayer): string[] {
  return [...graph.nodes.values()].filter((n) => n.layer === layer).map((n) => n.id);
}
