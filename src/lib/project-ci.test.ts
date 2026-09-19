import { describe, expect, it } from "vitest";
import {
  analyzeProjectCi,
  buildProjectCiWorkflow,
  ciDummyEnvValue,
  expandFixIdsForProductionCi,
  isRealTestScript,
  pendingScriptsFromFixIds,
  projectUsesTypeScript,
} from "./project-ci.server";
import type { ProjectIntelligence } from "./project-intelligence.server";
import { parse as parseYaml } from "yaml";

describe("projectUsesTypeScript", () => {
  it("false for JS-only vite app", () => {
    expect(
      projectUsesTypeScript(
        { scripts: {}, dependencies: {}, devDependencies: { vite: "7" }, nodeVersion: "20" },
        ["src/App.jsx", "src/main.jsx"],
      ),
    ).toBe(false);
  });
});

describe("analyzeProjectCi production baseline", () => {
  it("gives Next.js builds the full discovered server and public environment contract", () => {
    const profile = analyzeProjectCi({
      pkg: {
        scripts: { build: "next build" },
        dependencies: { next: "14" },
        devDependencies: {},
        nodeVersion: "20",
      },
      framework: "Next.js",
      filePaths: ["app/page.tsx", "app/api/webhooks/route.ts"],
      packageManager: "pnpm",
      productionBaseline: true,
      envContract: {
        build: ["NEXT_PUBLIC_SUPABASE_URL"],
        test: ["SUPABASE_SERVICE_ROLE_KEY"],
        runtime: ["DATABASE_URL"],
        all: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"],
        refs: [],
      },
    });
    expect(profile.buildEnvVars).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "DATABASE_URL",
    ]);
  });

  it("vite repo gets lint test build with baseline", () => {
    const profile = analyzeProjectCi({
      pkg: {
        scripts: { build: "vite build" },
        dependencies: {},
        devDependencies: { vite: "7" },
        nodeVersion: "20",
      },
      framework: "Vite",
      filePaths: ["src/App.jsx", "vite.config.js"],
      packageManager: "npm",
      productionBaseline: true,
      envVars: ["VITE_API_URL"],
      isStaticSpa: true,
    });
    expect(profile.steps).toContain("lint");
    expect(profile.steps).toContain("test");
    expect(profile.steps).toContain("build");
    expect(profile.buildEnvVars).toContain("VITE_API_URL");
  });
});

describe("expandFixIdsForProductionCi", () => {
  it("does not bundle eslint/vitest when bundlePrerequisites is false", () => {
    const { fixIds, bundled } = expandFixIdsForProductionCi(["ci-ai"], {
      isNodeProject: true,
      scripts: { build: "vite build" },
      bundlePrerequisites: false,
    });
    expect(fixIds).toEqual(["ci-ai"]);
    expect(bundled).toEqual([]);
  });

  it("bundles eslint and vitest-ai by default when ci-ai requested", () => {
    const { fixIds, bundled } = expandFixIdsForProductionCi(["ci-ai"], {
      isNodeProject: true,
      scripts: { build: "vite build" },
    });
    expect(fixIds).toContain("eslint");
    expect(fixIds).toContain("vitest-ai");
    expect(bundled).toEqual(["eslint", "vitest-ai"]);
  });

  it("bundles eslint when a lint script exists but ESLint is not configured", () => {
    const { fixIds, bundled } = expandFixIdsForProductionCi(["github-actions"], {
      isNodeProject: true,
      scripts: { lint: "next lint", build: "next build" },
      eslintConfigured: false,
    });
    expect(fixIds).toContain("eslint");
    expect(bundled).toContain("eslint");
  });

  it("bundles eslint and vitest-ai when explicitly requested", () => {
    const { fixIds, bundled } = expandFixIdsForProductionCi(["ci-ai"], {
      isNodeProject: true,
      scripts: { build: "vite build" },
      bundlePrerequisites: true,
    });
    expect(fixIds).toContain("eslint");
    expect(fixIds).toContain("vitest-ai");
    expect(fixIds.indexOf("eslint")).toBeLessThan(fixIds.indexOf("ci-ai"));
    expect(bundled).toEqual(["eslint", "vitest-ai"]);
  });
});

