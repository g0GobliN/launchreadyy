/**
 * Canonical fix-tool registry + repo fixtures for matrix tests.
 * Single source for language-scoped lint / AI-test gates.
 */

import type { ProjectContext, ProjectLanguage } from "./project-context.server";
import type { ProjectIntelligence } from "./project-intelligence.server";
import { isLanguageAiTestFix, languageUnitTestAiFix } from "./language-test-fixes";
import { isPlaywrightAiApplicable } from "./platform-testing";

/** Every fix id the product can offer (templates + language linters + AI tests). */
export const ALL_FIX_TOOL_IDS = [
  "eslint",
  "prettier",
  "vitest",
  "vitest-ai",
  "playwright",
  "playwright-ai",
  "github-actions",
  "ci-ai",
  "dependency-audit-ci",
  "workflow-permissions",
  "workflow-unpinned-action",
  "docker-root-user",
  "dockerfile",
  "env-example",
  "env-example-ai",
  "readme",
  "readme-ai",
  "monitoring",
  "error-boundary",
  "helmet",
  "cors",
  "rate-limit",
  "logger",
  "security-cookie-flags",
  "https-redirect",
  "security-csrf",
  "health-check",
  "ts-strict",
  "db-pool",
  "gitignore-env",
  "api-tests",
  "ruff",
  "rubocop",
  "golangci-lint",
  "phpcs",
  "checkstyle",
  "credo",
  "pytest-ai",
  "go-test-ai",
  "rspec-ai",
  "phpunit-ai",
  "junit-ai",
  "kotlin-test-ai",
  "cargo-test-ai",
  "xunit-ai",
  "exunit-ai",
  "dart-test-ai",
  "swift-test-ai",
  "pytest",
  "rspec",
  "phpunit",
  "auditor-stripe-webhook",
  "auditor-env-undocumented",
  "auditor-env-gap",
  "auditor-api-validation",
  "auditor-auth-routes",
  "auditor-prisma-migrations",
  "auditor-localhost-api",
  "auditor-todo-markers",
] as const;

export type FixToolId = (typeof ALL_FIX_TOOL_IDS)[number];

/** Fix ids the scanner can report but `fix-executor/` has no generator for.
 *
 * `security-csrf` is reported by scanner/security/csrf.ts and bundled in the Security Hardening
 * Pack (fix-packs.ts), yet no handler anywhere in fix-executor/ produces output for it — so
 * requesting it wrote no file and emitted no note. The operator got silence,
 * with nothing indicating the CSRF half was never applied. Listing it here makes the gap explicit,
 * lets collect-fix-files warn instead of going quiet, and is asserted by a test so a real
 * generator (or a new unimplemented fix) cannot drift out of sync with this list.
 *
 * Adding a generator? Remove the id from this set — the test will tell you if you forget. */
export const FIX_IDS_WITHOUT_GENERATOR: ReadonlySet<string> = new Set<FixToolId>([]);

export const LANGUAGE_LINT_TOOLS: Partial<Record<FixToolId, ProjectLanguage>> = {
  ruff: "python",
  "golangci-lint": "go",
  rubocop: "ruby",
  phpcs: "php",
  checkstyle: "java",
  credo: "elixir",
};

const NODE_ONLY = new Set([
  "vitest",
  "vitest-ai",
  "eslint",
  "prettier",
  "error-boundary",
  "playwright",
  "playwright-ai",
]);

/**
 * Fixes that still make sense for a repository that is just HTML and CSS. Exported because
 * `getToolApplicability` enforces it and `expectedToolApplicable` predicts it — two copies of
 * this list drifted apart once already, and the matrix test failed until they agreed again.
 */
export const STATIC_ALLOWED = new Set([
  "github-actions",
  // Hardening a workflow or a Dockerfile is about the pipeline and the image, not about what
  // the app is written in — a static site with a deploy workflow needs it as much as an API.
  "workflow-permissions",
  "workflow-unpinned-action",
  "docker-root-user",
  "ci-ai",
  "env-example",
  "env-example-ai",
  "readme",
  "readme-ai",
  "gitignore-env",
]);

const BACKEND_LANGS = new Set<ProjectLanguage>([
  "node",
  "python",
  "java",
  "kotlin",
  "go",
  "ruby",
  "php",
  "rust",
  "csharp",
  "elixir",
]);

// Cookie-flags and https-redirect only have templates + wiring for node/python/go — keep this
// separate from BACKEND_LANGS (see the matching SCOPED_MIDDLEWARE_LANGUAGES note in
// project-context.server.ts).
const SCOPED_MIDDLEWARE_LANGS = new Set<ProjectLanguage>(["node", "python", "go"]);

