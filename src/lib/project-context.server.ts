/**
 * Single source of truth about what a repo is and what its code does.
 * Every fix tool (static + AI) reads from here — Node, Python, Go, Ruby, Rust, PHP, Java.
 */

import { detectLanguage } from "./scanner-rules";
import { decideAppRoot, isWorkspaceRoot } from "./scan-engine/app-root";
import { detectStack } from "./readiness/stack-detector";
import type { DetectedStack } from "./readiness/types";
import { projectUsesTypeScript } from "./project-ci.server";
import {
  buildProjectIntelligence,
  intelligenceToAiFiles,
  type ProjectIntelligence,
} from "./project-intelligence.server";
import { githubContentsPath } from "./github.server";
import { getRepoSnapshot, snapshotFile } from "./repo-snapshot.server";
import { isLanguageAiTestFix, languageUnitTestAiFix } from "./language-test-fixes";
import { AI_TEST_COMING_SOON_MESSAGE } from "./language-setup";
import { languageAiTestGate, languageLintGate, STATIC_ALLOWED } from "./fix-tool-catalog";
export {
  type ProjectLanguage,
  NON_NODE_FRAMEWORKS,
  isNonNodeFramework,
  frameworkToProjectLanguage,
} from "./project-context";
import { FRAMEWORK_TO_LANGUAGE } from "./project-context";
import {
  type ProjectLanguage,
  isAutomatedFixSupported,
  isStaticWebRepo,
  normalizeScannerLanguage,
} from "./project-context";
export { normalizeScannerLanguage } from "./project-context";
import { isPlaywrightAiApplicable, playwrightAiSkipReason } from "./platform-testing";

const GITHUB_API = "https://api.github.com";

export interface PackageJsonFacts {
  scripts: Record<string, string>;
  nodeVersion: string;
  hasBackend: boolean;
  packageManager?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  raw?: string;
}

export interface LanguageManifests {
  goMod?: string;
  gemfile?: string;
  requirements?: string;
  pyprojectToml?: string;
  pipfile?: string;
  cargoToml?: string;
  composerJson?: string;
  pomXml?: string;
  buildGradle?: string;
  mixExs?: string;
  makefile?: string;
  pubspecYaml?: string;
  packageSwift?: string;
}

export interface ProjectContext {
  fullName: string;
  /** Scanner/framework label from DB */
  framework: string;
  /** Resolved after tree + manifest inspection */
  resolvedFramework: string;
  language: ProjectLanguage;
  isNodeProject: boolean;
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  /** Whole-repo paths. Handlers locate existing files by their real path. */
  filePaths: string[];
  /**
   * Repo-relative directory the app lives in; absent/null when the root is the app.
   *
   * Detection, manifests and `pkg` above describe the app at this directory; generated files
   * are written beneath it (see `collectFixFiles`). Null for every single-app repository, which
   * is why it is optional — the many hand-built contexts in tests and fixtures mean "root".
   */
  appDir?: string | null;
  pkg: PackageJsonFacts;
  mergedDeps: Record<string, string>;
  stack: DetectedStack;
  manifests: LanguageManifests;
  usesTypeScript: boolean;
  usesReact: boolean;
  hasExpress: boolean;
  isStaticSpa: boolean;
  hasNextAppRouter: boolean;
  hasExistingCi: boolean;
  hasExistingDockerfile: boolean;
  deployConfigs: string[];
  envVars: string[];
  repoDescription?: string;
  /** Deep code analysis — env phases, monorepo, integrations, samples */
  intelligence: ProjectIntelligence;
}

const BACKEND_DEPS = [
  "express",
  "fastify",
  "koa",
  "hapi",
  "@hapi/hapi",
  "nestjs",
  "@nestjs/core",
  "restify",
  "polka",
  "h3",
];

const NODE_ONLY_TOOLS = new Set([
  "vitest",
  "vitest-ai",
  "eslint",
  "prettier",
  "error-boundary",
  "playwright",
  "playwright-ai",
]);

const BACKEND_MIDDLEWARE_TOOLS = new Set(["helmet", "cors", "rate-limit", "logger"]);

const BACKEND_MIDDLEWARE_LANGUAGES = new Set<ProjectLanguage>([
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

// Deliberately separate from BACKEND_MIDDLEWARE_TOOLS/LANGUAGES above — these two fixes only
// have templates + entry-wiring for node/python/go today. Reusing the broader set would report
// them as "applicable" for java/ruby/php/rust/csharp/elixir/kotlin repos with no matching
// dispatch case, silently producing nothing.
const SCOPED_MIDDLEWARE_TOOLS = new Set(["security-cookie-flags", "https-redirect"]);

const SCOPED_MIDDLEWARE_LANGUAGES = new Set<ProjectLanguage>(["node", "python", "go"]);

const ENV_VAR_BUILTINS = new Set([
  "NODE_ENV",
  "PATH",
  "HOME",
  "USER",
  "PORT",
  "HOST",
  "PWD",
  "LANG",
  "LC_ALL",
]);

async function ghFetch(token: string, path: string): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "LaunchReadyy/1.0",
    },
  });
}

