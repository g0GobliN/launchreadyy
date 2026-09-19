import { describe, expect, it } from "vitest";
import { findCrossFileSecurityIssues } from "./cross-file-findings";
import type { DependencyGraph } from "./types";
import { dedupeIssues } from "../scanner-rules";

function graph(): DependencyGraph {
  return {
    nodes: new Map([
      [
        "src/api/users.ts",
        { id: "src/api/users.ts", kind: "file", layer: "api", label: "users.ts" },
      ],
      [
        "src/db/users.ts",
        { id: "src/db/users.ts", kind: "file", layer: "database", label: "db/users.ts" },
      ],
    ]),
    edges: [{ from: "src/api/users.ts", to: "src/db/users.ts", kind: "import" }],
  };
}

describe("findCrossFileSecurityIssues", () => {
  it("flags API→database without auth", () => {
    const issues = findCrossFileSecurityIssues(graph(), {
      "src/api/users.ts": "export function list() { return db.query('SELECT * FROM users') }",
      "src/db/users.ts": "export const db = {}",
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.fixId).toBe("graph-cross-file-auth");
  });

  it("skips when auth hint present", () => {
    const issues = findCrossFileSecurityIssues(graph(), {
      "src/api/users.ts": "export function list(req) { requireAuth(req); return db.query('x') }",
      "src/db/users.ts": "",
    });
    expect(issues).toHaveLength(0);
  });

  /** Several unguarded API files, all reaching the same database module. */
  function multiRouteGraph(routes: string[]): DependencyGraph {
    const nodes = new Map<
      string,
      DependencyGraph["nodes"] extends Map<string, infer V> ? V : never
    >([["src/db.ts", { id: "src/db.ts", kind: "file", layer: "database", label: "db.ts" }]]);
    for (const r of routes) {
      nodes.set(`src/api/${r}.ts`, {
        id: `src/api/${r}.ts`,
        kind: "file",
        layer: "api",
        label: `${r}.ts`,
      });
    }
    return {
      nodes,
      edges: routes.map((r) => ({
        from: `src/api/${r}.ts`,
        to: "src/db.ts",
        kind: "import" as const,
      })),
    };
  }

  /**
   * Regression: this emitted one issue per API file, and every one carried the same
   * `graph-cross-file-auth` fixId. The scan pipes the result through dedupeIssues, which keeps
   * only the first issue per fixId — so a repo with users/orders/admin/billing exposed reported
   * exactly one route and silently dropped the other three, including the sensitive ones.
   */
  it("reports every unguarded route in one finding that survives dedupe", () => {
    const routes = ["users", "orders", "admin", "billing"];
    const contents: Record<string, string> = { "src/db.ts": "export const db = {}" };
    for (const r of routes) {
      contents[`src/api/${r}.ts`] =
        `export function list() { return db.query('SELECT * FROM ${r}') }`;
    }

    const issues = findCrossFileSecurityIssues(multiRouteGraph(routes), contents);

    // One issue, because a second would not survive dedupeIssues...
    expect(issues).toHaveLength(1);
    // ...but it must still account for all four routes.
    expect(issues[0]!.title).toContain("(4 found)");
    for (const r of routes) {
      expect(issues[0]!.foundEvidence).toContain(`src/api/${r}.ts`);
    }
    expect(dedupeIssues(issues)).toHaveLength(1);
  });

  it("caps the evidence list but still discloses the remainder", () => {
    const routes = ["a", "b", "c", "d", "e", "f", "g"];
    const contents: Record<string, string> = { "src/db.ts": "export const db = {}" };
    for (const r of routes) {
      contents[`src/api/${r}.ts`] =
        `export function list() { return db.query('SELECT * FROM ${r}') }`;
    }

    const issues = findCrossFileSecurityIssues(multiRouteGraph(routes), contents);
    expect(issues[0]!.title).toContain("(7 found)");
    expect(issues[0]!.foundEvidence).toContain("+2 more");
  });
});