describe("buildProjectCiWorkflow production", () => {
  it("pins pnpm 9 by default and preserves an explicit repository version", () => {
    const base = {
      nodeVersion: "20",
      framework: "Express",
      packageManager: "pnpm" as const,
      steps: ["lint" as const],
      summary: "pnpm CI",
      productionBaseline: true,
    };

    expect(buildProjectCiWorkflow(base)).toContain("version: 9");
    expect(buildProjectCiWorkflow({ ...base, pnpmVersion: "10.17.1" })).toContain(
      "version: 10.17.1",
    );
  });

  it("emits multi-job pipeline with security gates", () => {
    const profile = analyzeProjectCi({
      pkg: {
        scripts: { build: "vite build", lint: "eslint .", test: "vitest run" },
        dependencies: {},
        devDependencies: { vite: "7" },
        nodeVersion: "20",
      },
      framework: "Vite",
      filePaths: ["src/App.jsx"],
      packageManager: "npm",
      productionBaseline: true,
      isStaticSpa: true,
      envContract: {
        build: ["VITE_API_URL"],
        test: [],
        runtime: [],
        all: ["VITE_API_URL"],
        refs: [],
      },
    });
    const intel: ProjectIntelligence = {
      monorepo: false,
      packages: [],
      envContract: {
        build: ["VITE_API_URL"],
        test: [],
        runtime: [],
        all: ["VITE_API_URL"],
        refs: [],
      },
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
      runtimeModel: "static-spa",
    };
    const yaml = buildProjectCiWorkflow(profile, intel);
    expect(yaml).toContain("quality:");
    expect(yaml).toContain("test:");
    expect(yaml).toContain("build:");
    expect(yaml).toContain("security-audit:");
    expect(yaml).toContain("secret-scan:");
    expect(yaml).toContain("VITE_API_URL: http://localhost:8080");
    expect(yaml).toContain("Verify static build output");
    expect(yaml).not.toContain("continue-on-error");
  });
});

describe("ciDummyEnvValue", () => {
  it("uses safe Stripe dummy keys", () => {
    expect(ciDummyEnvValue("STRIPE_SECRET_KEY")).toBe("sk_test_dummy");
    expect(ciDummyEnvValue("STRIPE_WEBHOOK_SECRET")).toBe("whsec_dummy_ci");
  });

  it("uses valid URLs for public build-time URL variables", () => {
    expect(ciDummyEnvValue("NEXT_PUBLIC_SUPABASE_URL")).toBe("http://localhost:8080");
    expect(ciDummyEnvValue("VITE_API_URL")).toBe("http://localhost:8080");
  });
});

describe("isRealTestScript", () => {
  it("rejects placeholder", () => {
    expect(isRealTestScript('echo "Error: no test specified" && exit 1')).toBe(false);
  });
});

describe("pendingScriptsFromFixIds", () => {
  it("ci fix enables full production gates", () => {
    expect(pendingScriptsFromFixIds(["ci-ai"])).toMatchObject({
      lint: true,
      test: true,
      typecheck: true,
    });
  });
});

describe("buildProjectCiWorkflow monorepo", () => {
  it("generates per-package jobs like company CI", () => {
    const yaml = buildProjectCiWorkflow(
      {
        nodeVersion: "20",
        framework: "unknown",
        packageManager: "npm",
        steps: ["lint", "test", "build"],
        summary: "monorepo",
        productionBaseline: true,
      },
      {
        monorepo: true,
        packages: [
          {
            dir: "capture-ui",
            name: "capture-ui",
            kind: "frontend",
            scripts: { build: "vite build", lint: "eslint ." },
            dependencies: {},
            devDependencies: { vite: "7" },
            hasLint: true,
            hasTest: false,
            hasBuild: true,
            lockfile: "package-lock.json",
          },
          {
            dir: "admin-backend",
            name: "admin-backend",
            kind: "backend",
            scripts: { test: "vitest" },
            dependencies: { express: "4" },
            devDependencies: {},
            hasLint: false,
            hasTest: true,
            hasBuild: false,
            lockfile: "package-lock.json",
          },
        ],
        envContract: {
          build: ["VITE_API_URL"],
          test: ["STRIPE_SECRET_KEY"],
          runtime: [],
          all: [],
          refs: [],
        },
        integrations: {
          stripe: true,
          firebase: false,
          supabase: false,
          prisma: false,
          auth: false,
          hasWebhooks: false,
          signals: [],
        },
        structure: { entryPoints: [], routePaths: [], apiPaths: [], componentPaths: [] },
        codeSamples: [],
        runtimeModel: "monorepo",
      },
    );
    expect(yaml).toContain("working-directory: capture-ui");
    expect(yaml).toContain("admin-backend");
    expect(yaml).toContain("secret-scan:");
  });
});

