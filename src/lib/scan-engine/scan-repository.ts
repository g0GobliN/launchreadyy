import {
  type IssueInput,
  type NonJsManifests,
  README_PATHS,
  checkCI,
  checkDockerfile,
  checkExpress,
  checkLintScript,
  checkMonitoring,
  checkNextJs,
  checkNonJsDockerfile,
  checkNonJsHealthCheck,
  checkNonJsLinting,
  checkNonJsTesting,
  checkPlatformLaunchReadiness,
  checkReadme,
  checkTestScript,
  checkTypeScriptStrict,
  checkVite,
  dedupeIssues,
  detectFramework,
  detectLanguage,
  isSupportedFramework,
} from "../scanner-rules";
import { normalizeScannerLanguage } from "../project-context";
import {
  isAutomatedFixSupported,
  isStaticWebRepo,
  NO_APPLICATION_DETECTED_MESSAGE,
  UNSUPPORTED_STATIC_WEB_SCAN_PREFIX,
} from "../project-context";
import { isMobileDesktopFramework } from "../platform-stacks";
import {
  enrichFindings,
  computeReadinessScore,
  detectStack,
  buildLaunchChecklist,
  type ReadinessFinding,
  type CategoryScore,
  type DetectedStack,
  type LaunchChecklistItem,
} from "../readiness";
import { runAuditor, dedupeAuditorIssues } from "../readiness/auditor";
import {
  runSecurityChecks,
  runSecurityIntegrations,
  checkNonJsSecurityMiddleware,
  collectDependencies,
  isDockerfilePath,
} from "../scanner/security";
import { auditorLanguageFromFramework, auditorSourceExt } from "../auditor-lang.server";
import { isFeatureEnabled } from "../site-config.server";
import type { KnowledgeExtractionInput } from "../knowledge/extract-facts";
import type { SerializedGraph } from "../graph";
import type { FileProvider, FileProviderMeta, RichFileProvider } from "./file-provider";
import { pickAuditorPaths } from "./pick-auditor-paths";
import { decideAppRoot, findAppRoots, isWorkspaceRoot } from "./app-root";

export interface ScanResult {
  score: number;
  framework: string;
  issues: IssueInput[];
  findings: ReadinessFinding[];
  categoryScores: CategoryScore[];
  stackDetected: DetectedStack;
  checklist: LaunchChecklistItem[];
  warnings: string[];
  /** Inputs for the Phase 2 knowledge engine — persisted by the repoId-aware caller. */
  knowledgeInput?: KnowledgeExtractionInput;
  /** Phase 3 — per-file content hashes (git blob SHAs) for incremental rescans. */
  fileHashes?: Record<string, string>;
  /** Phase 3 — tree SHA identifying overall repo state at scan time. */
  gitSha?: string;
  /** Phase 4 — serialized cross-file dependency graph over the sampled source. */
  dependencyGraph?: SerializedGraph;
}

export interface PriorIncrementalScan {
  fileHashes: Record<string, string>;
  /** Prior findings tagged with ruleId (= fixId) for carry-forward. */
  findings: Array<ReadinessFinding & { ruleId: string }>;
}

export interface RunScanOptions {
  /** For Dependabot aggregation (optional). */
  githubToken?: string;
  repoOwner?: string;
  repoName?: string;
  /** Phase 3 — previous scan hashes + findings when `flag_incremental_scan` is on. */
  priorIncremental?: PriorIncrementalScan;
}

async function readReadme(provider: FileProvider): Promise<string | null> {
  for (const path of README_PATHS) {
    const content = await provider.readFile(path);
    if (content) return content;
  }
  return null;
}

async function readFilesBatch(
  provider: FileProvider,
  paths: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const BATCH = 8;
  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((p) => provider.readFile(p)));
    batch.forEach((p, j) => {
      if (results[j]) out[p] = results[j]!;
    });
  }
  return out;
}

function treeTruncated(provider: FileProvider): boolean {
  return (provider as RichFileProvider).treeTruncated === true;
}

/** Any language's source, plus the config formats people paste credentials into. */
const SECRET_SWEEP_EXT =
  /\.(tsx?|jsx?|mts|cts|mjs|cjs|py|go|rb|php|rs|java|kt|kts|cs|ex|exs|swift|dart|vue|svelte|env|ya?ml|json|toml|ini|conf|properties|sh|bash|tf|tfvars)$/i;

