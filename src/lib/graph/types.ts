/**
 * Dependency-graph types (v2 Phase 4). Nodes are files/modules/routes/services/tables; edges are
 * imports/routes/calls/queries. Layers model the frontend → API → service → repository → database →
 * infra → deploy flow so findings can reason across files.
 *
 * @see docs/README.md  (Phase 4)
 */

export type GraphLayer =
  | "frontend"
  | "api"
  | "service"
  | "repository"
  | "database"
  | "infrastructure"
  | "deployment"
  | "unknown";

export type NodeKind = "file" | "module" | "route" | "endpoint" | "service" | "table";

export interface GraphNode {
  /** File path for local files, `npm:<pkg>` for external modules. */
  id: string;
  kind: NodeKind;
  layer: GraphLayer;
  label: string;
  /** True for third-party/runtime modules that aren't files in the repo. */
  external?: boolean;
}

export type EdgeKind = "import" | "route" | "call" | "query";

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface DependencyGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}
