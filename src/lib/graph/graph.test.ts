import { describe, expect, it } from "vitest";
import { normalizePath, packageOf, resolveImport } from "./resolve";
import { buildDependencyGraph, extractImportsRegex, inferLayer, type FileImports } from "./build";
import { getDependents, getNeighbors, impactedBy, nodesInLayer, pathBetween } from "./query";
import { buildGraphFromSources, deserializeGraph, serializeGraph } from "./index";

describe("resolve", () => {
  it("normalizes . and .. segments", () => {
    expect(normalizePath("src/api/../lib/x.ts")).toBe("src/lib/x.ts");
    expect(normalizePath("./a/./b")).toBe("a/b");
  });

  it("resolves relative imports against the file set, trying extensions and index", () => {
    const files = new Set(["src/a.ts", "src/lib/util.ts", "src/lib/index.ts"]);
    expect(resolveImport("src/a.ts", "./lib/util", files)).toBe("src/lib/util.ts");
    expect(resolveImport("src/a.ts", "./lib", files)).toBe("src/lib/index.ts");
    expect(resolveImport("src/a.ts", "react", files)).toBeNull(); // external
    expect(resolveImport("src/a.ts", "./missing", files)).toBeNull();
  });

  it("extracts the package name incl. scoped packages", () => {
    expect(packageOf("lodash/fp")).toBe("lodash");
    expect(packageOf("@scope/pkg/sub")).toBe("@scope/pkg");
  });
});

describe("extractImportsRegex (AST-unavailable fallback, e.g. the Worker)", () => {
  it("extracts import/require/dynamic-import specifiers, deduped and sorted", () => {
    const src = [
      "import { a } from './lib';",
      "import './side-effect';",
      "export { b } from '../shared';",
      "const c = require('pg');",
      "const d = await import('./dyn');",
      "import cp from 'child_process';",
    ].join("\n");
    expect(extractImportsRegex(src)).toEqual([
      "../shared",
      "./dyn",
      "./lib",
      "./side-effect",
      "child_process",
      "pg",
    ]);
  });

  it("does not match Python-style imports (no quotes after from)", () => {
    expect(extractImportsRegex("from os import path\nimport sys")).toEqual([]);
  });

  it("feeds buildDependencyGraph to produce real edges without an AST", () => {
    const g = buildDependencyGraph([
      {
        path: "src/a.ts",
        imports: extractImportsRegex("import { x } from './b';\nimport 'react';"),
      },
      { path: "src/b.ts", imports: [] },
    ]);
    expect(getNeighbors(g, "src/a.ts")).toContain("src/b.ts");
    expect(g.nodes.get("npm:react")?.external).toBe(true);
  });
});

describe("inferLayer", () => {
  it("maps path conventions to architectural layers", () => {
    expect(inferLayer("src/components/Button.tsx")).toBe("frontend");
    expect(inferLayer("src/api/users.ts")).toBe("api");
    expect(inferLayer("src/services/billing.ts")).toBe("service");
    expect(inferLayer("src/repositories/user-repo.ts")).toBe("repository");
    expect(inferLayer("prisma/schema.prisma")).toBe("database");
    expect(inferLayer("src/lib/helpers.ts")).toBe("unknown");
  });
});

describe("buildDependencyGraph", () => {
  const entries: FileImports[] = [
    { path: "src/components/Page.tsx", imports: ["../api/users", "react"] },
    { path: "src/api/users.ts", imports: ["../services/user-service"] },
    { path: "src/services/user-service.ts", imports: ["../repositories/user-repo"] },
    { path: "src/repositories/user-repo.ts", imports: ["pg"] },
  ];

  it("creates file→file edges for local imports and module nodes for externals", () => {
    const g = buildDependencyGraph(entries);
    expect(g.nodes.get("src/api/users.ts")?.layer).toBe("api");
    expect(g.nodes.get("npm:react")?.external).toBe(true);
    expect(g.nodes.get("npm:pg")?.external).toBe(true);
    expect(getNeighbors(g, "src/components/Page.tsx")).toContain("src/api/users.ts");
    expect(getNeighbors(g, "src/components/Page.tsx")).toContain("npm:react");
  });

  it("impactedBy returns all transitive dependents (for incremental invalidation)", () => {
    const g = buildDependencyGraph(entries);
    // Changing the repository should impact service → api → component.
    const impacted = impactedBy(g, "src/repositories/user-repo.ts").sort();
    expect(impacted).toEqual(
      ["src/api/users.ts", "src/components/Page.tsx", "src/services/user-service.ts"].sort(),
    );
    expect(getDependents(g, "src/repositories/user-repo.ts")).toEqual([
      "src/services/user-service.ts",
    ]);
  });

  it("pathBetween finds the frontend→database dependency chain", () => {
    const g = buildDependencyGraph(entries);
    const path = pathBetween(g, "src/components/Page.tsx", "src/repositories/user-repo.ts");
    expect(path).toEqual([
      "src/components/Page.tsx",
      "src/api/users.ts",
      "src/services/user-service.ts",
      "src/repositories/user-repo.ts",
    ]);
    expect(pathBetween(g, "src/repositories/user-repo.ts", "src/components/Page.tsx")).toBeNull();
  });

  it("nodesInLayer groups by architectural layer", () => {
    const g = buildDependencyGraph(entries);
    expect(nodesInLayer(g, "frontend")).toEqual(["src/components/Page.tsx"]);
  });

  it("serialize/deserialize round-trips", () => {
    const g = buildDependencyGraph(entries);
    const round = deserializeGraph(serializeGraph(g));
    expect(round.nodes.size).toBe(g.nodes.size);
    expect(round.edges).toEqual(g.edges);
  });
});

describe("buildGraphFromSources (AST-powered)", () => {
  it("extracts imports via the TS AST and links files", async () => {
    const g = await buildGraphFromSources([
      { path: "src/app.ts", content: "import { load } from './db/client';\nimport 'dotenv';\n" },
      { path: "src/db/client.ts", content: "export const load = () => 1;\n" },
    ]);
    expect(getNeighbors(g, "src/app.ts")).toContain("src/db/client.ts");
    expect(g.nodes.get("npm:dotenv")?.external).toBe(true);
  });
});
