import { describe, expect, it } from "vitest";
import {
  isAutomatedFixSupported,
  isStaticWebRepo,
  isUnsupportedStaticScan,
  UNSUPPORTED_STATIC_WEB_SCAN_PREFIX,
} from "./project-context";
import { AI_TEST_COMING_SOON_MESSAGE } from "./language-setup";
import {
  clampNodeVersion,
  javaVersionFromBuildFiles,
  frameworkToProjectLanguage,
  getToolApplicability,
  inferProjectFacts,
  isEslintFullyConfigured,
  normalizeScannerLanguage,
  projectContextToAiFiles,
  resolveProjectLanguage,
  type ProjectLanguage,
} from "./project-context.server";
import { isLanguageAiTestFix, languageUnitTestAiFix } from "./language-test-fixes";

describe("languageUnitTestAiFix", () => {
  it("maps languages to AI test fix ids", () => {
    expect(languageUnitTestAiFix("python")).toBe("pytest-ai");
    expect(languageUnitTestAiFix("go")).toBe("go-test-ai");
    expect(languageUnitTestAiFix("java")).toBe("junit-ai");
    expect(languageUnitTestAiFix("rust")).toBe("cargo-test-ai");
    expect(languageUnitTestAiFix("elixir")).toBe("exunit-ai");
    expect(frameworkToProjectLanguage("Kotlin")).toBe("kotlin");
    expect(normalizeScannerLanguage("C#")).toBe("csharp");
    expect(isLanguageAiTestFix("pytest-ai")).toBe(true);
    expect(isLanguageAiTestFix("vitest-ai")).toBe(false);
  });
});
import { buildLanguageCiWorkflow } from "./project-ci-lang.server";
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

// Confirmed against the real hagopj13/node-express-boilerplate ("node": ">=12.0.0"): naively
// extracting the first number treated a version FLOOR as an exact pin, generating a Dockerfile
// targeting node:12-bookworm-slim — an image that was never published (Node 12 predates the
// "bookworm" Debian release entirely), so the build couldn't even pull its base image.
describe("clampNodeVersion", () => {
  it("clamps an old engines.node floor up to a currently-supported version", () => {
    expect(clampNodeVersion("12")).toBe("20");
  });

  it("clamps other outdated-but-parseable majors the same way", () => {
    expect(clampNodeVersion("14")).toBe("20");
    expect(clampNodeVersion("16")).toBe("20");
  });

  it("passes through a currently-supported version unchanged", () => {
    expect(clampNodeVersion("18")).toBe("18");
    expect(clampNodeVersion("22")).toBe("22");
  });

  it("defaults to 20 when nothing was extracted", () => {
    expect(clampNodeVersion(undefined)).toBe("20");
  });
});

// Confirmed against the real spring-projects/spring-petclinic: it declares a STRICT Java 17
// Gradle toolchain (JavaLanguageVersion.of(17)) — Gradle hard-fails on a 21-only machine with
// "Cannot find a Java installation ... matching languageVersion=17", so hardcoding
// java-version: '21' in setup-java generated CI that couldn't build the project.
describe("javaVersionFromBuildFiles", () => {
  it("reads a Gradle toolchain declaration (petclinic's real shape)", () => {
    const gradle = `java {\n  toolchain {\n    languageVersion = JavaLanguageVersion.of(17)\n  }\n}`;
    expect(javaVersionFromBuildFiles(null, gradle)).toBe("17");
  });

  it("reads pom.xml's java.version property", () => {
    expect(javaVersionFromBuildFiles("<java.version>17</java.version>", null)).toBe("17");
  });

  it("reads maven-compiler-plugin's 1.x-style source declaration (java-app's real shape)", () => {
    const pom = `<plugin>\n  <artifactId>maven-compiler-plugin</artifactId>\n  <configuration>\n    <source>1.8</source>\n    <target>1.8</target>\n  </configuration>\n</plugin>`;
    expect(javaVersionFromBuildFiles(pom, null)).toBe("8");
  });

  it("reads a Kotlin DSL jvmToolchain declaration", () => {
    expect(javaVersionFromBuildFiles(null, "kotlin {\n  jvmToolchain(17)\n}")).toBe("17");
  });

  it("defaults to 21 when nothing declares a version", () => {
    expect(javaVersionFromBuildFiles(null, null)).toBe("21");
    expect(javaVersionFromBuildFiles("<project></project>", "plugins {}")).toBe("21");
  });
});