/** Generated/vendored trees: huge, not authored here, and a rich source of false positives. */
const SECRET_SWEEP_SKIP =
  /(^|\/)(node_modules|vendor|dist|build|out|target|coverage|\.next|\.nuxt|__pycache__|\.venv|venv|Pods|\.git|\.terraform)\//;

/** Lockfiles carry integrity hashes that read as high-entropy strings. */
const SECRET_SWEEP_SKIP_FILE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Gemfile\.lock|poetry\.lock|composer\.lock|Cargo\.lock|go\.sum)$/;

/** Bounded so a large monorepo cannot turn one scan into thousands of file reads. */
const SECRET_SWEEP_MAX_FILES = 160;

/**
 * Pick a whole-repository file sample for credential scanning, skipping anything the auditor
 * already read. Ordered so the places secrets actually land (env/config files, then shallow
 * source) are sampled before deep leaf modules, because the cap can bite on a large repo.
 */
async function sampleRepoForSecrets(
  provider: FileProvider,
  allFiles: string[],
  alreadyRead: ReadonlySet<string>,
): Promise<Record<string, string>> {
  const candidates = allFiles
    .filter(
      (f) =>
        !alreadyRead.has(f) &&
        !SECRET_SWEEP_SKIP.test(f) &&
        !SECRET_SWEEP_SKIP_FILE.test(f) &&
        (SECRET_SWEEP_EXT.test(f) || /(^|\/)\.env(\.|$)/.test(f)),
    )
    .sort((a, b) => weight(a) - weight(b) || a.length - b.length)
    .slice(0, SECRET_SWEEP_MAX_FILES);

  return readFilesBatch(provider, candidates);
}

/** No manifest anywhere and no source of any language — there is no app here to score. */
function noApplicationDetected(allFiles: string[]): boolean {
  if (findAppRoots(allFiles, 6).length > 0) return false;
  return !allFiles.some(
    (f) =>
      !f.includes("node_modules/") &&
      /\.(tsx?|jsx?|mts|cts|mjs|cjs|py|go|rb|php|rs|java|kt|kts|cs|ex|exs|swift|dart|vue|svelte|html)$/i.test(
        f,
      ),
  );
}

function weight(path: string): number {
  if (/(^|\/)\.env(\.|$)/.test(path)) return 0;
  if (/(config|settings|secret|credential)/i.test(path)) return 1;
  if (/\.(ya?ml|toml|ini|conf|properties|tfvars)$/i.test(path)) return 2;
  return 3 + path.split("/").length;
}

/** Extra context when the scan was rebased onto a subdirectory (see `app-root.ts`). */
interface AppRootContext {
  /** Directory the scan was rebased onto, relative to the repository root. */
  appDir: string;
  /** Other application roots in the repo that this scan did not cover. */
  otherAppDirs: string[];
  /** Whole-repo file list, root-relative — used for the repo-wide secret sweep. */
  allFiles: string[];
  /** Provider rooted at the repository root, not at `appDir`. */
  rootProvider: FileProvider;
}

/** Re-root a provider on a subdirectory so the scan can treat it as the repository root. */
function rebaseProvider(provider: FileProvider, appDir: string): FileProvider {
  const prefix = `${appDir}/`;
  let cached: string[] | null = null;
  const rich = provider as Partial<FileProviderMeta> & FileProvider;
  const abs = (rel: string) => `${prefix}${rel.replace(/^\/+/, "")}`;
  const rebased: FileProvider & Partial<FileProviderMeta> = {
    async listFiles() {
      if (cached) return cached;
      const all = await provider.listFiles();
      cached = all.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
      return cached;
    },
    readFile(rel: string) {
      return provider.readFile(abs(rel));
    },
    treeTruncated: rich.treeTruncated,
    fileSize: rich.fileSize ? (rel: string) => rich.fileSize!(abs(rel)) : undefined,
    // Incremental rescan keys off whole-repo hashes; a rebased view must not narrow them,
    // or a change outside appDir would look like "nothing changed" on the next scan.
    fileHashes: rich.fileHashes?.bind(rich),
    treeSha: rich.treeSha?.bind(rich),
  };
  return rebased;
}

