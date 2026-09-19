import { describe, expect, it } from "vitest";
import {
  buildDeterministicCiWorkflow,
  sanitizeCiWorkflow,
  assertCiWorkflowStrict,
  finalizeCiWorkflow,
} from "./ci-ai.server";

describe("sanitizeCiWorkflow", () => {
  it("removes continue-on-error lines", () => {
    const raw = `jobs:
  quality:
    steps:
      - run: npm run lint
        continue-on-error: true
`;
    expect(sanitizeCiWorkflow(raw)).not.toContain("continue-on-error");
  });
});

describe("buildDeterministicCiWorkflow", () => {
  it("vite JS: production multi-job CI with security", () => {
    const wf = buildDeterministicCiWorkflow(
      {
        "package.json": JSON.stringify({
          scripts: { build: "vite build" },
          devDependencies: { vite: "7" },
        }),
        __file_paths: "src/App.jsx\nsrc/main.jsx\nvite.config.js",
        __package_manager: "npm",
        __is_static_spa: "true",
        detected_env_vars: "VITE_API_URL",
      },
      { framework: "Vite" },
    );
    expect(wf).toContain("quality:");
    expect(wf).toContain("secret-scan:");
    expect(wf).toContain("security-audit:");
    expect(wf).not.toContain("continue-on-error");
  });

  it("monorepo: uses working-directory from serialized packages", () => {
    const wf = buildDeterministicCiWorkflow(
      {
        "package.json": JSON.stringify({ name: "root", private: true }),
        __file_paths: "apps/web/package.json\napps/api/package.json",
        __package_manager: "pnpm",
        __monorepo: "true",
        __ci_packages: JSON.stringify([
          {
            dir: "apps/web",
            name: "web",
            kind: "frontend",
            scripts: { build: "vite build", test: "vitest" },
            dependencies: {},
            devDependencies: { vite: "7" },
            hasLint: false,
            hasTest: true,
            hasBuild: true,
            lockfile: "pnpm-lock.yaml",
          },
          {
            dir: "apps/api",
            name: "api",
            kind: "backend",
            scripts: { test: "vitest" },
            dependencies: { express: "4" },
            devDependencies: {},
            hasLint: false,
            hasTest: true,
            hasBuild: false,
            lockfile: "pnpm-lock.yaml",
          },
        ]),
      },
      { framework: "unknown", fixIds: ["ci-ai"] },
    );
    expect(wf).toContain("working-directory: apps/web");
    expect(wf).toContain("working-directory: apps/api");
  });
});

describe("finalizeCiWorkflow", () => {
  it("sanitizes AI output before accept", () => {
    const out = finalizeCiWorkflow(
      "name: CI\njobs:\n  x:\n    steps:\n      - run: npm test\n        continue-on-error: true\n",
    );
    expect(out).not.toContain("continue-on-error");
    expect(() => assertCiWorkflowStrict(out)).not.toThrow();
  });
});