describe("resolveProjectLanguage", () => {
  it("detects Go from go.mod", () => {
    expect(resolveProjectLanguage("unknown", ["go.mod", "main.go"], false)).toEqual({
      language: "go",
      resolvedFramework: "Go",
    });
  });

  it("detects Python from pyproject.toml", () => {
    expect(resolveProjectLanguage("unknown", ["pyproject.toml", "src/app.py"], false)).toEqual({
      language: "python",
      resolvedFramework: "Python",
    });
  });

  it("keeps Node when package.json exists with real JS sources", () => {
    expect(resolveProjectLanguage("Vite", ["package.json", "src/App.jsx"], true)).toEqual({
      language: "node",
      resolvedFramework: "Vite",
    });
  });

  it("prefers Go when package.json exists but repo is Go-only", () => {
    expect(
      resolveProjectLanguage("unknown", ["package.json", "go.mod", "cmd/server/main.go"], true),
    ).toEqual({
      language: "go",
      resolvedFramework: "Go",
    });
  });
});

describe("getToolApplicability", () => {
  const pythonCtx = {
    fullName: "o/r",
    framework: "unknown",
    resolvedFramework: "Python",
    language: "python" as const,
    isNodeProject: false,
    packageManager: "npm" as const,
    filePaths: ["pyproject.toml"],
    pkg: {
      scripts: {},
      nodeVersion: "20",
      hasBackend: false,
      dependencies: {},
      devDependencies: {},
    },
    mergedDeps: {},
    stack: { frameworks: ["Python"], services: [], deployTargets: [], profile: "General Node" },
    manifests: { pyprojectToml: "[project]\nname = 'x'" },
    usesTypeScript: false,
    usesReact: false,
    hasExpress: false,
    isStaticSpa: false,
    hasNextAppRouter: false,
    hasExistingCi: false,
    hasExistingDockerfile: false,
    deployConfigs: [],
    envVars: ["DATABASE_URL"],
    intelligence: emptyIntelligence(),
  };

  it("skips vitest on Python repo", () => {
    const r = getToolApplicability("vitest", pythonCtx);
    expect(r.applicable).toBe(false);
    expect(r.reason).toMatch(/placeholder|coming soon/i);
  });

  it("allows monitoring on Python repo", () => {
    expect(getToolApplicability("monitoring", pythonCtx).applicable).toBe(true);
  });

  it("allows pytest-ai on Python repo", () => {
    expect(getToolApplicability("pytest-ai", pythonCtx).applicable).toBe(true);
    expect(getToolApplicability("vitest-ai", pythonCtx).applicable).toBe(false);
    expect(getToolApplicability("vitest-ai", pythonCtx).reason).toMatch(/JavaScript/i);
  });

  it("allows deterministic pytest on Python repo", () => {
    expect(getToolApplicability("pytest", pythonCtx).applicable).toBe(true);
  });

  it("allows helmet on Python API repo", () => {
    expect(getToolApplicability("helmet", pythonCtx).applicable).toBe(true);
    expect(getToolApplicability("cors", pythonCtx).applicable).toBe(true);
  });

  it("allows api-tests on Python repo (not Node-only)", () => {
    expect(getToolApplicability("api-tests", pythonCtx).applicable).toBe(true);
  });

  it("skips playwright-ai on API-only Python without web UI", () => {
    expect(getToolApplicability("playwright-ai", pythonCtx).applicable).toBe(false);
  });

  it("allows playwright-ai on Django with templates", () => {
    const djangoCtx = {
      ...pythonCtx,
      filePaths: ["manage.py", "app/templates/index.html", "requirements.txt"],
      resolvedFramework: "Django",
    };
    expect(getToolApplicability("playwright-ai", djangoCtx).applicable).toBe(true);
  });

  it("allows eslint fix when config exists but lint script is missing", () => {
    const nodeCtx = {
      fullName: "o/r",
      framework: "Vite",
      resolvedFramework: "Vite",
      language: "node" as const,
      isNodeProject: true,
      packageManager: "npm" as const,
      filePaths: ["package.json", "eslint.config.js", "src/main.ts"],
      pkg: {
        scripts: { build: "vite build" },
        nodeVersion: "20",
        hasBackend: false,
        dependencies: {},
        devDependencies: { eslint: "^8.57.0" },
      },
      mergedDeps: { eslint: "^8.57.0" },
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
      intelligence: emptyIntelligence(),
    };
    expect(isEslintFullyConfigured(nodeCtx)).toBe(false);
    expect(getToolApplicability("eslint", nodeCtx).applicable).toBe(true);
  });

  it("does not mistake an installed ESLint dependency for configuration", () => {
    const nodeCtx = {
      fullName: "o/r",
      framework: "Next.js",
      resolvedFramework: "Next.js",
      language: "node" as const,
      isNodeProject: true,
      packageManager: "pnpm" as const,
      filePaths: ["package.json", "app/page.tsx"],
      pkg: {
        scripts: { build: "next build", lint: "next lint" },
        nodeVersion: "20",
        hasBackend: true,
        dependencies: { next: "14" },
        devDependencies: { eslint: "8" },
      },
      mergedDeps: { next: "14", eslint: "8" },
      stack: { frameworks: ["Next.js"], services: [], deployTargets: [], profile: "Next.js" },
      manifests: {},
      usesTypeScript: true,
      usesReact: true,
      hasExpress: false,
      isStaticSpa: false,
      hasNextAppRouter: true,
      hasExistingCi: false,
      hasExistingDockerfile: false,
      deployConfigs: [],
      envVars: [],
      intelligence: emptyIntelligence(),
    };
    expect(isEslintFullyConfigured(nodeCtx)).toBe(false);
    expect(getToolApplicability("eslint", nodeCtx).applicable).toBe(true);
  });

  it("skips eslint fix when config and lint script both exist", () => {
    const nodeCtx = {
      fullName: "o/r",
      framework: "Vite",
      resolvedFramework: "Vite",
      language: "node" as const,
      isNodeProject: true,
      packageManager: "npm" as const,
      filePaths: ["package.json", "eslint.config.js"],
      pkg: {
        scripts: { build: "vite build", lint: "eslint ." },
        nodeVersion: "20",
        hasBackend: false,
        dependencies: {},
        devDependencies: { eslint: "^8.57.0" },
      },
      mergedDeps: { eslint: "^8.57.0" },
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
      intelligence: emptyIntelligence(),
    };
    expect(isEslintFullyConfigured(nodeCtx)).toBe(true);
    const r = getToolApplicability("eslint", nodeCtx);
    expect(r.applicable).toBe(false);
    expect(r.reason).toMatch(/already configured/i);
  });
});