describe("generated workflow is valid YAML", () => {
  /**
   * The generator emitted a job-level `env:` at 8 spaces with its variables at the same 8,
   * producing "mapping values are not allowed here". GitHub rejected the workflow at startup —
   * 0 jobs, no logs — so every CI fix for a repo needing test/build env vars shipped a file
   * Actions could not load. Every prior test asserted on substrings, so none of them parsed the
   * output and none of them caught it. These parse.
   */
  const withEnv = () =>
    buildProjectCiWorkflow(
      analyzeProjectCi({
        pkg: {
          scripts: { build: "vite build", test: "vitest run", lint: "eslint ." },
          dependencies: {},
          devDependencies: { vite: "7", vitest: "3" },
          nodeVersion: "20",
        },
        framework: "Vite",
        filePaths: ["package.json", "src/main.ts"],
        packageManager: "npm",
        envVars: ["NODE_ENV", "VITE_API_URL"],
      }),
    );

  it("parses when the test and build jobs carry env vars", () => {
    const yaml = withEnv();
    expect(() => parseYaml(yaml)).not.toThrow();
  });

  it("nests job-level env vars under env:, not beside it", () => {
    const doc = parseYaml(withEnv()) as {
      jobs: Record<string, { env?: Record<string, string> }>;
    };
    const jobsWithEnv = Object.values(doc.jobs).filter((j) => j.env);
    expect(jobsWithEnv.length).toBeGreaterThan(0);
    for (const job of jobsWithEnv) {
      expect(typeof job.env).toBe("object");
      expect(Object.keys(job.env!).length).toBeGreaterThan(0);
    }
  });

  it("still parses with no env vars at all", () => {
    const yaml = buildProjectCiWorkflow(
      analyzeProjectCi({
        pkg: {
          scripts: { build: "vite build" },
          dependencies: {},
          devDependencies: { vite: "7" },
          nodeVersion: "20",
        },
        framework: "Vite",
        filePaths: ["package.json"],
        packageManager: "npm",
      }),
    );
    expect(() => parseYaml(yaml)).not.toThrow();
  });
});

describe("generated workflow is Prettier-clean", () => {
  /**
   * A repo whose lint script is `prettier --check .` fails CI on any file that is not
   * Prettier-formatted — including the workflow this generator just installed. Observed on a
   * real PR: the added ci.yml was the *only* file Prettier flagged, so the fix broke the very
   * check it was adding. Prettier's default (and the usual repo config) is double quotes, and
   * it wants exactly one trailing newline.
   */
  const wf = () =>
    buildProjectCiWorkflow(
      analyzeProjectCi({
        pkg: {
          scripts: { build: "vite build", test: "vitest run", lint: "eslint ." },
          dependencies: {},
          devDependencies: { vite: "7", vitest: "3" },
          nodeVersion: "20",
        },
        framework: "Vite",
        filePaths: ["package.json"],
        packageManager: "npm",
        envVars: ["NODE_ENV"],
      }),
    );

  it("quotes node-version with double quotes", () => {
    expect(wf()).toContain('node-version: "20"');
    expect(wf()).not.toContain("node-version: '20'");
  });

  it("ends with exactly one trailing newline", () => {
    const out = wf();
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