async function fetchFileViaContentsApi(
  token: string,
  fullName: string,
  path: string,
): Promise<string | null> {
  try {
    const res = await ghFetch(token, `/repos/${fullName}/contents/${githubContentsPath(path)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string; encoding?: string };
    if (!data.content || data.encoding !== "base64") return null;
    return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
  } catch {
    return null;
  }
}

async function fetchFile(token: string, fullName: string, path: string): Promise<string | null> {
  return snapshotFile(token, fullName, path, fetchFileViaContentsApi);
}

export async function fetchRepoFilePaths(token: string, fullName: string): Promise<string[]> {
  try {
    return (await getRepoSnapshot(token, fullName)).filePaths;
  } catch {
    // Tarball unavailable (empty repo, rate limit) — fall back to the trees API.
  }
  try {
    const repoRes = await ghFetch(token, `/repos/${fullName}`);
    if (!repoRes.ok) return [];
    const repo = (await repoRes.json()) as { default_branch?: string };
    const branch = repo.default_branch ?? "main";
    const res = await ghFetch(token, `/repos/${fullName}/git/trees/${branch}?recursive=1`);
    if (!res.ok) return [];
    const data = (await res.json()) as { tree: Array<{ path: string; type: string }> };
    return data.tree.filter((n) => n.type === "blob").map((n) => n.path);
  } catch {
    return [];
  }
}

async function detectNodePackageManager(
  token: string,
  fullName: string,
  appDir: string | null = null,
): Promise<ProjectContext["packageManager"]> {
  // A workspace pins its package manager at the root, so a nested app's own lockfile is checked
  // first and the root is the fallback — the same precedence the sandbox uses to pick an
  // install directory (`sandbox/commands.ts`).
  const at = (name: string) => (appDir ? `${appDir}/${name}` : name);
  const names = ["pnpm-lock.yaml", "yarn.lock", "bun.lockb"] as const;
  const managers = ["pnpm", "yarn", "bun"] as const;

  for (const dir of appDir ? [at, (n: string) => n] : [at]) {
    const found = await Promise.all(names.map((n) => fetchFile(token, fullName, dir(n))));
    const hit = found.findIndex(Boolean);
    if (hit !== -1) return managers[hit];
  }
  return "npm";
}

// `engines.node` is usually a floor, not a pin (">=12.0.0" means "works on 12+", not "must be
// 12") — naively extracting the first number treated that floor as the exact CI/Dockerfile
// target. Confirmed against the real hagopj13/node-express-boilerplate (`"node": ">=12.0.0"`):
// the generated Dockerfile/CI targeted `node:12-bookworm-slim`, an image that was never
// published — Node 12 (EOL April 2022) predates the "bookworm" Debian release entirely, so the
// build can't even pull its base image. Clamping to a currently-supported floor fixes both an
// unbuildable old floor AND an outdated-but-still-published one (e.g. 14, 16) the same way,
// without needing to special-case the `>=`/`^`/`~` operators — any real repo's own CI would need
// at least this much regardless of what an old package.json says.
const MIN_SUPPORTED_NODE_MAJOR = 18;

export function clampNodeVersion(extracted: string | undefined): string {
  const n = extracted ? parseInt(extracted, 10) : NaN;
  if (Number.isNaN(n) || n < MIN_SUPPORTED_NODE_MAJOR) return "20";
  return extracted!;
}

/**
 * `.nvmrc` wins over `engines.node`, matching `resolveSandboxNodeVersion`. The sandbox already
 * preferred it, so the two halves of the product disagreed: a repo pinned the ordinary nvm way
 * (no `engines` field) sandbox-verified on its real Node and then got a CI workflow pinned to the
 * "20" fallback. Observed on a real PR — an Astro repo with `.nvmrc` = 22.23.1 had every CI job
 * die on `Node.js v20.20.2 is not supported by Astro! … requires >=22.12.0`.
 */
function nodeMajorFrom(nvmrc: string | null, enginesNode: string | undefined): string {
  const fromNvmrc = nvmrc?.trim().replace(/^v/i, "").match(/^\d+/)?.[0];
  return clampNodeVersion(fromNvmrc ?? enginesNode?.match(/\d+/)?.[0]);
}

function parsePackageJson(content: string | null, nvmrc: string | null = null): PackageJsonFacts {
  if (!content) {
    return {
      scripts: {},
      nodeVersion: nodeMajorFrom(nvmrc, undefined),
      hasBackend: false,
      dependencies: {},
      devDependencies: {},
    };
  }
  try {
    const pkg = JSON.parse(content) as {
      scripts?: Record<string, string>;
      engines?: { node?: string };
      packageManager?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = pkg.dependencies ?? {};
    const devDependencies = pkg.devDependencies ?? {};
    const allDeps = { ...dependencies, ...devDependencies };
    return {
      scripts: pkg.scripts ?? {},
      nodeVersion: nodeMajorFrom(nvmrc, pkg.engines?.node),
      hasBackend: BACKEND_DEPS.some((d) => d in allDeps),
      packageManager: pkg.packageManager,
      dependencies,
      devDependencies,
      raw: content,
    };
  } catch {
    return {
      scripts: {},
      nodeVersion: nodeMajorFrom(nvmrc, undefined),
      hasBackend: false,
      dependencies: {},
      devDependencies: {},
      raw: content,
    };
  }
}

export function resolveProjectLanguage(
  framework: string,
  filePaths: string[],
  hasPackageJson: boolean,
): { language: ProjectLanguage; resolvedFramework: string } {
  const nodeFrameworks = new Set(["Next.js", "Vite", "React", "Express"]);
  const secondary = detectLanguage(filePaths);
  const jsSourceCount = filePaths.filter(
    (f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && !f.includes("node_modules"),
  ).length;

  if (hasPackageJson || nodeFrameworks.has(framework)) {
    // Monorepo / polyglot: package.json present but backend is clearly non-Node
    if (secondary !== "unknown" && jsSourceCount < 3) {
      return {
        language: FRAMEWORK_TO_LANGUAGE[secondary] ?? "unknown",
        resolvedFramework: secondary,
      };
    }
    return {
      language: "node",
      resolvedFramework: framework !== "unknown" ? framework : "JavaScript",
    };
  }

  const detected = detectLanguage(filePaths);
  if (detected !== "unknown") {
    return {
      language: FRAMEWORK_TO_LANGUAGE[detected] ?? "unknown",
      resolvedFramework: detected,
    };
  }

  if (FRAMEWORK_TO_LANGUAGE[framework]) {
    return {
      language: FRAMEWORK_TO_LANGUAGE[framework],
      resolvedFramework: framework,
    };
  }

  return { language: "unknown", resolvedFramework: framework };
}

const ENV_SCAN_BY_LANGUAGE: Record<ProjectLanguage, { extensions: RegExp; patterns: RegExp[] }> = {
  node: {
    extensions: /\.(ts|tsx|js|jsx|mjs|cjs)$/,
    patterns: [
      /process\.env\.([A-Z_][A-Z0-9_]*)/g,
      /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]]/g,
      /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
    ],
  },
  python: {
    extensions: /\.py$/,
    patterns: [
      /os\.environ\[['"]([A-Z_][A-Z0-9_]*)['"]]/g,
      /os\.getenv\(['"]([A-Z_][A-Z0-9_]*)['"]/g,
      /os\.environ\.get\(['"]([A-Z_][A-Z0-9_]*)['"]/g,
    ],
  },
  go: {
    extensions: /\.go$/,
    patterns: [/os\.Getenv\(["']([A-Z_][A-Z0-9_]*)["']\)/g],
  },
  ruby: {
    extensions: /\.rb$/,
    patterns: [/ENV\[['"]([A-Z_][A-Z0-9_]*)['"]]/g, /ENV\.fetch\(['"]([A-Z_][A-Z0-9_]*)['"]/g],
  },
  php: {
    extensions: /\.php$/,
    patterns: [/\$_ENV\[['"]([A-Z_][A-Z0-9_]*)['"]]/g, /getenv\(['"]([A-Z_][A-Z0-9_]*)['"]\)/g],
  },
  rust: {
    extensions: /\.rs$/,
    patterns: [
      /std::env::var\(["']([A-Z_][A-Z0-9_]*)["']\)/g,
      /env!\(["']([A-Z_][A-Z0-9_]*)["']\)/g,
    ],
  },
  java: {
    extensions: /\.java$/,
    patterns: [/System\.getenv\(["']([A-Z_][A-Z0-9_]*)["']\)/g],
  },
  csharp: {
    extensions: /\.cs$/,
    patterns: [
      /Environment\.GetEnvironmentVariable\(["']([A-Z_][A-Z0-9_]*)["']\)/g,
      /Configuration\[["']([A-Z_][A-Z0-9_]*)["']\]/g,
    ],
  },
  elixir: {
    extensions: /\.exs?$/,
    patterns: [/System\.get_env\(["']([A-Z_][A-Z0-9_]*)["']\)/g],
  },
  dart: {
    extensions: /\.dart$/,
    patterns: [/String\.fromEnvironment\(['"]([A-Z_][A-Z0-9_]*)['"]/g],
  },
  swift: {
    extensions: /\.swift$/,
    patterns: [/ProcessInfo\.processInfo\.environment\[["']([A-Z_][A-Z0-9_]*)["']\]/g],
  },
  kotlin: {
    extensions: /\.(kt|kts)$/,
    patterns: [/System\.getenv\(["']([A-Z_][A-Z0-9_]*)["']\)/g],
  },
  unknown: {
    extensions: /\.(ts|tsx|js|jsx|py|go|rb|php|rs|java)$/,
    patterns: [
      /process\.env\.([A-Z_][A-Z0-9_]*)/g,
      /os\.getenv\(['"]([A-Z_][A-Z0-9_]*)['"]/g,
      /os\.Getenv\(["']([A-Z_][A-Z0-9_]*)["']\)/g,
    ],
  },
};

const ENV_SCAN_DIRS = [
  "src",
  "app",
  "pages",
  "lib",
  "server",
  "api",
  "cmd",
  "internal",
  "pkg",
  "tests",
  "test",
];

export async function scanEnvVarsFromTree(
  token: string,
  fullName: string,
  paths: string[],
  language: ProjectLanguage,
): Promise<string[]> {
  const vars = new Set<string>();
  const { extensions, patterns } = ENV_SCAN_BY_LANGUAGE[language];
  const candidates = paths.filter(
    (p) =>
      extensions.test(p) &&
      (ENV_SCAN_DIRS.some((d) => p === d || p.startsWith(`${d}/`)) ||
        p.endsWith(".py") ||
        p.endsWith(".go") ||
        p.endsWith(".rb")),
  );
  for (const p of candidates.slice(0, 80)) {
    const content = await fetchFile(token, fullName, p);
    if (!content) continue;
    for (const pattern of patterns) {
      for (const m of content.matchAll(pattern)) vars.add(m[1]);
    }
  }
  return [...vars].filter((v) => !ENV_VAR_BUILTINS.has(v)).sort();
}

export function inferProjectFacts(
  language: ProjectLanguage,
  framework: string,
  pkg: PackageJsonFacts,
  filePaths: string[],
): Pick<
  ProjectContext,
  | "usesTypeScript"
  | "usesReact"
  | "hasExpress"
  | "isStaticSpa"
  | "hasNextAppRouter"
  | "hasExistingCi"
  | "hasExistingDockerfile"
  | "deployConfigs"
> {
  if (language !== "node") {
    return {
      usesTypeScript: false,
      usesReact: false,
      hasExpress: false,
      isStaticSpa: false,
      hasNextAppRouter: false,
      hasExistingCi: filePaths.some((p) => p.startsWith(".github/workflows/")),
      hasExistingDockerfile: filePaths.includes("Dockerfile"),
      deployConfigs: filePaths.filter((p) =>
        /^(vercel\.json|netlify\.toml|fly\.toml|render\.yaml|Procfile|Dockerfile|docker-compose\.ya?ml|railway\.json)$/i.test(
          p,
        ),
      ),
    };
  }

  const mergedDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const usesTypeScript = projectUsesTypeScript(pkg, filePaths);
  const usesReact = Boolean(mergedDeps.react || mergedDeps["react-dom"]);
  const hasExpress = Boolean(mergedDeps.express) || framework === "Express";
  const hasBackend = pkg.hasBackend || hasExpress;
  const isViteLike = framework === "Vite" || framework === "React" || Boolean(mergedDeps.vite);
  const isStaticSpa = isViteLike && !hasBackend && Boolean(pkg.scripts.build) && !mergedDeps.next;

  return {
    usesTypeScript,
    usesReact,
    hasExpress,
    isStaticSpa,
    hasNextAppRouter:
      framework === "Next.js" &&
      filePaths.some(
        (p) => p === "app" || p.startsWith("app/") || p === "src/app" || p.startsWith("src/app/"),
      ),
    hasExistingCi: filePaths.some((p) => p.startsWith(".github/workflows/")),
    hasExistingDockerfile: filePaths.includes("Dockerfile"),
    deployConfigs: filePaths.filter((p) =>
      /^(vercel\.json|netlify\.toml|fly\.toml|render\.yaml|Procfile|Dockerfile|docker-compose\.ya?ml|railway\.json)$/i.test(
        p,
      ),
    ),
  };
}

async function fetchLanguageManifests(
  token: string,
  fullName: string,
  filePaths: string[],
  appDir: string | null = null,
): Promise<LanguageManifests> {
  // `filePaths` is app-relative when appDir is set, so the presence check stays simple while
  // the fetch still asks GitHub for the real repository path.
  const pick = async (path: string, max: number) => {
    if (!filePaths.includes(path)) return undefined;
    const c = await fetchFile(token, fullName, appDir ? `${appDir}/${path}` : path);
    return c ? c.slice(0, max) : undefined;
  };

  const [
    goMod,
    gemfile,
    requirements,
    pyprojectToml,
    pipfile,
    cargoToml,
    composerJson,
    pomXml,
    buildGradle,
    makefile,
    mixExs,
    pubspecYaml,
    packageSwift,
  ] = await Promise.all([
    pick("go.mod", 500),
    pick("Gemfile", 1000),
    pick("requirements.txt", 1000),
    pick("pyproject.toml", 1500),
    pick("Pipfile", 1000),
    pick("Cargo.toml", 500),
    pick("composer.json", 1000),
    pick("pom.xml", 1500),
    // Kotlin (and modern Android) projects overwhelmingly use the .kts variant — confirmed
    // against the real spring-petclinic-kotlin, which has build.gradle.kts only, leaving
    // kotlin-test-ai's "match existing test dependencies from build files" with no build file.
    pick("build.gradle", 1000).then((c) => c ?? pick("build.gradle.kts", 1000)),
    pick("Makefile", 1000),
    pick("mix.exs", 1500),
    // Dart tests import project code as `package:<name>/...` and Swift tests need the target
    // for `@testable import` — both names live only in these manifests (same class of context
    // gap as go-test-ai's go.mod, where a real generation invented the module path).
    pick("pubspec.yaml", 1500),
    pick("Package.swift", 1500),
  ]);

  return {
    goMod,
    gemfile,
    requirements,
    pyprojectToml,
    pipfile,
    cargoToml,
    composerJson,
    pomXml,
    buildGradle,
    makefile,
    mixExs,
    pubspecYaml,
    packageSwift,
  };
}

// A single fix preview touches this same repo+framework from three independent call
// sites (collectFixFiles, the applicability check, and generateAiTests) within one request.
// Each unmemoized call fans out 20-30+ GitHub subrequests (tree, package.json, a dozen
// per-language manifests, env scan, project intelligence) — three times over, for identical
// data. On a real repo that's easily enough to trip the platform's per-invocation subrequest
// limit. Cache the in-flight/recent promise so concurrent and back-to-back callers within the
// same request (and nearby requests for the same repo) share one fetch instead of three.
const projectContextCache = new Map<
  string,
  { promise: Promise<ProjectContext>; expiresAt: number }
>();
const PROJECT_CONTEXT_CACHE_TTL_MS = 30_000;

export async function buildProjectContext(
  token: string,
  fullName: string,
  framework: string,
): Promise<ProjectContext> {
  const cacheKey = `${fullName}:${framework}`;
  const now = Date.now();
  const cached = projectContextCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = buildProjectContextUncached(token, fullName, framework);
  projectContextCache.set(cacheKey, { promise, expiresAt: now + PROJECT_CONTEXT_CACHE_TTL_MS });
  // A failed fetch shouldn't poison the cache for the whole TTL window — let the next call retry.
  promise.catch(() => projectContextCache.delete(cacheKey));
  return promise;
}

async function buildProjectContextUncached(
  token: string,
  fullName: string,
  framework: string,
): Promise<ProjectContext> {
  const [filePaths, rootPkgRaw, nvmrcRaw, repoRes] = await Promise.all([
    fetchRepoFilePaths(token, fullName),
    fetchFile(token, fullName, "package.json"),
    // Pinning convention that carries no `engines` field — the sandbox already honours it.
    fetchFile(token, fullName, ".nvmrc").catch(() => null),
    ghFetch(token, `/repos/${fullName}`),
  ]);

  // Where the app actually lives. Root detection is tried first and always wins when it
  // succeeds, so a single-app repo resolves `appDir` to null and every line below behaves
  // exactly as it did before. Only a root with no manifest of its own — or a workspace
  // coordinator — looks deeper. Mirrors the scan's own decision in `scan-engine/app-root.ts`
  // so a repo is never scanned as one project and fixed as another.
  const appDir = resolveContextAppDir(filePaths, rootPkgRaw);

  // Detection reads app-relative paths so `requirements.txt` in `backend/` is found; the
  // context still exposes whole-repo `filePaths`, because handlers locate existing files by
  // their real path and the fix writer needs those to stay absolute.
  const appFilePaths = appDir
    ? filePaths.filter((p) => p.startsWith(`${appDir}/`)).map((p) => p.slice(appDir.length + 1))
    : filePaths;

  const pkgRaw = appDir ? await fetchFile(token, fullName, `${appDir}/package.json`) : rootPkgRaw;

  const hasPackageJson = Boolean(pkgRaw);
  const { language, resolvedFramework } = resolveProjectLanguage(
    framework,
    appFilePaths,
    hasPackageJson,
  );
  const isNodeProject = language === "node";

  const [packageManager, manifests] = await Promise.all([
    isNodeProject
      ? detectNodePackageManager(token, fullName, appDir)
      : Promise.resolve("npm" as const),
    fetchLanguageManifests(token, fullName, appFilePaths, appDir),
  ]);

  const pkg = parsePackageJson(pkgRaw, nvmrcRaw);
  const mergedDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const stack = detectStack(mergedDeps, appFilePaths, resolvedFramework);
  const facts = inferProjectFacts(language, resolvedFramework, pkg, appFilePaths);
  const envVars = await scanEnvVarsFromTree(token, fullName, filePaths, language);

  const fetchFileBound = (path: string) => fetchFile(token, fullName, path);
  const intelligence = await buildProjectIntelligence({
    filePaths,
    mergedDeps,
    isStaticSpa: facts.isStaticSpa,
    fetchFile: fetchFileBound,
  });

  // Prefer code-scanned env contract over shallow tree scan
  const mergedEnvVars =
    intelligence.envContract.all.length > 0 ? intelligence.envContract.all : envVars;

  let repoDescription: string | undefined;
  if (repoRes.ok) {
    const meta = (await repoRes.json()) as { description?: string | null };
    if (meta.description) repoDescription = meta.description;
  }

  return {
    fullName,
    framework,
    resolvedFramework,
    language,
    isNodeProject,
    packageManager,
    filePaths,
    appDir,
    pkg,
    mergedDeps,
    stack,
    manifests,
    envVars: mergedEnvVars,
    intelligence,
    repoDescription,
    ...facts,
  };
}

/**
 * Null whenever the repository root is itself the app — which is the overwhelming majority of
 * repos and every one of the 27 real fixtures, so they keep byte-identical behaviour.
 */
function resolveContextAppDir(filePaths: string[], rootPkgRaw: string | null): string | null {
  const rootLanguage = detectLanguage(filePaths.filter((p) => !p.includes("/")));
  if (rootLanguage !== "unknown") return null;
  if (rootPkgRaw && !isWorkspaceRoot(filePaths, rootPkgRaw)) return null;
  return decideAppRoot(filePaths).appDir;
}

function structuralPathsForLanguage(ctx: ProjectContext): string[] {
  const patterns: Record<ProjectLanguage, RegExp> = {
    node: /\.(ts|tsx|js|jsx|vue|svelte)$/,
    go: /\.go$/,
    python: /\.py$/,
    ruby: /\.rb$/,
    php: /\.php$/,
    rust: /\.rs$/,
    java: /\.java$/,
    kotlin: /\.kt$/,
    csharp: /\.cs$/,
    elixir: /\.ex$/,
    dart: /\.dart$/,
    swift: /\.swift$/,
    unknown: /\.(ts|tsx|js|jsx|py|go|rb|php|rs|java|kt|cs|ex|dart|swift)$/,
  };
  const layout =
    /(^|\/)(routes?|pages?|app|api|components|features|cmd|internal|pkg|src|lib|controllers?)(\/|$)/i;
  return ctx.filePaths
    .filter((p) => patterns[ctx.language].test(p) && layout.test(p))
    .slice(0, 120);
}

export function projectContextToAiFiles(ctx: ProjectContext): Record<string, string> {
  const files: Record<string, string> = {};

  if (ctx.pkg.raw) files["package.json"] = ctx.pkg.raw.slice(0, 3000);
  if (ctx.manifests.goMod) files["go.mod"] = ctx.manifests.goMod;
  if (ctx.manifests.gemfile) files["Gemfile"] = ctx.manifests.gemfile;
  if (ctx.manifests.requirements) files["requirements.txt"] = ctx.manifests.requirements;
  if (ctx.manifests.pyprojectToml) files["pyproject.toml"] = ctx.manifests.pyprojectToml;
  if (ctx.manifests.pipfile) files["Pipfile"] = ctx.manifests.pipfile;
  if (ctx.manifests.cargoToml) files["Cargo.toml"] = ctx.manifests.cargoToml;
  if (ctx.manifests.composerJson) files["composer.json"] = ctx.manifests.composerJson;
  if (ctx.manifests.pomXml) files["pom.xml"] = ctx.manifests.pomXml;
  if (ctx.manifests.buildGradle) files["build.gradle"] = ctx.manifests.buildGradle;
  if (ctx.manifests.makefile) files["Makefile"] = ctx.manifests.makefile;
  // mix.exs was fetched into manifests but never threaded through here — exunit-ai's prompt
  // couldn't see the app name. pubspec.yaml/Package.swift carry the only authoritative
  // package/target names for dart-test-ai/swift-test-ai imports.
  if (ctx.manifests.mixExs) files["mix.exs"] = ctx.manifests.mixExs;
  if (ctx.manifests.pubspecYaml) files["pubspec.yaml"] = ctx.manifests.pubspecYaml;
  if (ctx.manifests.packageSwift) files["Package.swift"] = ctx.manifests.packageSwift;

  files["__file_paths"] = ctx.filePaths.join("\n");
  files["__framework"] = ctx.resolvedFramework;
  files["__language"] = ctx.language;
  files["__profile"] = ctx.stack.profile;
  files["__package_manager"] = ctx.packageManager;
  files["__uses_typescript"] = ctx.usesTypeScript ? "true" : "false";
  files["__is_node_project"] = ctx.isNodeProject ? "true" : "false";
  files["__uses_react"] = ctx.usesReact ? "true" : "false";
  files["__has_express"] = ctx.hasExpress ? "true" : "false";
  files["__is_static_spa"] = ctx.isStaticSpa ? "true" : "false";
  files["__node_engine"] = ctx.pkg.nodeVersion;

  const scriptNames = Object.keys(ctx.pkg.scripts);
  if (scriptNames.length) files["__script_names"] = scriptNames.join(", ");

  if (ctx.envVars.length) files["detected_env_vars"] = ctx.envVars.join(", ");
  if (ctx.repoDescription) files["__repo_description"] = ctx.repoDescription;
  if (ctx.deployConfigs.length) files["__deploy_configs"] = ctx.deployConfigs.join(", ");
  if (ctx.hasExistingDockerfile) files["__has_dockerfile"] = "true";
  if (ctx.hasExistingCi) files["__has_ci"] = "true";

  const structural = structuralPathsForLanguage(ctx);
  if (structural.length) files["__structure"] = structural.join("\n");

  if (ctx.mergedDeps["@vitest/coverage-v8"] || ctx.mergedDeps["@vitest/coverage-istanbul"]) {
    files["__has_coverage"] = "vitest";
  }

  Object.assign(files, intelligenceToAiFiles(ctx.intelligence));

  return files;
}

export interface ToolApplicability {
  applicable: boolean;
  reason?: string;
}

// Confirmed against a real repo: hardcoding SDK 8.0 while the project's own .csproj targets
// net9.0 fails restore outright ("current .NET SDK does not support targeting .NET 9.0"). Shared
// by both the Dockerfile and CI workflow generators so they never drift out of sync with each
// other on which .NET version a project actually targets.
export function dotnetSdkVersion(csprojContent: string): string {
  const match = csprojContent.match(/<TargetFrameworks?>\s*net(\d+\.\d+)/i);
  return match?.[1] ?? "8.0";
}

// Real multi-project .NET solutions commonly declare <TargetFramework> once in a shared
// Directory.Build.props instead of repeating it in every .csproj (MSBuild's own recommended
// pattern for keeping projects in sync) — confirmed against the real davidfowl/TodoApi (an
// Aspire solution): Todo.Api.csproj has no <TargetFramework> of its own at all, only
// Directory.Build.props does, so dotnetSdkVersion() silently defaulted to the wrong SDK (8.0
// instead of the real net9.0). MSBuild resolves the nearest Directory.Build.props by walking up
// from the project's directory to the repo root; walking every ancestor is a superset of that
// and good enough for a regex-based version read (unlike MSBuild we don't need to stop at the
// first match, since any real hit gives the right version).
export function findDirectoryBuildPropsPath(
  csprojPath: string,
  filePaths: string[],
): string | null {
  const fileSet = new Set(filePaths);
  const parts = csprojPath.split("/").slice(0, -1);
  for (let i = parts.length; i >= 0; i--) {
    const candidate = [...parts.slice(0, i), "Directory.Build.props"].join("/");
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

// Same bug class as dotnetSdkVersion above, third occurrence: buildJavaCi/buildKotlinCi
// hardcoded `java-version: '21'` regardless of the project's real toolchain. Confirmed against
// the real spring-projects/spring-petclinic: its build.gradle declares a strict Java 17
// toolchain (`JavaLanguageVersion.of(17)`), and Gradle hard-fails ("Cannot find a Java
// installation ... matching languageVersion=17") when only a JDK 21 is available and no
// toolchain download repository is configured — which is petclinic's exact real configuration.
// (Real ubuntu-latest runners happen to preinstall JDKs 8/11/17/21, masking this for repos that
// only *compile* against an older release — but honoring the declared version is correct
// everywhere and required for strict-toolchain repos.) Declaration shapes verified against real
// repos: petclinic's build.gradle + pom.xml (`<java.version>17</java.version>`),
// spring-petclinic-kotlin's build.gradle.kts (same `JavaLanguageVersion.of`), and
// khoubyari/spring-boot-rest-example's maven-compiler-plugin `<source>1.8</source>`.
export function javaVersionFromBuildFiles(
  pomXml?: string | null,
  buildGradle?: string | null,
): string {
  const blob = [pomXml, buildGradle].filter(Boolean).join("\n");
  const m =
    blob.match(/JavaLanguageVersion\.of\((\d+)\)/) ??
    blob.match(/jvmToolchain\((\d+)\)/) ??
    blob.match(/<java\.version>(?:1\.)?(\d+)<\/java\.version>/) ??
    blob.match(/<maven\.compiler\.(?:release|source|target)>(?:1\.)?(\d+)</) ??
    blob.match(/<(?:source|target|release)>(?:1\.)?(\d+)<\/(?:source|target|release)>/) ??
    blob.match(/sourceCompatibility\s*=\s*['"]?(?:1\.)?(\d+)/);
  return m?.[1] ?? "21";
}

export function hasExistingEslintConfig(
  filePaths: string[],
  _deps: Record<string, string>,
): boolean {
  // Installing eslint does not configure it. Treating the dependency as a config made the fix
  // handler skip writing eslint.config.js; frameworks such as Next.js then open an interactive
  // setup prompt in CI and fail. Keep the parameter for call-site compatibility, but require an
  // actual repository config file.
  return filePaths.some((f) =>
    /^(?:\.eslintrc(?:\.(?:js|cjs|mjs|json|yaml|yml))?|eslint\.config\.(?:js|ts|cjs|mjs))$/.test(
      f.split("/").pop() ?? f,
    ),
  );
}

export function hasLintScript(scripts: Record<string, string>): boolean {
  return Boolean(scripts.lint?.trim());
}

export function isEslintFullyConfigured(ctx: ProjectContext): boolean {
  return hasExistingEslintConfig(ctx.filePaths, ctx.mergedDeps) && hasLintScript(ctx.pkg.scripts);
}

export function hasExistingPrettierConfig(
  filePaths: string[],
  deps: Record<string, string>,
): boolean {
  if (deps.prettier) return true;
  return filePaths.some((f) =>
    /^\.prettierrc(\.(js|json|yaml|yml|cjs|mjs))?$|^prettier\.config\.(js|cjs|mjs|ts)$/.test(
      f.split("/").pop() ?? f,
    ),
  );
}

export function getToolApplicability(fixId: string, ctx: ProjectContext): ToolApplicability {
  if (isStaticWebRepo(ctx.filePaths)) {
    if (!STATIC_ALLOWED.has(fixId)) {
      return {
        applicable: false,
        reason: "Skipped — static HTML site; use a full application repo for this fix",
      };
    }
  }

  const CI_FIXES = new Set(["ci-ai", "github-actions"]);
  if (CI_FIXES.has(fixId)) {
    if (ctx.hasExistingCi) {
      return {
        applicable: false,
        reason:
          "Skipped — this repo already has a GitHub Actions workflow. We won't overwrite it. Delete or rename the existing workflow if you want LaunchReadyy to generate a new one.",
      };
    }
  }

  if (fixId === "vitest-ai") {
    if (!ctx.isNodeProject) {
      return { applicable: false, reason: AI_TEST_COMING_SOON_MESSAGE };
    }
  }

  if (fixId === "playwright-ai") {
    const e2eInput = {
      language: ctx.language,
      resolvedFramework: ctx.resolvedFramework,
      isNodeProject: ctx.isNodeProject,
      isStaticSpa: ctx.isStaticSpa,
      usesReact: ctx.usesReact,
      filePaths: ctx.filePaths,
    };
    if (!isPlaywrightAiApplicable(e2eInput)) {
      return {
        applicable: false,
        reason: playwrightAiSkipReason(e2eInput) ?? "Skipped — use the E2E fix for this stack",
      };
    }
    return { applicable: true };
  }

  if (fixId === "eslint" && isEslintFullyConfigured(ctx)) {
    return {
      applicable: false,
      reason: "Skipped — ESLint is already configured in this repo",
    };
  }

  if (fixId === "prettier" && hasExistingPrettierConfig(ctx.filePaths, ctx.mergedDeps)) {
    return {
      applicable: false,
      reason: "Skipped — Prettier is already configured in this repo",
    };
  }

  if (fixId === "vitest") {
    return {
      applicable: false,
      reason:
        "Skipped — use AI-generated tests (vitest-ai) for real coverage. We no longer add placeholder smoke tests.",
    };
  }

  if (NODE_ONLY_TOOLS.has(fixId) && !ctx.isNodeProject) {
    return {
      applicable: false,
      reason: `Skipped — ${fixId} is for Node/JavaScript projects; this repo is ${ctx.resolvedFramework}`,
    };
  }

  if (BACKEND_MIDDLEWARE_TOOLS.has(fixId) && !BACKEND_MIDDLEWARE_LANGUAGES.has(ctx.language)) {
    return {
      applicable: false,
      reason: `Skipped — ${fixId} is for API backends; this repo is ${ctx.resolvedFramework}`,
    };
  }

  if (BACKEND_MIDDLEWARE_TOOLS.has(fixId) && ctx.language === "node" && !ctx.isNodeProject) {
    return {
      applicable: false,
      reason: `Skipped — ${fixId} requires a Node server runtime`,
    };
  }

  if (SCOPED_MIDDLEWARE_TOOLS.has(fixId) && !SCOPED_MIDDLEWARE_LANGUAGES.has(ctx.language)) {
    return {
      applicable: false,
      reason: `Skipped — ${fixId} is for API backends; this repo is ${ctx.resolvedFramework}`,
    };
  }

  if (SCOPED_MIDDLEWARE_TOOLS.has(fixId) && ctx.language === "node" && !ctx.isNodeProject) {
    return {
      applicable: false,
      reason: `Skipped — ${fixId} requires a Node server runtime`,
    };
  }

  if (fixId === "api-tests" && !ctx.isNodeProject) {
    if (
      ![
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
      ].includes(ctx.language)
    ) {
      return {
        applicable: false,
        reason: `Skipped — api-tests not configured for ${ctx.resolvedFramework}`,
      };
    }
    return { applicable: true };
  }

  if (isExpressOnlyTool(fixId) && !ctx.hasExpress) {
    return {
      applicable: false,
      reason: `Skipped — ${fixId} applies to Express/API backends; this project has no server runtime`,
    };
  }

  if (fixId === "error-boundary" && !ctx.hasNextAppRouter) {
    return {
      applicable: false,
      reason: "Skipped — no Next.js app/ directory; error boundary needs App Router",
    };
  }

  const lintGate = languageLintGate(fixId, ctx.language);
  if (lintGate.block) {
    return { applicable: false, reason: lintGate.reason! };
  }

  const aiGate = languageAiTestGate(fixId, ctx);
  if (aiGate.block) {
    return { applicable: false, reason: aiGate.reason! };
  }

  return { applicable: true };
}

/** Tools that only make sense on Express/API backends (Node). */
export function isExpressOnlyTool(_fixId: string): boolean {
  return false;
}

export function isNodeOnlyTool(fixId: string): boolean {
  return NODE_ONLY_TOOLS.has(fixId);
}

export function isBackendMiddlewareTool(fixId: string): boolean {
  return BACKEND_MIDDLEWARE_TOOLS.has(fixId);
}