describe("buildLanguageCiWorkflow", () => {
  it("generates Go CI with vet and test", () => {
    const wf = buildLanguageCiWorkflow({
      fullName: "o/r",
      framework: "Go",
      resolvedFramework: "Go",
      language: "go",
      isNodeProject: false,
      packageManager: "npm",
      filePaths: ["go.mod", "main_test.go"],
      pkg: {
        scripts: {},
        nodeVersion: "20",
        hasBackend: true,
        dependencies: {},
        devDependencies: {},
      },
      mergedDeps: {},
      stack: { frameworks: ["Go"], services: [], deployTargets: [], profile: "General Node" },
      manifests: { goMod: "module example.com/app\ngo 1.22" },
      intelligence: emptyIntelligence(),
      envVars: [],
      ...inferProjectFacts("go", "Go", pythonPkg(), ["go.mod"]),
    });
    expect(wf).toContain("actions/setup-go@v5");
    expect(wf).toContain("go test");
    expect(wf).not.toContain("continue-on-error");
  });

  // Confirmed against the real dwyl/phoenix-chat-example: `mix test` on a Phoenix+Ecto app
  // creates a test database first — generated CI without a postgres service fails on a real
  // runner ("The database for Chat.Repo couldn't be created"). Same repo also proved
  // --warnings-as-errors fails healthy real apps on their own pre-existing warnings.
  it("generates Elixir CI with a postgres service for Ecto apps, without --warnings-as-errors", () => {
    const wf = buildLanguageCiWorkflow({
      fullName: "o/r",
      framework: "Elixir",
      resolvedFramework: "Elixir",
      language: "elixir",
      isNodeProject: false,
      packageManager: "npm",
      filePaths: ["mix.exs", "test/chat_test.exs"],
      pkg: {
        scripts: {},
        nodeVersion: "20",
        hasBackend: true,
        dependencies: {},
        devDependencies: {},
      },
      mergedDeps: {},
      stack: { frameworks: ["Elixir"], services: [], deployTargets: [], profile: "General Node" },
      manifests: {
        mixExs:
          'defp deps do\n  [{:phoenix, "~> 1.8"}, {:ecto_sql, "~> 3.6"}, {:postgrex, ">= 0.0.0"}]\nend',
      },
      intelligence: emptyIntelligence(),
      envVars: [],
      ...inferProjectFacts("elixir", "Elixir", pythonPkg(), ["mix.exs"]),
    });
    expect(wf).toContain("image: postgres:16");
    expect(wf).toContain("mix test");
    expect(wf).not.toContain("--warnings-as-errors");
  });
});

