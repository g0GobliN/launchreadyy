/**
 * Static preflight — catch CI-breaking output before a PR opens.
 * Complements fix-recovery (post-CI) with verify-before-ship.
 */

import type { ProjectContext } from "./project-context.server";
import { validateGeneratedFile } from "./fix-validation";
import { viteConfigNeedsEsmFix } from "./vite-esm-config";

export interface PreflightVerificationNote {
  fixId: string;
  status: string;
  note: string;
}

export interface PreflightIssue {
  code: string;
  message: string;
  fixId?: string;
  path?: string;
  severity: "blocker" | "warning";
}

export interface PreflightResult {
  passed: boolean;
  blockers: PreflightIssue[];
  warnings: PreflightIssue[];
}

function parsePkg(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pkgPathForViteConfig(configPath: string): string {
  const dir = configPath.includes("/")
    ? configPath.replace(/\/vite\.config\.(js|cjs|mjs|ts|mts)$/, "")
    : ".";
  return dir === "." ? "package.json" : `${dir}/package.json`;
}

/** Vite CJS config without type=module breaks test/build/e2e in CI. */
function checkViteEsm(
  files: Map<string, string>,
  repoFilePaths: string[],
  fixIds: string[],
): PreflightIssue[] {
  const hasCi = fixIds.some((id) => id === "ci-ai" || id === "github-actions");
  if (!hasCi) return [];

  const issues: PreflightIssue[] = [];
  const configs = repoFilePaths.filter(
    (p) => /(^|\/)vite\.config\.(js|cjs)$/.test(p) && !p.includes("node_modules"),
  );

  for (const configPath of configs) {
    const pkgPath = pkgPathForViteConfig(configPath);
    const pkgContent = files.get(pkgPath) ?? null;
    let pkgType: string | undefined;
    let devDeps: Record<string, string> = {};

    if (pkgContent) {
      const pkg = parsePkg(pkgContent);
      if (pkg) {
        pkgType = pkg.type as string | undefined;
        devDeps = {
          ...(pkg.dependencies as Record<string, string> | undefined),
          ...(pkg.devDependencies as Record<string, string> | undefined),
        };
      }
    }

    const configInOutput = files.get(configPath);
    const configContent = configInOutput ?? "";
    const fileName = configPath.split("/").pop() ?? configPath;

    if (pkgType === "module") continue;
    if (files.has(pkgPath) && pkgType === "module") continue;

    const needsFix = viteConfigNeedsEsmFix(
      fileName,
      configContent || "import { defineConfig } from 'vite'",
      pkgType,
      devDeps.vitest || devDeps.vite ? devDeps : { vitest: "^3.0.0", vite: "^6.0.0" },
    );

    if (needsFix && pkgType !== "module") {
      const patched = files.has(pkgPath) && parsePkg(files.get(pkgPath)!)?.type === "module";
      if (!patched) {
        issues.push({
          code: "vite-esm",
          severity: "blocker",
          path: pkgPath,
          fixId: "ci-ai",
          message: `${pkgPath} needs "type": "module" for ${configPath} (Vite/Vitest ESM). Re-generate fix to auto-patch.`,
        });
      }
    }
  }
  return issues;
}

function checkPackageJsonFiles(files: Map<string, string>): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  for (const [path, content] of files) {
    if (!path.endsWith("package.json")) continue;
    if (!parsePkg(content)) {
      issues.push({
        code: "invalid-package-json",
        severity: "blocker",
        path,
        message: `Generated ${path} is not valid JSON`,
      });
    }
  }
  return issues;
}

function checkGeneratedFileValidation(files: Map<string, string>): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  for (const [path, content] of files) {
    const v = validateGeneratedFile(path, content);
    if (v.status === "invalid") {
      issues.push({
        code: "invalid-generated-file",
        severity: "blocker",
        path,
        message: v.detail ?? `Invalid generated file: ${path}`,
      });
    }
  }
  return issues;
}

