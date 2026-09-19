import {
  buildProjectContext,
  getToolApplicability,
  isEslintFullyConfigured,
  type ProjectContext,
} from "../../project-context.server";
import { FIX_IDS_WITHOUT_GENERATOR } from "../../fix-tool-catalog";
import {
  expandFixIdsForProductionCi,
  pendingScriptsFromFixIds,
  analyzeProjectCi,
  buildProjectCiWorkflow,
} from "../../project-ci.server";
import { fetchFileContent } from "../github";
import {
  extractJavaPackage,
  extractKotlinPackage,
  javaSourcePath,
  kotlinSourcePath,
  rewriteJavaPackage,
  rewriteKotlinPackage,
  pickJavaApplicationPath,
  pickKotlinApplicationPath,
  detectPhpFramework,
  detectRustFramework,
} from "../../backend-patch.server";
import { buildFixPreviewInsight } from "../../fix-preview-insight.server";
import { MIDDLEWARE_RUST, MIDDLEWARE_ACTIX_RUST } from "./languages/rust/templates";
import type { AiTestFile, CollectResult, VerificationNote } from "../types";
import type { PkgMods } from "../github";
import type { FixCtx } from "./shared/fix-ctx";

import {
  handleVitest,
  handlePlaywright,
  handleVitestAi,
  handleXunitAi,
  handlePlaywrightAi,
  handleApiTests,
} from "./fix-handlers/testing";
import { handleGithubActions, handleCiAi, handleDependencyAuditCi } from "./fix-handlers/ci";
import {
  handleEslint,
  handlePrettier,
  handleTsStrict,
  handlePytest,
  handleRuff,
  handleRspec,
  handleRubocop,
  handleGolangciLint,
  handlePhpunit,
  handlePhpcs,
  handleCheckstyle,
  handleCredo,
} from "./fix-handlers/code-quality";
import { handleDockerfile } from "./fix-handlers/docker";
import {
  handleDockerRootUser,
  handleWorkflowPermissions,
  handleWorkflowUnpinnedAction,
} from "./fix-handlers/hardening";
import { handleGitignoreEnv, handleErrorBoundary, handleDbPool } from "./fix-handlers/misc";
import {
  handleHelmet,
  handleRateLimit,
  handleCors,
  handleLogger,
  handleCookieFlags,
  handleCsrf,
  handleHttpsRedirect,
} from "./fix-handlers/security-middleware";
import {
  handleMonitoring,
  finalizeMonitoringManifests,
  wireMonitoringEntry,
} from "./fix-handlers/monitoring";
import { handleHealthCheck } from "./fix-handlers/health-check";
import { handleAuditorStripeWebhook, handleAuditorEnvGap } from "./fix-handlers/auditors";

import { wirePythonEntry } from "./entry-wiring/python";
import { wireJvmEntry } from "./entry-wiring/jvm";
import { wireGoEntry } from "./entry-wiring/go";
import { wireRubyEntry } from "./entry-wiring/ruby";
import { wirePhpEntry } from "./entry-wiring/php";
import { wireRustEntry } from "./entry-wiring/rust";
import { wireCsharpEntry } from "./entry-wiring/csharp";
import { wireElixirEntry } from "./entry-wiring/elixir";
import { wireExpressMiddleware } from "./entry-wiring/express";
import { wireFetchServerMiddleware } from "./entry-wiring/fetch-server";

import {
  applyEnvExample,
  applyReadme,
  mergeGeneratedArtifacts,
  applyCrossCuttingPatches,
} from "./finalize";

/**
 * Files that belong at the repository root even when the app is in a subdirectory.
 *
 * GitHub only reads workflows from the root `.github/workflows/`. A README and a `.env.example`
 * describe the repository as a whole, `.gitignore` is honoured recursively, and licence and
 * editor files are repo-level by convention.
 */
const ALWAYS_ROOT =
  /^(\.github\/|README(\.md)?$|LICENSE|\.gitignore$|\.env\.example$|\.editorconfig$)/i;

