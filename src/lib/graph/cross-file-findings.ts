/**
 * Cross-file findings from the dependency graph (v2 Phase 4 consumption).
 * Emits medium-confidence issues when an API-layer file reaches a database/repository
 * layer without an obvious auth guard in the API file source.
 */

import type { IssueInput } from "../scanner-rules";
import type { DependencyGraph } from "./types";
import { getNeighbors, pathBetween } from "./query";

const AUTH_HINT =
  /\b(auth|authenticate|requireAuth|withAuth|isAuthenticated|getServerSession|currentUser|authorize|before_action|login_required|Depends\s*\(\s*get_current)\b/i;

const SENSITIVE_SQL =
  /\b(queryRaw|executeRaw|\$queryRaw|raw\s*\(|sql`|\.query\s*\(\s*[`'"]|\bSELECT\b.+\bFROM\b)/i;

interface CrossFileHit {
  apiId: string;
  sinkId: string;
  sinkLayer: string;
  path: string[];
}

/**
 * Returns a single aggregated issue (or none), never one per file.
 *
 * Every finding here shares the `graph-cross-file-auth` fixId, and the scan pipes the result
 * through `dedupeIssues`, which keeps only the first issue per fixId. Emitting one issue per API
 * file therefore reported exactly one unguarded route no matter how many existed — a repo with
 * users/orders/admin/billing exposed showed only `users`, and silently dropped the rest.
 *
 * Aggregating matches how `checkHardcodedSecrets` reports ("… (3 found)" with per-hit evidence),
 * so the count survives dedupe and every affected file is still named.
 */
export function findCrossFileSecurityIssues(
  graph: DependencyGraph,
  fileContents: Record<string, string>,
): IssueInput[] {
  const apiNodes = [...graph.nodes.values()].filter((n) => n.layer === "api" && !n.external);
  const hits: CrossFileHit[] = [];

  for (const api of apiNodes) {
    const content = fileContents[api.id] ?? "";
    if (!content || AUTH_HINT.test(content)) continue;

    const targets = getNeighbors(graph, api.id);
    for (const to of targets) {
      const node = graph.nodes.get(to);
      if (!node || node.external) continue;
      if (node.layer !== "database" && node.layer !== "repository") continue;

      const sinkContent = fileContents[to] ?? "";
      const path = pathBetween(graph, api.id, to);
      if (!path) continue;

      const looksSensitive = SENSITIVE_SQL.test(sinkContent) || node.layer === "database";
      if (!looksSensitive && node.layer === "repository" && !SENSITIVE_SQL.test(content)) {
        continue;
      }

      hits.push({ apiId: api.id, sinkId: to, sinkLayer: node.layer, path });
      break; // one hit per API file — the first data-layer reach is enough to flag it
    }
  }

  if (hits.length === 0) return [];

  const shown = hits.slice(0, 5).map((h) => `${h.apiId} → ${h.sinkId} (${h.sinkLayer})`);
  const more = hits.length > shown.length ? ` +${hits.length - shown.length} more.` : "";

  return [
    {
      category: "Security",
      title: `API routes may reach the data layer without auth (${hits.length} found)`,
      severity: "medium",
      why: "Cross-file graph shows API-layer modules importing a repository/database module without an obvious auth guard in the API source.",
      timeSaved: "45m",
      fixId: "graph-cross-file-auth",
      checkedFor: [
        ...hits.slice(0, 3).map((h) => `Graph path: ${h.path.join(" → ")}`),
        "Auth middleware / guard patterns in API file",
      ],
      foundEvidence: `No auth hint in: ${shown.join("; ")}.${more}`,
      confidence: "medium",
      detection: ["framework-aware", "rule-based"],
      recommendedFix:
        "Add authentication/authorization middleware on these routes or handlers before data-layer access.",
    },
  ];
}