const API_TEST_LANGS = new Set<ProjectLanguage>([
  "python",
  "go",
  "ruby",
  "php",
  "java",
  "kotlin",
  "rust",
  "csharp",
  "elixir",
  "dart",
  "swift",
]);

export function languageLintGate(
  fixId: string,
  language: ProjectLanguage,
): { block: boolean; reason?: string } {
  const required = LANGUAGE_LINT_TOOLS[fixId as FixToolId];
  if (!required) return { block: false };
  if (language !== required) {
    return {
      block: true,
      reason: `Skipped — ${fixId} is for ${required} projects`,
    };
  }
  return { block: false };
}

export function languageAiTestGate(
  fixId: string,
  ctx: Pick<ProjectContext, "language" | "isNodeProject" | "resolvedFramework">,
): { block: boolean; reason?: string } {
  if (!isLanguageAiTestFix(fixId)) return { block: false };
  const expected = languageUnitTestAiFix(ctx.language);
  if (expected === fixId) return { block: false };
  return {
    block: true,
    reason: expected
      ? `Skipped — use ${expected} for ${ctx.resolvedFramework}`
      : `Skipped — ${fixId} does not apply to ${ctx.resolvedFramework}`,
  };
}

/** Rule-based expectation for matrix tests (mirrors getToolApplicability defaults). */
export function expectedToolApplicable(
  fixId: string,
  ctx: ProjectContext,
  opts?: { staticSite?: boolean; hasCi?: boolean; hasNextAppRouter?: boolean },
): boolean {
  if (opts?.staticSite && !STATIC_ALLOWED.has(fixId)) return false;
  if (fixId === "vitest") return false;
  if (NODE_ONLY.has(fixId) && fixId !== "playwright-ai" && !ctx.isNodeProject) return false;
  if (languageLintGate(fixId, ctx.language).block) return false;
  if (languageAiTestGate(fixId, ctx).block) return false;
  if (fixId === "error-boundary" && !(opts?.hasNextAppRouter ?? ctx.hasNextAppRouter)) return false;
  if (["helmet", "cors", "rate-limit", "logger"].includes(fixId)) {
    if (!BACKEND_LANGS.has(ctx.language)) return false;
    if (ctx.language === "node" && !ctx.isNodeProject) return false;
  }
  if (["security-cookie-flags", "https-redirect"].includes(fixId)) {
    if (!SCOPED_MIDDLEWARE_LANGS.has(ctx.language)) return false;
    if (ctx.language === "node" && !ctx.isNodeProject) return false;
  }
  if (fixId === "api-tests" && !ctx.isNodeProject && !API_TEST_LANGS.has(ctx.language))
    return false;
  if ((fixId === "ci-ai" || fixId === "github-actions") && (opts?.hasCi ?? ctx.hasExistingCi)) {
    return false;
  }
  if (fixId === "playwright-ai") {
    return isPlaywrightAiApplicable({
      language: ctx.language,
      resolvedFramework: ctx.resolvedFramework,
      isNodeProject: ctx.isNodeProject,
      isStaticSpa: ctx.isStaticSpa,
      usesReact: ctx.usesReact,
      filePaths: ctx.filePaths,
    });
  }
  return true;
}

export function emptyIntelligence(overrides?: Partial<ProjectIntelligence>): ProjectIntelligence {
  return {
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
  };
}

export function baseCtx(
  partial: Partial<ProjectContext> &
    Pick<ProjectContext, "language" | "resolvedFramework" | "isNodeProject" | "filePaths">,
): ProjectContext {
  return {
    fullName: "o/repo",
    framework: partial.resolvedFramework,
    packageManager: "npm",
    pkg: {
      scripts: {},
      nodeVersion: "20",
      hasBackend: !partial.isNodeProject,
      dependencies: {},
      devDependencies: {},
    },
    mergedDeps: {},
    stack: {
      frameworks: [partial.resolvedFramework],
      services: [],
      deployTargets: [],
      profile: "General Node",
    },
    manifests: {},
    usesTypeScript: false,
    usesReact: false,
    hasExpress: false,
    isStaticSpa: false,
    hasNextAppRouter: false,
    hasExistingCi: false,
    hasExistingDockerfile: false,
    deployConfigs: [],
    envVars: [],
    intelligence: emptyIntelligence(),
    ...partial,
  };
}

export interface RepoProfile {
  name: string;
  ctx: ProjectContext;
  staticSite?: boolean;
}