describe("inferProjectFacts — hasNextAppRouter", () => {
  // Next.js officially supports both app/ at the repo root and src/app/ — a project using the
  // src/ convention (offered as a create-next-app prompt) was previously invisible to this
  // check, silently blocking error-boundary eligibility and (in fix-executor.server.ts) causing
  // the Sentry instrumentation.ts / error.tsx files to land in the wrong location for Next.js to
  // ever discover them.
  it("detects the App Router at the repo root", () => {
    const facts = inferProjectFacts("node", "Next.js", pythonPkg(), [
      "app/layout.tsx",
      "app/page.tsx",
    ]);
    expect(facts.hasNextAppRouter).toBe(true);
  });

  it("detects the App Router under src/", () => {
    const facts = inferProjectFacts("node", "Next.js", pythonPkg(), [
      "src/app/layout.tsx",
      "src/app/page.tsx",
    ]);
    expect(facts.hasNextAppRouter).toBe(true);
  });

  it("does not false-positive on unrelated src/appConfig.ts", () => {
    const facts = inferProjectFacts("node", "Next.js", pythonPkg(), [
      "pages/index.tsx",
      "src/appConfig.ts",
    ]);
    expect(facts.hasNextAppRouter).toBe(false);
  });
});

function pythonPkg() {
  return {
    scripts: {},
    nodeVersion: "20",
    hasBackend: false,
    dependencies: {},
    devDependencies: {},
  };
}

describe("projectContextToAiFiles", () => {
  it("includes language and intelligence for AI", () => {
    const files = projectContextToAiFiles({
      fullName: "o/r",
      framework: "unknown",
      resolvedFramework: "Rust",
      language: "rust",
      isNodeProject: false,
      packageManager: "npm",
      filePaths: ["Cargo.toml", "src/main.rs"],
      pkg: pythonPkg(),
      mergedDeps: {},
      stack: { frameworks: ["Rust"], services: [], deployTargets: [], profile: "General Node" },
      manifests: { cargoToml: '[package]\nname = "app"' },
      ...inferProjectFacts("rust", "Rust", pythonPkg(), ["Cargo.toml"]),
      envVars: ["RUST_LOG"],
      intelligence: emptyIntelligence({
        envContract: {
          build: [],
          test: ["RUST_LOG"],
          runtime: [],
          all: ["RUST_LOG"],
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
      }),
    });
    expect(files["__language"]).toBe("rust");
    expect(files["Cargo.toml"]).toContain("app");
    expect(files.detected_env_vars).toBe("RUST_LOG");
  });

  // mix.exs was fetched into manifests but never threaded into the AI files (exunit-ai's
  // prompt couldn't see the app name); pubspec.yaml/Package.swift carry the only authoritative
  // package/target names for dart-test-ai `package:` imports and swift-test-ai
  // `@testable import` — confirmed against real repos (dwyl/phoenix-chat-example,
  // SwiftPackageIndex-Server) with real generations.
  it("threads mix.exs, pubspec.yaml, and Package.swift through to the AI files", () => {
    const files = projectContextToAiFiles({
      fullName: "o/r",
      framework: "unknown",
      resolvedFramework: "Phoenix",
      language: "elixir",
      isNodeProject: false,
      packageManager: "npm",
      filePaths: ["mix.exs", "lib/app.ex"],
      pkg: pythonPkg(),
      mergedDeps: {},
      stack: { frameworks: ["Phoenix"], services: [], deployTargets: [], profile: "General" },
      manifests: {
        mixExs: "defmodule Chat.MixProject do\n  def project, do: [app: :chat]\nend",
        pubspecYaml: "name: inkino\ndescription: app",
        packageSwift: 'let package = Package(name: "SPI-Server")',
      },
      ...inferProjectFacts("elixir", "Phoenix", pythonPkg(), ["mix.exs"]),
      envVars: [],
      intelligence: emptyIntelligence(),
    });
    expect(files["mix.exs"]).toContain("app: :chat");
    expect(files["pubspec.yaml"]).toContain("name: inkino");
    expect(files["Package.swift"]).toContain("SPI-Server");
  });
});

describe("isStaticWebRepo", () => {
  it("detects plain HTML sites", () => {
    expect(isStaticWebRepo(["index.html", "styles.css", "app.js"])).toBe(true);
  });

  it("rejects Node projects", () => {
    expect(isStaticWebRepo(["package.json", "index.html"])).toBe(false);
  });
});

describe("isUnsupportedStaticScan", () => {
  it("detects unsupported static scan warnings", () => {
    expect(isUnsupportedStaticScan([`${UNSUPPORTED_STATIC_WEB_SCAN_PREFIX} message`])).toBe(true);
    expect(isUnsupportedStaticScan(["other warning"])).toBe(false);
  });
});

describe("isAutomatedFixSupported", () => {
  it("supports Python repos with manifests", () => {
    expect(isAutomatedFixSupported(["requirements.txt", "main.py"])).toBe(true);
  });

  it("rejects static HTML", () => {
    expect(isAutomatedFixSupported(["index.html"])).toBe(true);
  });
});

describe("AI_TEST_COMING_SOON_MESSAGE", () => {
  it("guides wrong-stack selection", () => {
    expect(AI_TEST_COMING_SOON_MESSAGE).toMatch(/JavaScript/i);
  });
});