export async function runScan(
  provider: FileProvider,
  opts: RunScanOptions = {},
): Promise<ScanResult> {
  const allFiles = await provider.listFiles();
  const rootPkg = await provider.readFile("package.json").catch(() => null);

  // Root-level detection is tried first and always wins when it succeeds, so every repo we
  // already classify correctly keeps byte-identical behaviour. Only a root that resolves to
  // nothing — or a workspace coordinator with no app of its own — looks deeper.
  const rootLanguage = detectLanguage(allFiles);
  const rootFramework = rootPkg
    ? detectFramework(JSON.parse(safeJson(rootPkg)) as Record<string, unknown>)
    : "unknown";
  const rootResolves =
    rootLanguage !== "unknown" ||
    (rootFramework !== "unknown" && !isWorkspaceRoot(allFiles, rootPkg));

  if (!rootResolves) {
    const decision = decideAppRoot(allFiles);
    if (decision.appDir) {
      return scanTree(rebaseProvider(provider, decision.appDir), opts, {
        appDir: decision.appDir,
        otherAppDirs: decision.others,
        allFiles,
        rootProvider: provider,
      });
    }
  }

  return scanTree(provider, opts, null);
}

function safeJson(raw: string): string {
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return "{}";
  }
}

async function scanTree(
  provider: FileProvider,
  opts: RunScanOptions = {},
  appRoot: AppRootContext | null,
): Promise<ScanResult> {
  const files = await provider.listFiles();

  const [pkgRaw, readmeRaw, envExampleRaw, tsconfigRaw] = await Promise.all([
    provider.readFile("package.json"),
    readReadme(provider),
    provider.readFile(".env.example").catch(() => null),
    provider.readFile("tsconfig.json").catch(() => null),
  ]);

  const pkg = pkgRaw ? (JSON.parse(pkgRaw) as Record<string, unknown>) : {};
  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };
  const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
  const jsFramework = detectFramework(pkg);
  const detectedLanguage = detectLanguage(files);
  const warnings: string[] = [];

  const NON_JS_LANGUAGES = [
    "Go",
    "Python",
    "Ruby",
    "Java",
    "Kotlin",
    "PHP",
    "Rust",
    "C#",
    "Elixir",
    "Flutter",
    "Swift",
  ];

  // A non-JS backend (Laravel, Rails, Django, Phoenix, …) frequently ships a package.json purely
  // for frontend asset tooling (Vite / Laravel Mix / Webpack). That package.json must NOT route
  // the project into the JS test/lint/dockerfile checks — its real toolchain is PHP/Ruby/Python.
  //
  // This is keyed off `detectedLanguage`, not the collapsed `framework`. It used to read
  // `framework`, which had *already* resolved to the JS framework whenever one was found — so
  // laravel/laravel (which ships `vite` for assets) reported framework "Vite", `isNonJsLanguage`
  // came out false, and a PHP app was offered ESLint and Vitest instead of phpcs and PHPUnit.
  // The condition could only ever be true when no JS dep existed at all, which is the one case
  // the plain `!pkgRaw` check below already covered.
  const backendLanguage = NON_JS_LANGUAGES.includes(detectedLanguage) ? detectedLanguage : null;

  // Asset-pipeline tooling doesn't make a PHP/Ruby/Python repo a JS project. A real
  // Next.js/Remix/Express app is still never misread as non-JS — only these generic
  // bundler/UI-library signals defer to a backend manifest.
  const ASSET_PIPELINE_ONLY = new Set(["Vite", "React", "Vue"]);
  const framework =
    backendLanguage && (jsFramework === "unknown" || ASSET_PIPELINE_ONLY.has(jsFramework))
      ? backendLanguage
      : jsFramework !== "unknown"
        ? jsFramework
        : detectedLanguage;

  const isNonJsLanguage = framework !== "unknown" && NON_JS_LANGUAGES.includes(framework);

  const isNonJs = !pkgRaw && framework !== "unknown";
  const needsManifests = isNonJs || isNonJsLanguage || files.includes("pubspec.yaml");
  const [
    requirements,
    pyprojectToml,
    gemfile,
    goMod,
    composerJson,
    cargoToml,
    pomXml,
    buildGradle,
    mixExs,
    pubspecYaml,
  ] = needsManifests
    ? await Promise.all([
        provider.readFile("requirements.txt").catch(() => null),
        provider.readFile("pyproject.toml").catch(() => null),
        provider.readFile("Gemfile").catch(() => null),
        provider.readFile("go.mod").catch(() => null),
        provider.readFile("composer.json").catch(() => null),
        provider.readFile("Cargo.toml").catch(() => null),
        provider.readFile("pom.xml").catch(() => null),
        provider
          .readFile("build.gradle.kts")
          .catch(() => null)
          .then((kts) => kts ?? provider.readFile("build.gradle").catch(() => null)),
        provider.readFile("mix.exs").catch(() => null),
        files.includes("pubspec.yaml")
          ? provider.readFile("pubspec.yaml").catch(() => null)
          : Promise.resolve(null),
      ])
    : [null, null, null, null, null, null, null, null, null, null];
  const nonJsManifests: NonJsManifests = {
    requirements,
    pyprojectToml,
    gemfile,
    goMod,
    composerJson,
    cargoToml,
    pomXml,
    buildGradle,
    mixExs,
    pubspecYaml,
  };

  if (treeTruncated(provider)) {
    warnings.push(
      "Repository file tree was truncated by GitHub — some missing items may not have been detected.",
    );
  }

  // Nothing to assess. Reported through the existing "unsupported repo" channel, which replaces
  // the score card with the reason rather than printing a number we have no basis for. The score
  // itself is forced to 0 at the return: it also reaches the dashboard card, the score badge and
  // the shareable launch report, none of which read warnings — leaving 100 there would have kept
  // the original contradiction alive everywhere except the one page that was fixed.
  const noApplication = noApplicationDetected(appRoot?.allFiles ?? files);
  if (noApplication) {
    warnings.push(`${UNSUPPORTED_STATIC_WEB_SCAN_PREFIX} ${NO_APPLICATION_DETECTED_MESSAGE}`);
  }

  if (appRoot) {
    const others =
      appRoot.otherAppDirs.length > 0
        ? ` Other apps found but not scanned: ${appRoot.otherAppDirs.slice(0, 4).join(", ")}${
            appRoot.otherAppDirs.length > 4 ? ", …" : ""
          }. Set the app directory in repo settings to scan a different one.`
        : "";
    warnings.push(
      `No application at the repository root — scanned \`${appRoot.appDir}\` instead.${others} Secret scanning still covers the whole repository. One-click fixes are placed beside the detected app when app-specific; repository-level files such as CI workflows remain at the root.`,
    );
  }

  const isStaticSite = isStaticWebRepo(files);
  const automatedFixSupported = isAutomatedFixSupported(files);

  if (isStaticSite) {
    warnings.push(
      "Static HTML/CSS/JS site — basic CI and secrets checks apply. Connect a full app repo for framework-specific fixes.",
    );
  } else if (!pkgRaw && !isNonJsLanguage) {
    warnings.push("No package.json found — only basic checks were run.");
  }

  if (!isSupportedFramework(framework) && !isNonJsLanguage && !isStaticSite && pkgRaw) {
    warnings.push(
      "Limited framework rules: full checks run for Next.js, Expo, React Native, Electron, Tauri, Vite, React, Express, and more.",
    );
  }

  const issues: IssueInput[] = [];
  const useAiFixes = Boolean(pkgRaw) && isSupportedFramework(jsFramework);

  if (automatedFixSupported) {
    const ciFixId = useAiFixes ? "ci-ai" : "github-actions";
    checkCI(files, issues, ciFixId, { severity: "high" });
    checkReadme(readmeRaw, issues, useAiFixes ? "readme-ai" : "readme");
  }

  const FRONTEND_FRAMEWORKS = new Set([
    "Vite",
    "React",
    "Vue",
    "Remix",
    "Astro",
    "Nuxt",
    "SvelteKit",
    "Svelte",
    "TanStack",
  ]);
  const BACKEND_FRAMEWORKS = new Set(["Hono", "Fastify", "Koa", "NestJS"]);

  let backendEntryContent = "";
  if (automatedFixSupported) {
    if (framework === "Next.js") {
      checkNextJs(deps, files, issues);
      checkMonitoring(deps, files, issues);
    } else if (FRONTEND_FRAMEWORKS.has(framework)) {
      checkVite(deps, files, issues);
      checkMonitoring(deps, files, issues);
    } else if (framework === "Express" || BACKEND_FRAMEWORKS.has(framework)) {
      const backendEntryPath = files.find(
        (f) => f === "src/index.ts" || f === "src/app.ts" || f === "index.ts" || f === "app.ts",
      );
      backendEntryContent = backendEntryPath
        ? ((await provider.readFile(backendEntryPath).catch(() => null)) ?? "")
        : "";
      checkExpress(deps, issues, files, backendEntryContent);
      checkMonitoring(deps, files, issues);
    } else if (pkgRaw) {
      checkMonitoring(deps, files, issues);
    }
    if (isMobileDesktopFramework(framework)) {
      checkPlatformLaunchReadiness(framework, files, issues);
    }
  }

  const stackDetected = detectStack(deps, files, framework);

  const auditorLang = auditorLanguageFromFramework(framework);
  const hasAuditorSources = pkgRaw || files.some((f) => auditorSourceExt(auditorLang).test(f));
  const auditorPaths = hasAuditorSources ? pickAuditorPaths(files, framework) : [];
  const auditorFileContents = hasAuditorSources ? await readFilesBatch(provider, auditorPaths) : {};

  // Repo-wide secret sweep.
  //
  // Every other content check is scoped to the app we resolved, which is correct — a CORS rule
  // for `apps/web` has nothing to say about `packages/ui`. Credentials are the exception: they
  // are language-agnostic, they are the single highest-consequence finding this product makes,
  // and they do not care which directory they were committed to. Scoping them to the app sample
  // meant a monorepo could hide a live key in a sibling package and score clean.
  //
  // Sampled separately from `auditorFileContents` (which may be empty, or narrowed to one app)
  // and unioned in below, so the sweep cannot be defeated by a detection miss upstream.
  const secretSweepContents = await sampleRepoForSecrets(
    appRoot?.rootProvider ?? provider,
    appRoot?.allFiles ?? files,
    new Set(
      Object.keys(auditorFileContents).map((path) =>
        appRoot ? `${appRoot.appDir}/${path}` : path,
      ),
    ),
  );

  // Workflow contents for dependency-audit check (small set — usually ≤5 files).
  const workflowPaths = files
    .filter(
      (f) => f.startsWith(".github/workflows/") && (f.endsWith(".yml") || f.endsWith(".yaml")),
    )
    .slice(0, 8);
  const workflowContents =
    workflowPaths.length > 0 ? await readFilesBatch(provider, workflowPaths) : {};

  // Dockerfiles are config, not source, so the auditor sample never picks them up — they have to
  // be asked for by name or the container checks silently see an empty repository.
  const dockerfilePaths = files.filter(isDockerfilePath).slice(0, 5);
  const dockerfileContents =
    dockerfilePaths.length > 0 ? await readFilesBatch(provider, dockerfilePaths) : {};

  const securityFileContents = {
    ...auditorFileContents,
    ...workflowContents,
    ...dockerfileContents,
  };

  // Read from the *whole* file list rather than the app directory, for the same reason the secret
  // sweep does: a monorepo's Go API and its Next front end each carry their own lockfile, and a
  // vulnerability in the one we did not pick is still a vulnerability at launch.
  const lockedDependencies = await collectDependencies((p) => provider.readFile(p), files);

  // Phase 1 — AST-backed unsafe-call detection. When enabled, the AST pass handles the JS/TS files
  // it can parse; the regex rule skips exactly those (no double-report, no coverage gap — a file the
  // parser can't handle is still covered by regex) and folds the AST hits into its one finding.
  let unsafeApiSkipFiles: ReadonlySet<string> | undefined;
  let unsafeApiAstHits: { file: string; line: number; label: string }[] | undefined;
  if (await isFeatureEnabled("flag_semantic_scanner")) {
    const { computeAstUnsafeCalls } = await import("../scanner/security/ast-checks");
    const astUnsafe = await computeAstUnsafeCalls(securityFileContents);
    unsafeApiSkipFiles = astUnsafe.handledFiles;
    unsafeApiAstHits = astUnsafe.hits;
  }

  // Production Security checks — content checks reuse auditor sample + workflow files.
  const securityCtx = {
    files,
    fileContents: securityFileContents,
    envExampleExists: envExampleRaw !== null,
    automatedFixSupported,
    envExampleFixId: "env-example-ai" as const,
    deps: pkgRaw ? deps : undefined,
    lockedDependencies,
    sourceContent: backendEntryContent,
    githubToken: opts.githubToken,
    repoOwner: opts.repoOwner,
    repoName: opts.repoName,
    unsafeApiSkipFiles,
    unsafeApiAstHits,
    secretSweepContents: secretSweepContents,
  };
  runSecurityChecks(securityCtx, issues);
  await runSecurityIntegrations(securityCtx, issues);

  if (pkgRaw && !isNonJsLanguage && automatedFixSupported) {
    checkTestScript(scripts, issues, useAiFixes ? "vitest-ai" : "vitest");
    checkLintScript(scripts, issues);
    checkDockerfile(files, issues, stackDetected.deployTargets);
    checkTypeScriptStrict(tsconfigRaw, issues);
  } else if (isNonJsLanguage && automatedFixSupported) {
    // Flutter (pubspec.yaml) is a mobile/desktop/web *client* — it has no HTTP server, so the
    // server-oriented checks (Dockerfile, health-check endpoint, HTTP security middleware) simply
    // don't apply and would be broken recommendations. Its dart test/lint checks still do. Swift
    // and Kotlin are intentionally not excluded here — they may be Vapor/Ktor/Spring servers.
    const isFlutterClient = framework === "Flutter";
    const platformHosted = stackDetected.deployTargets.some((t) =>
      ["Vercel", "Railway", "Render", "Netlify", "Fly.io", "Cloudflare"].includes(t),
    );
    if (!platformHosted && !isFlutterClient) {
      checkNonJsDockerfile(files, issues);
    }
    checkNonJsTesting(normalizeScannerLanguage(framework), files, nonJsManifests, issues);
    checkNonJsLinting(
      normalizeScannerLanguage(framework),
      files,
      {
        requirements: nonJsManifests.requirements,
        gemfile: nonJsManifests.gemfile,
        composerJson: nonJsManifests.composerJson,
        pomXml: nonJsManifests.pomXml,
        buildGradle: nonJsManifests.buildGradle,
        mixExs: nonJsManifests.mixExs,
      },
      issues,
    );
    if (!isFlutterClient) {
      checkNonJsHealthCheck(normalizeScannerLanguage(framework), files, issues);
      checkNonJsSecurityMiddleware(
        normalizeScannerLanguage(framework),
        files,
        nonJsManifests,
        issues,
        auditorFileContents,
      );
    }
  }

  const unique = dedupeIssues(issues);

  let merged = unique;
  if (hasAuditorSources && (await isFeatureEnabled("flag_code_auditor"))) {
    const auditorIssues = runAuditor({
      files,
      fileContents: auditorFileContents,
      envExampleContent: envExampleRaw,
      deps,
      framework,
      language: auditorLang,
      manifests: nonJsManifests,
    });
    merged = [
      ...unique,
      ...dedupeAuditorIssues(auditorIssues, new Set(unique.map((i) => i.fixId))),
    ];
  }

  // Phase 3 — capture per-file content hashes (git blob SHAs) + tree SHA for incremental rescans.
  let fileHashes: Record<string, string> | undefined;
  let gitSha: string | undefined;
  const incrementalOn = await isFeatureEnabled("flag_incremental_scan");
  if (incrementalOn) {
    const rich = provider as RichFileProvider;
    fileHashes = rich.fileHashes?.();
    gitSha = rich.treeSha?.();
  }

  // Phase 4 — build a cross-file dependency graph over the source files already sampled this scan.
  let dependencyGraph: SerializedGraph | undefined;
  if (await isFeatureEnabled("flag_dependency_graph")) {
    const { buildGraphFromSources, serializeGraph, deserializeGraph } = await import("../graph");
    const { getImportsExtractor } = await import("../graph/select.server");
    const { findCrossFileSecurityIssues } = await import("../graph/cross-file-findings");
    const { contentKey } = await import("../cache");
    const sources = Object.entries(auditorFileContents).map(([path, content]) => ({
      path,
      content,
    }));

    // Phase 11 — content-addressed graph cache within the process.
    const g = globalThis as { __lrGraphCache?: import("../cache").BoundedCache<SerializedGraph> };
    if (!g.__lrGraphCache) {
      const { BoundedCache } = await import("../cache");
      g.__lrGraphCache = new BoundedCache<SerializedGraph>(64);
    }
    const inputHashes = sources.map((s) => `${s.path}:${s.content.length}`);
    const cacheKey = contentKey({ ruleId: "dependency-graph", version: 1, inputHashes });
    dependencyGraph = await g.__lrGraphCache.computeIfAbsent(cacheKey, async () =>
      serializeGraph(
        await buildGraphFromSources(sources, { extractImports: await getImportsExtractor() }),
      ),
    );

    const crossFile = findCrossFileSecurityIssues(
      deserializeGraph(dependencyGraph),
      auditorFileContents,
    );
    if (crossFile.length > 0) {
      merged = dedupeIssues([...merged, ...crossFile]);
    }
  }

  let findings = enrichFindings(merged, { appInSubdirectory: appRoot !== null });

  // Phase 3 — carry forward findings for rules whose inputs did not change.
  //
  // Skipped entirely for a rebased scan. `fileHashes` are whole-repo and root-relative, while
  // this scan's findings were produced against paths relative to `appDir` — so a change to
  // `backend/main.py` would not match a rule manifest pattern written as `main.py`, the rule
  // would be judged unchanged, and a stale finding would be carried forward as current. A full
  // rescan of a subdirectory app is cheap; silently serving last week's security findings is not.
  if (incrementalOn && !appRoot && fileHashes && opts.priorIncremental?.fileHashes) {
    const {
      diffChangedFiles,
      changedPaths,
      requiresFullRescan,
      selectRulesToRerun,
      mergeCarryForward,
    } = await import("./incremental");
    const { DEFAULT_SCAN_RULE_MANIFEST, ruleIdForFixId } = await import("./rule-manifest");
    const diff = diffChangedFiles(opts.priorIncremental.fileHashes, fileHashes);
    const changed = changedPaths(diff);
    if (changed.length > 0 && !requiresFullRescan(changed)) {
      const rerunIds = selectRulesToRerun(changed, DEFAULT_SCAN_RULE_MANIFEST);
      const known = new Set(DEFAULT_SCAN_RULE_MANIFEST.map((s) => s.ruleId));
      // Unknown fixIds always rerun (treated as fresh).
      const freshTagged = findings.map((f) => ({
        ...f,
        ruleId: ruleIdForFixId(f.fixId),
      }));
      const reranFindings = freshTagged.filter(
        (f) => rerunIds.includes(f.ruleId) || !known.has(f.ruleId),
      );
      const mergedFindings = mergeCarryForward(opts.priorIncremental.findings, reranFindings, [
        ...rerunIds,
        ...freshTagged.filter((f) => !known.has(f.ruleId)).map((f) => f.ruleId),
      ]);
      findings = mergedFindings.map(({ ruleId: _r, ...rest }) => rest);
      merged = findings.map((f) => ({
        category: f.category,
        title: f.title,
        severity: f.severity,
        why: f.why,
        timeSaved: f.timeSaved,
        fixId: f.fixId,
        checkedFor: f.checkedFor,
        foundEvidence: f.foundEvidence,
        confidence: f.confidence,
        recommendedFix: f.recommendedFix,
        aiEffort: f.aiEffort,
        detection: f.detection,
        verifiedAt: f.verifiedAt,
      }));
    }
  }

  const { overallScore, categoryScores } = computeReadinessScore(findings);

  const checklist = buildLaunchChecklist(stackDetected, findings);

  // Phase 2 knowledge inputs — language-agnostic facts the caller persists (flag-gated) per repo.
  const knowledgeInput: KnowledgeExtractionInput = {
    framework,
    language: isNonJsLanguage
      ? framework
      : tsconfigRaw
        ? "TypeScript"
        : pkgRaw
          ? "JavaScript"
          : "unknown",
    files,
    deps,
    scripts,
    engines: (pkg.engines as Record<string, string> | undefined) ?? undefined,
  };

  return {
    score: noApplication ? 0 : overallScore,
    framework,
    issues: merged,
    findings,
    categoryScores,
    stackDetected,
    checklist,
    warnings,
    knowledgeInput,
    fileHashes,
    gitSha,
    dependencyGraph,
  };
}