/** Representative repo stacks — one fixture per major language / layout. */
export const REPO_PROFILES: RepoProfile[] = [
  {
    name: "vite-spa",
    ctx: baseCtx({
      language: "node",
      resolvedFramework: "Vite",
      isNodeProject: true,
      filePaths: ["package.json", "vite.config.ts", "src/App.tsx"],
      usesTypeScript: true,
      usesReact: true,
      isStaticSpa: true,
      pkg: {
        scripts: { build: "vite build" },
        nodeVersion: "20",
        hasBackend: false,
        dependencies: { react: "^19" },
        devDependencies: { vite: "^6", vitest: "^3" },
      },
      mergedDeps: { react: "^19", vite: "^6", vitest: "^3" },
    }),
  },
  {
    name: "nextjs-app",
    ctx: baseCtx({
      language: "node",
      resolvedFramework: "Next.js",
      isNodeProject: true,
      filePaths: ["package.json", "app/page.tsx", "app/layout.tsx"],
      usesTypeScript: true,
      usesReact: true,
      hasNextAppRouter: true,
      mergedDeps: { next: "^15", react: "^19" },
    }),
  },
  {
    name: "express-api",
    ctx: baseCtx({
      language: "node",
      resolvedFramework: "Express",
      isNodeProject: true,
      filePaths: ["package.json", "src/index.ts"],
      hasExpress: true,
      usesTypeScript: true,
      mergedDeps: { express: "^4" },
    }),
  },
  {
    name: "monorepo-vite",
    ctx: baseCtx({
      language: "node",
      resolvedFramework: "JavaScript",
      isNodeProject: true,
      filePaths: ["package.json", "apps/web/package.json", "apps/web/vite.config.js"],
      intelligence: emptyIntelligence({ monorepo: true, runtimeModel: "monorepo" }),
    }),
  },
  {
    name: "static-html",
    staticSite: true,
    ctx: baseCtx({
      language: "node",
      resolvedFramework: "unknown",
      isNodeProject: false,
      filePaths: ["index.html", "style.css"],
    }),
  },
  {
    name: "python-fastapi",
    ctx: baseCtx({
      language: "python",
      resolvedFramework: "Python",
      isNodeProject: false,
      filePaths: ["pyproject.toml", "main.py"],
      manifests: { pyprojectToml: "[project]\nname='api'" },
    }),
  },
  {
    name: "go-api",
    ctx: baseCtx({
      language: "go",
      resolvedFramework: "Go",
      isNodeProject: false,
      filePaths: ["go.mod", "cmd/server/main.go"],
    }),
  },
  {
    name: "java-spring",
    ctx: baseCtx({
      language: "java",
      resolvedFramework: "Java",
      isNodeProject: false,
      filePaths: ["pom.xml", "src/main/java/com/app/Application.java"],
    }),
  },
  {
    name: "kotlin-gradle",
    ctx: baseCtx({
      language: "kotlin",
      resolvedFramework: "Kotlin",
      isNodeProject: false,
      filePaths: ["build.gradle.kts", "src/main/kotlin/App.kt"],
    }),
  },
  {
    name: "ruby-rails",
    ctx: baseCtx({
      language: "ruby",
      resolvedFramework: "Ruby",
      isNodeProject: false,
      filePaths: ["Gemfile", "config/routes.rb"],
    }),
  },
  {
    name: "php-laravel",
    ctx: baseCtx({
      language: "php",
      resolvedFramework: "PHP",
      isNodeProject: false,
      filePaths: ["composer.json", "artisan"],
    }),
  },
  {
    name: "rust-actix",
    ctx: baseCtx({
      language: "rust",
      resolvedFramework: "Rust",
      isNodeProject: false,
      filePaths: ["Cargo.toml", "src/main.rs"],
    }),
  },
  {
    name: "csharp-aspnet",
    ctx: baseCtx({
      language: "csharp",
      resolvedFramework: "C#",
      isNodeProject: false,
      filePaths: ["App.csproj", "Program.cs"],
    }),
  },
  {
    name: "elixir-phoenix",
    ctx: baseCtx({
      language: "elixir",
      resolvedFramework: "Elixir",
      isNodeProject: false,
      filePaths: ["mix.exs", "lib/app_web/endpoint.ex"],
    }),
  },
  {
    name: "dart-flutter",
    ctx: baseCtx({
      language: "dart",
      resolvedFramework: "Flutter",
      isNodeProject: false,
      filePaths: ["pubspec.yaml", "lib/main.dart"],
    }),
  },
  {
    name: "swift-ios",
    ctx: baseCtx({
      language: "swift",
      resolvedFramework: "Swift",
      isNodeProject: false,
      filePaths: ["Package.swift", "Sources/App/main.swift"],
    }),
  },
];
