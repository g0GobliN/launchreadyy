import { describe, expect, it } from "vitest";
import { runFixPreflight, preflightBlockMessage } from "./fix-preflight.server";
import type { ProjectContext } from "./project-context.server";
import type { ProjectIntelligence } from "./project-intelligence.server";

const emptyIntelligence = (overrides?: Partial<ProjectIntelligence>): ProjectIntelligence => ({
  monorepo: false,
  packages: [],
  envContract: { build: [], test: [], runtime: [], all: [], refs: [] },
  integrations: {
    stripe: false,
    firebase: false,
    supabase: false,
    prisma: false,
    auth: false,
    hasWebhooks: false,
    signals: [],
  },
  structure: { entryPoints: [], routePaths: [], apiPaths: [], componentPaths: [] },
  codeSamples: [],
  runtimeModel: "unknown",
  ...overrides,
});

function nodeCtx(overrides?: Partial<ProjectContext>): ProjectContext {
  return {
    fullName: "o/r",
    framework: "Vite",
    resolvedFramework: "Vite",
    language: "node",
    isNodeProject: true,
    packageManager: "npm",
    filePaths: ["package.json", "capture-ui/vite.config.js", "capture-ui/package.json"],
    pkg: {
      scripts: { build: "vite build" },
      nodeVersion: "20",
      hasBackend: false,
      dependencies: {},
      devDependencies: {},
    },
    mergedDeps: { vite: "^6.0.0", vitest: "^3.0.0" },
    stack: { frameworks: ["Vite"], services: [], deployTargets: [], profile: "Vite SPA" },
    manifests: {},
    usesTypeScript: true,
    usesReact: true,
    hasExpress: false,
    isStaticSpa: true,
    hasNextAppRouter: false,
    hasExistingCi: false,
    hasExistingDockerfile: false,
    deployConfigs: [],
    envVars: [],
    intelligence: emptyIntelligence({
      monorepo: true,
      packages: [
        {
          dir: "capture-ui",
          name: "capture-ui",
          kind: "frontend",
          scripts: { build: "vite build", test: "vitest run" },
          dependencies: {},
          devDependencies: { vite: "^6.0.0", vitest: "^3.0.0" },
          hasLint: false,
          hasTest: true,
          hasBuild: true,
        },
      ],
      runtimeModel: "monorepo",
    }),
    ...overrides,
  };
}

describe("runFixPreflight", () => {
  it("passes when vite package has type module", () => {
    const result = runFixPreflight({
      files: [
        {
          path: "capture-ui/package.json",
          content: '{\n  "name": "capture-ui",\n  "type": "module",\n  "scripts": {}\n}\n',
        },
      ],
      ctx: nodeCtx(),
      fixIds: ["ci-ai"],
      repoFilePaths: ["capture-ui/vite.config.js", "capture-ui/package.json"],
    });
    expect(result.passed).toBe(true);
  });

  it("blocks CI when vite.config.js lacks type module patch", () => {
    const result = runFixPreflight({
      files: [
        {
          path: "package.json",
          content: '{\n  "name": "root",\n  "scripts": { "lint": "eslint ." }\n}\n',
        },
      ],
      ctx: nodeCtx(),
      fixIds: ["ci-ai", "eslint"],
      repoFilePaths: ["capture-ui/vite.config.js", "capture-ui/package.json"],
    });
    expect(result.passed).toBe(false);
    expect(result.blockers.some((b) => b.code === "vite-esm")).toBe(true);
    expect(preflightBlockMessage(result)).toMatch(/Preflight failed/);
  });

  it("blocks invalid package.json", () => {
    const result = runFixPreflight({
      files: [{ path: "package.json", content: "{ not json" }],
      ctx: nodeCtx(),
      fixIds: ["eslint"],
      repoFilePaths: ["package.json"],
    });
    expect(result.passed).toBe(false);
    expect(result.blockers[0]?.code).toBe("invalid-package-json");
  });

  describe("apps that do not live at the repository root", () => {
    // The executor writes generated files beneath ctx.appDir. Preflight verifies the result
    // rather than trusting it — a handler that bypasses `add()` would otherwise commit a
    // Dockerfile to a root with no app in it.
    const subdirFiles = [
      "README.md",
      "backend/requirements.txt",
      "backend/app/main.py",
      "frontend/package.json",
    ];
    const subdirCtx = () => nodeCtx({ appDir: "backend", filePaths: subdirFiles });

    it("passes when the generated file landed under the app directory", () => {
      const result = runFixPreflight({
        files: [{ path: "backend/Dockerfile", content: "FROM python:3.12-slim\n" }],
        ctx: subdirCtx(),
        fixIds: ["dockerfile"],
        repoFilePaths: subdirFiles,
      });
      expect(result.blockers.some((b) => b.code === "generated-file-outside-app-dir")).toBe(false);
    });

    it("blocks a build file left at the repository root", () => {
      const result = runFixPreflight({
        files: [{ path: "Dockerfile", content: "FROM python:3.12-slim\n" }],
        ctx: subdirCtx(),
        fixIds: ["dockerfile"],
        repoFilePaths: subdirFiles,
      });
      expect(result.passed).toBe(false);
      expect(result.blockers.some((b) => b.code === "generated-file-outside-app-dir")).toBe(true);
      expect(preflightBlockMessage(result)).toContain("backend");
    });

    it("allows CI workflows at the root, where GitHub requires them", () => {
      const result = runFixPreflight({
        files: [{ path: ".github/workflows/ci.yml", content: "name: CI\n" }],
        ctx: subdirCtx(),
        fixIds: ["github-actions"],
        repoFilePaths: subdirFiles,
      });
      expect(result.blockers.some((b) => b.code === "generated-file-outside-app-dir")).toBe(false);
    });

    it("allows an in-place patch of an existing file elsewhere in the repo", () => {
      const result = runFixPreflight({
        files: [{ path: "backend/app/main.py", content: "# patched\n" }],
        ctx: subdirCtx(),
        fixIds: ["health-check"],
        repoFilePaths: subdirFiles,
      });
      expect(result.blockers.some((b) => b.code === "generated-file-outside-app-dir")).toBe(false);
    });

    it("does not fire when the app is at the repository root", () => {
      const result = runFixPreflight({
        files: [{ path: "Dockerfile", content: "FROM node:20-alpine\n" }],
        ctx: nodeCtx({ appDir: null }),
        fixIds: ["dockerfile"],
        repoFilePaths: ["package.json", "src/index.ts"],
      });
      expect(result.blockers.some((b) => b.code === "generated-file-outside-app-dir")).toBe(false);
    });
  });
});
