import { describe, it, expect } from "vitest";

import { findAppRoots, isWorkspaceRoot, decideAppRoot } from "./app-root";

describe("findAppRoots", () => {
  it("returns nothing when the repo has no manifest", () => {
    expect(findAppRoots(["README.md", "docs/start.md"])).toEqual([]);
  });

  it("finds the repo root when the manifest is at the root", () => {
    const roots = findAppRoots(["package.json", "src/index.ts"]);
    expect(roots[0]?.dir).toBe(".");
    expect(roots[0]?.language).toBe("node");
  });

  it("ignores manifests inside node_modules and vendor trees", () => {
    const roots = findAppRoots([
      "node_modules/left-pad/package.json",
      "vendor/bundle/Gemfile",
      "apps/web/package.json",
    ]);
    expect(roots.map((r) => r.dir)).toEqual(["apps/web"]);
  });

  it("ignores manifests in test, example and fixture directories", () => {
    const roots = findAppRoots([
      "examples/demo/package.json",
      "tests/fixtures/go.mod",
      "backend/requirements.txt",
    ]);
    expect(roots.map((r) => r.dir)).toEqual(["backend"]);
  });

  it("does not exclude a workspace member that happens to be named docs", () => {
    // Turborepo's own starter ships apps/docs as a deployable Next.js app.
    const roots = findAppRoots(["apps/docs/package.json", "apps/docs/app/page.tsx"]);
    expect(roots.map((r) => r.dir)).toEqual(["apps/docs"]);
  });

  it("still excludes a top-level docs directory", () => {
    expect(findAppRoots(["docs/package.json"])).toEqual([]);
  });

  it("ranks a backend above a frontend in the same monorepo", () => {
    // Readiness and security are overwhelmingly properties of the server, so a repo with
    // both should be audited as the API rather than the web client.
    const roots = findAppRoots([
      "apps/web/package.json",
      "apps/web/src/main.jsx",
      "apps/web/vite.config.js",
      "apps/api/package.json",
      "apps/api/src/server.ts",
    ]);
    expect(roots[0]?.dir).toBe("apps/api");
  });

  it("ranks a non-Node service above a bare package.json library", () => {
    const roots = findAppRoots([
      "packages/ui/package.json",
      "services/api/go.mod",
      "services/api/main.go",
    ]);
    expect(roots[0]?.dir).toBe("services/api");
    expect(roots[0]?.language).toBe("go");
  });

  it("does not let file count override the backend preference", () => {
    const files = ["apps/api/go.mod", "apps/api/main.go"];
    for (let i = 0; i < 50; i++) files.push(`apps/web/src/c${i}.tsx`);
    files.push("apps/web/package.json");
    expect(findAppRoots(files)[0]?.dir).toBe("apps/api");
  });

  it("ignores manifests buried deeper than the depth limit", () => {
    expect(findAppRoots(["a/b/c/d/e/package.json"], 3)).toEqual([]);
  });

  it("recognises a .csproj directory as a C# app root", () => {
    const roots = findAppRoots(["src/Api/Api.csproj", "src/Api/Program.cs"]);
    expect(roots[0]?.dir).toBe("src/Api");
    expect(roots[0]?.language).toBe("csharp");
  });
});

describe("isWorkspaceRoot", () => {
  it("detects npm workspaces", () => {
    expect(isWorkspaceRoot(["package.json"], '{"workspaces":["apps/*"]}')).toBe(true);
  });

  it("detects the object form of workspaces", () => {
    expect(isWorkspaceRoot(["package.json"], '{"workspaces":{"packages":["apps/*"]}}')).toBe(true);
  });

  it("detects pnpm, turbo, nx and lerna markers", () => {
    for (const marker of ["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json"]) {
      expect(isWorkspaceRoot([marker], null)).toBe(true);
    }
  });

  it("is false for an ordinary single-app repo", () => {
    expect(isWorkspaceRoot(["package.json"], '{"name":"app","dependencies":{"next":"14"}}')).toBe(
      false,
    );
  });

  it("is false for an empty workspaces array", () => {
    expect(isWorkspaceRoot(["package.json"], '{"workspaces":[]}')).toBe(false);
  });

  it("does not throw on malformed package.json", () => {
    expect(isWorkspaceRoot(["package.json"], "{not json")).toBe(false);
  });
});

describe("decideAppRoot", () => {
  it("returns no app dir when the root is the only candidate", () => {
    // The caller scans the root as before; rebasing onto "." would be a no-op.
    expect(decideAppRoot(["package.json", "src/index.ts"]).appDir).toBeNull();
  });

  it("returns no app dir for a repo with nothing in it", () => {
    expect(decideAppRoot(["README.md"]).appDir).toBeNull();
  });

  it("picks the primary app and reports the others", () => {
    const decision = decideAppRoot([
      "backend/requirements.txt",
      "backend/app/main.py",
      "frontend/package.json",
      "frontend/src/main.jsx",
    ]);
    expect(decision.appDir).toBe("backend");
    expect(decision.language).toBe("python");
    expect(decision.others).toContain("frontend");
  });
});