function checkCiLintScript(
  files: Map<string, string>,
  fixIds: string[],
  ctx: ProjectContext,
): PreflightIssue[] {
  if (
    !fixIds.includes("eslint") &&
    !fixIds.some((id) => id === "ci-ai" || id === "github-actions")
  ) {
    return [];
  }
  const rootPkg = files.get("package.json");
  if (!rootPkg) return [];
  const pkg = parsePkg(rootPkg);
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  if (!scripts.lint?.trim() && fixIds.includes("eslint")) {
    return [
      {
        code: "missing-lint-script",
        severity: "blocker",
        path: "package.json",
        fixId: "eslint",
        message: "ESLint fix did not add scripts.lint to package.json",
      },
    ];
  }
  if (ctx.intelligence.monorepo) {
    const missing: string[] = [];
    for (const p of ctx.intelligence.packages) {
      if (!p.hasLint && p.hasBuild) continue;
      const pkgPath = p.dir === "." ? "package.json" : `${p.dir}/package.json`;
      const content = files.get(pkgPath);
      if (!content) continue;
      const parsed = parsePkg(content);
      const lint = (parsed?.scripts as Record<string, string> | undefined)?.lint;
      if (!lint?.trim() && p.hasLint) {
        missing.push(pkgPath);
      }
    }
    if (missing.length > 0) {
      return [
        {
          code: "monorepo-lint-gap",
          severity: "warning",
          message: `Lint script missing in workspace packages: ${missing.join(", ")}`,
        },
      ];
    }
  }
  return [];
}

/**
 * Placement guard for apps that don't live at the repository root.
 *
 * `collectFixFiles` rewrites generated paths to sit beneath `ctx.appDir`. This verifies the
 * result rather than trusting it: a handler that bypasses `add()`, or a new output that the
 * root-file allowlist wrongly matches, would otherwise commit a Dockerfile to a repository root
 * that has no application in it — a PR that cannot work.
 *
 * Only build/config files are checked. Repo-level files (workflows, README, .gitignore,
 * .env.example) are correct at the root by design.
 */
const ROOT_LEGITIMATE =
  /^(\.github\/|README(\.md)?$|LICENSE|\.gitignore$|\.env\.example$|\.editorconfig$)/i;

function checkSubdirectoryPlacement(
  files: { path: string; content: string }[],
  ctx: ProjectContext,
): PreflightIssue[] {
  const appDir = ctx.appDir;
  if (!appDir) return [];

  const stray = files
    .map((f) => f.path.replace(/^\.?\//, ""))
    .filter((p) => !ROOT_LEGITIMATE.test(p))
    .filter((p) => p !== appDir && !p.startsWith(`${appDir}/`))
    // A file that already exists elsewhere in the repo is an intentional in-place patch.
    .filter((p) => !ctx.filePaths.includes(p));

  if (stray.length === 0) return [];
  return [
    {
      code: "generated-file-outside-app-dir",
      severity: "blocker",
      message: `This repo's app is in \`${appDir}\`, but ${stray.slice(0, 5).join(", ")} would be committed to the repository root, where it would not apply to the app.`,
    },
  ];
}

function warningsFromVerificationNotes(notes: PreflightVerificationNote[]): PreflightIssue[] {
  return notes
    .filter((n) => n.status === "warning")
    .map((n) => ({
      code: "verification-warning",
      severity: "warning" as const,
      fixId: n.fixId,
      message: n.note,
    }));
}

export function runFixPreflight(opts: {
  files: { path: string; content: string }[];
  ctx: ProjectContext;
  fixIds: string[];
  repoFilePaths: string[];
  verificationNotes?: PreflightVerificationNote[];
}): PreflightResult {
  const fileMap = new Map(opts.files.map((f) => [f.path, f.content]));
  const blockers: PreflightIssue[] = [
    ...checkPackageJsonFiles(fileMap),
    ...checkGeneratedFileValidation(fileMap),
    ...checkViteEsm(fileMap, opts.repoFilePaths, opts.fixIds),
    ...checkCiLintScript(fileMap, opts.fixIds, opts.ctx).filter((i) => i.severity === "blocker"),
    ...checkSubdirectoryPlacement(opts.files, opts.ctx),
  ];
  const warnings: PreflightIssue[] = [
    ...checkCiLintScript(fileMap, opts.fixIds, opts.ctx).filter((i) => i.severity === "warning"),
    ...warningsFromVerificationNotes(opts.verificationNotes ?? []),
  ];

  const seen = new Set<string>();
  const dedupe = (list: PreflightIssue[]) =>
    list.filter((i) => {
      const k = `${i.code}:${i.path ?? ""}:${i.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  const b = dedupe(blockers);
  const w = dedupe(warnings);
  return { passed: b.length === 0, blockers: b, warnings: w };
}

export function preflightBlockMessage(result: PreflightResult): string {
  if (result.passed) return "";
  const lines = result.blockers.map((b) => `• ${b.message}`);
  return `Preflight failed — PR blocked until fixed:\n${lines.join("\n")}`;
}
