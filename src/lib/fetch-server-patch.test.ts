import { describe, expect, it } from "vitest";
import {
  buildRequestPipelineContent,
  isFetchBasedServer,
  isTanStackStart,
  patchFetchServerFile,
} from "./fetch-server-patch.server";
import type { ProjectContext } from "./project-context.server";

const baseCtx = (overrides: Partial<ProjectContext>): ProjectContext =>
  ({
    fullName: "o/r",
    framework: "TanStack",
    resolvedFramework: "TanStack",
    language: "node",
    isNodeProject: true,
    packageManager: "npm",
    filePaths: ["src/server.ts", "app.config.ts", "package.json"],
    pkg: {
      scripts: { dev: "vite dev" },
      nodeVersion: "20",
      hasBackend: true,
      dependencies: { "@tanstack/react-start": "^1.0.0" },
      devDependencies: {},
    },
    mergedDeps: { "@tanstack/react-start": "^1.0.0" },
    stack: { frameworks: ["TanStack"], services: [], deployTargets: [], profile: "TanStack" },
    manifests: {},
    usesTypeScript: true,
    usesReact: true,
    hasExpress: false,
    isStaticSpa: false,
    hasNextAppRouter: false,
    hasExistingCi: false,
    hasExistingDockerfile: false,
    deployConfigs: [],
    envVars: [],
    intelligence: {
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
      runtimeModel: "fetch",
    },
    ...overrides,
  }) as ProjectContext;

describe("fetch-server-patch", () => {
  it("detects TanStack Start repos", () => {
    expect(isTanStackStart(baseCtx({}))).toBe(true);
    expect(isFetchBasedServer(baseCtx({}))).toBe(true);
    expect(isFetchBasedServer(baseCtx({ hasExpress: true }))).toBe(false);
  });

  it("builds pipeline with selected middleware only", () => {
    const content = buildRequestPipelineContent(["cors", "helmet"]);
    expect(content).toContain("handleCorsPreflight");
    expect(content).toContain("withSecurityHeaders");
    expect(content).not.toContain("checkRateLimit");
  });

  it("patches TanStack server.ts to wrap runWithCfContext", () => {
    const server = `import "./lib/error-capture";

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const { runWithCfContext } = await import("./lib/cf-context.server");
    const cfCtx = ctx as { waitUntil: (p: Promise<unknown>) => void };
    return runWithCfContext({ waitUntil: cfCtx.waitUntil.bind(cfCtx) }, async () => {
      return new Response("ok");
    }); // end runWithCfContext
  },
};
`;
    const patched = patchFetchServerFile(server);
    expect(patched).toContain('import { runRequestPipeline } from "./lib/request-pipeline"');
    expect(patched).toContain("return runRequestPipeline(request, async () => runWithCfContext(");
    expect(patched).toContain("})); // end runWithCfContext");
  });
});