/** See the comment on `add` in `collectFixFiles`. Exported for direct unit cover. */
export function placeGeneratedFile(
  path: string,
  appDir: string | null,
  repoPaths: ReadonlySet<string>,
): string {
  if (!appDir) return path;
  const clean = path.replace(/^\.?\//, "");
  if (ALWAYS_ROOT.test(clean)) return clean;
  // Already an absolute repo path the handler discovered — leave it alone.
  if (clean === appDir || clean.startsWith(`${appDir}/`)) return clean;
  if (repoPaths.has(clean)) return clean;
  return `${appDir}/${clean}`;
}

/**
 * Split from the original monolithic body.ts — behavior-preserving. This function used to
 * contain the entire per-fixId switch and post-loop wiring inline (~2,300 lines); that logic
 * now lives in fix-handlers/, entry-wiring/, and finalize.ts, grouped by tool/language/concern.
 * This file keeps only the dispatch shape: build the shared closure state once (as `fx`), loop
 * over requested fixIds, and call the matching handler. Case labels are preserved verbatim
 * (including the no-op/fallthrough ones) so fix-tool-matrix.test.ts's switch-case scan still
 * finds every fix id handled here.
 */
export async function collectFixFiles(
  token: string,
  fullName: string,
  fixIds: string[],
  opts?: {
    framework?: string;
    repoName?: string;
    aiFiles?: AiTestFile[];
    auditorTargetPaths?: Partial<Record<string, string>>;
  },
): Promise<CollectResult> {
  const framework = opts?.framework ?? "unknown";
  const repoName = opts?.repoName ?? fullName.split("/")[1] ?? "project";
  const aiFiles = opts?.aiFiles;

  const fileMap = new Map<string, string>();
  const pkgMods: PkgMods = { scripts: {}, deps: {}, devDeps: {} };
  const gitignoreAppends: string[] = [];
  const readmeSections: string[] = [];
  const verificationNotes: VerificationNote[] = [];

  const note = (fixId: string, status: "verified" | "warning", text: string) =>
    verificationNotes.push({ fixId, status, note: text });

  const ctx: ProjectContext = await buildProjectContext(token, fullName, framework);

  /**
   * Place a generated file, accounting for apps that don't live at the repository root.
   *
   * Handlers pass two different kinds of path and both have to keep working:
   *   - a constant (`"Dockerfile"`, `"health.py"`, `"playwright.config.ts"`) — must be written
   *     beneath the app, or it configures a directory the app isn't in;
   *   - a path discovered from the repo tree (`entryPoint`, `configPath`, an auditor target)
   *     — already absolute from the repository root, so prefixing would produce
   *     `backend/backend/app/main.py`.
   *
   * Distinguishing them by name would mean auditing every handler forever. Instead the two are
   * told apart by fact: a path that already exists in the repo, or already sits under the app
   * directory, is left exactly as the handler asked for.
   */
  const repoPathSet = new Set(ctx.filePaths);
  const add = (path: string, content: string) => {
    fileMap.set(placeGeneratedFile(path, ctx.appDir ?? null, repoPathSet), content);
  };
  const { fixIds: effectiveFixIds, bundled } = expandFixIdsForProductionCi(fixIds, {
    isNodeProject: ctx.isNodeProject,
    scripts: ctx.pkg.scripts,
    eslintConfigured: isEslintFullyConfigured(ctx),
  });
  const pkgMeta = ctx.pkg;
  const pm = ctx.packageManager;
  const repoFilePaths = ctx.filePaths;

  const mergedDeps = ctx.mergedDeps;
  const fw = ctx.resolvedFramework;

  let javaBasePackage = "com.example";
  let javaApplicationPath: string | null = null;
  if (ctx.language === "java") {
    javaApplicationPath = pickJavaApplicationPath(repoFilePaths);
    if (javaApplicationPath) {
      const appSrc = await fetchFileContent(token, fullName, javaApplicationPath);
      const pkg = appSrc ? extractJavaPackage(appSrc) : null;
      if (pkg) javaBasePackage = pkg;
    }
  }
  const addJava = (sub: string, className: string, template: string) => {
    const pkg = sub ? `${javaBasePackage}.${sub}` : javaBasePackage;
    add(javaSourcePath(pkg, className), rewriteJavaPackage(template, javaBasePackage));
  };

  let kotlinBasePackage = "com.example";
  let kotlinApplicationPath: string | null = null;
  if (ctx.language === "kotlin") {
    kotlinApplicationPath = pickKotlinApplicationPath(repoFilePaths);
    if (kotlinApplicationPath) {
      const appSrc = await fetchFileContent(token, fullName, kotlinApplicationPath);
      const pkg = appSrc ? extractKotlinPackage(appSrc) : null;
      if (pkg) kotlinBasePackage = pkg;
    }
  }
  const addKotlin = (sub: string, className: string, template: string) => {
    const pkg = sub ? `${kotlinBasePackage}.${sub}` : kotlinBasePackage;
    add(kotlinSourcePath(pkg, className), rewriteKotlinPackage(template, kotlinBasePackage));
  };

  const ciProfileInput = () =>
    analyzeProjectCi({
      pkg: {
        scripts: { ...pkgMeta.scripts, ...pkgMods.scripts },
        dependencies: { ...pkgMeta.dependencies, ...pkgMods.deps },
        devDependencies: { ...pkgMeta.devDependencies, ...pkgMods.devDeps },
        nodeVersion: pkgMeta.nodeVersion,
        packageManager: pkgMeta.packageManager,
      },
      framework: fw,
      filePaths: repoFilePaths,
      packageManager: pm,
      pendingScripts: pendingScriptsFromFixIds(effectiveFixIds),
      productionBaseline: effectiveFixIds.some((id) => id === "github-actions" || id === "ci-ai"),
      envVars: ctx.envVars,
      envContract: ctx.intelligence.envContract,
      isStaticSpa: ctx.isStaticSpa,
      hasPlaywright:
        effectiveFixIds.some((id) => id === "playwright" || id === "playwright-ai") ||
        repoFilePaths.some((p) => /playwright\.config\.(ts|js|mjs)/.test(p)),
    });

  const buildCiYaml = (profile: ReturnType<typeof ciProfileInput>) =>
    buildProjectCiWorkflow(profile, ctx.intelligence);

  const phpFw =
    ctx.language === "php"
      ? detectPhpFramework(repoFilePaths, ctx.manifests.composerJson)
      : "unknown";
  const rustFwHint = detectRustFramework("", ctx.manifests.cargoToml);
  const rustMiddlewareSrc = rustFwHint === "actix" ? MIDDLEWARE_ACTIX_RUST : MIDDLEWARE_RUST;

  const fx: FixCtx = {
    token,
    fullName,
    fixIds,
    effectiveFixIds,
    opts,
    framework,
    repoName,
    aiFiles,
    fileMap,
    pkgMods,
    gitignoreAppends,
    readmeSections,
    verificationNotes,
    add,
    note,
    ctx,
    pkgMeta,
    pm,
    repoFilePaths,
    mergedDeps,
    fw,
    javaBasePackage,
    javaApplicationPath,
    addJava,
    kotlinBasePackage,
    kotlinApplicationPath,
    addKotlin,
    ciProfileInput,
    buildCiYaml,
    phpFw,
    rustFwHint,
    rustMiddlewareSrc,
    bundled,
  };

  for (const fixId of effectiveFixIds) {
    const applicability = getToolApplicability(fixId, ctx);
    if (!applicability.applicable) {
      note(fixId, "warning", applicability.reason ?? `Skipped for ${ctx.resolvedFramework}`);
      continue;
    }

    switch (fixId) {
      case "vitest":
        handleVitest(fx);
        break;

      case "playwright":
        await handlePlaywright(fx);
        break;

      case "github-actions":
        await handleGithubActions(fx);
        break;

      case "ci-ai":
        await handleCiAi(fx);
        break;

      case "dependency-audit-ci":
        await handleDependencyAuditCi(fx);
        break;

      case "readme-ai":
      case "env-example-ai":
      case "auditor-todo-markers":
        // Handled by AI in generateAiTests — no template output needed here
        break;

      case "eslint":
        handleEslint(fx);
        break;

      case "prettier":
        handlePrettier(fx);
        break;

      case "workflow-permissions":
        await handleWorkflowPermissions(fx);
        break;

      case "workflow-unpinned-action":
        await handleWorkflowUnpinnedAction(fx);
        break;

      case "docker-root-user":
        await handleDockerRootUser(fx);
        break;

      case "dockerfile":
        await handleDockerfile(fx);
        break;

      case "env-example":
        // .env.example content built below after env var scan
        break;

      case "gitignore-env":
        handleGitignoreEnv(fx);
        break;

      case "readme":
        // Readme content built below after detecting package manager
        break;

      case "error-boundary":
        handleErrorBoundary(fx);
        break;

      case "monitoring":
        handleMonitoring(fx);
        break;

      case "db-pool":
        handleDbPool(fx);
        break;

      case "helmet":
        handleHelmet(fx);
        break;

      case "rate-limit":
        handleRateLimit(fx);
        break;

      case "cors":
        handleCors(fx);
        break;

      case "logger":
        handleLogger(fx);
        break;

      case "security-cookie-flags":
        handleCookieFlags(fx);
        break;

      case "security-csrf":
        handleCsrf(fx);
        break;

      case "https-redirect":
        handleHttpsRedirect(fx);
        break;

      case "vitest-ai":
        handleVitestAi(fx);
        break;

      case "xunit-ai":
        await handleXunitAi(fx);
        break;

      case "playwright-ai":
        await handlePlaywrightAi(fx);
        break;

      case "api-tests":
        handleApiTests(fx);
        break;

      case "ts-strict":
        await handleTsStrict(fx);
        break;

      case "health-check":
        await handleHealthCheck(fx);
        break;

      case "pytest":
      case "pytest-ai":
        await handlePytest(fx, fixId);
        break;

      case "ruff":
        await handleRuff(fx);
        break;

      case "rspec":
        handleRspec(fx);
        break;

      case "rubocop":
        handleRubocop(fx);
        break;

      case "golangci-lint":
        handleGolangciLint(fx);
        break;

      case "phpunit":
        handlePhpunit(fx);
        break;

      case "phpcs":
        handlePhpcs(fx);
        break;

      case "checkstyle":
        handleCheckstyle(fx);
        break;

      case "credo":
        handleCredo(fx);
        break;

      case "auditor-stripe-webhook":
        await handleAuditorStripeWebhook(fx, fixId);
        break;

      case "auditor-env-undocumented":
      case "auditor-env-gap":
        await handleAuditorEnvGap(fx, fixId);
        break;
    }
  }

  await applyEnvExample(fx);
  await finalizeMonitoringManifests(fx);
  applyReadme(fx);
  await mergeGeneratedArtifacts(fx);

  // ── Entry-point wiring ────────────────────────────────────────────────────
  await wireMonitoringEntry(fx);
  await wirePythonEntry(fx);
  wireJvmEntry(fx);
  await wireGoEntry(fx);
  await wireRubyEntry(fx);
  await wirePhpEntry(fx);
  await wireRustEntry(fx);
  await wireCsharpEntry(fx);
  await wireElixirEntry(fx);
  await wireExpressMiddleware(fx);
  await wireFetchServerMiddleware(fx);

  await applyCrossCuttingPatches(fx);

  // A requested fix with no generator must say so. security-csrf is reportable by the scanner and
  // included in the Security Hardening Pack, but nothing in fix-executor/ produces output for it —
  // so it contributed no file and no note, and the PR simply came back without the CSRF half.
  for (const id of effectiveFixIds) {
    if (FIX_IDS_WITHOUT_GENERATOR.has(id)) {
      note(
        id,
        "warning",
        `No automated fix exists for "${id}" yet — it was not applied. Address it manually.`,
      );
    }
  }

  const files = [...fileMap.entries()].map(([path, content]) => ({ path, content }));

  const { runFixPreflight } = await import("../../fix-preflight.server");
  const preflight = runFixPreflight({
    files,
    ctx,
    fixIds: effectiveFixIds,
    repoFilePaths,
    verificationNotes,
  });
  if (!preflight.passed) {
    for (const b of preflight.blockers) {
      note(b.fixId ?? "preflight", "warning", b.message);
    }
  } else if (preflight.warnings.length === 0 && files.length > 0) {
    note("preflight", "verified", "Preflight passed — output ready for PR");
  }

  return {
    files,
    verificationNotes,
    preflight,
    previewInsight: buildFixPreviewInsight(ctx, fixIds, verificationNotes),
  };
}
