import {
  analyzeProjectCi,
  buildProjectCiWorkflow,
  pendingScriptsFromFixIds,
  projectUsesTypeScript,
  type PackageJsonForCi,
} from "./project-ci.server";
import { buildLanguageCiWorkflow, supportsDeterministicLanguageCi } from "./project-ci-lang.server";
import type { ProjectIntelligence, WorkspacePackage } from "./project-intelligence.server";
import type { ProjectLanguage } from "./project-context.server";
import { stripCodeFence } from "./ai-output-sanitize";

/** Strip AI habits that make CI decorative instead of blocking. */
export function sanitizeCiWorkflow(yaml: string): string {
  let y = stripCodeFence(yaml);
  y = y.replace(/^\s*continue-on-error:\s*true\s*$/gim, "");
  return y.trimEnd() + "\n";
}

export function assertCiWorkflowStrict(yaml: string): void {
  if (/continue-on-error:\s*true/i.test(yaml)) {
    throw new Error("CI workflow must not use continue-on-error on quality gates");
  }
}

export function finalizeCiWorkflow(yaml: string): string {
  const cleaned = sanitizeCiWorkflow(yaml);
  assertCiWorkflowStrict(cleaned);
  return cleaned;
}

/** Project-aware CI — Node uses package.json scripts; other languages use manifest-driven workflows. */
export function buildDeterministicCiWorkflow(
  files: Record<string, string>,
  opts?: { framework?: string; fixIds?: string[] },
): string {
  const language = files["__language"] ?? (files["package.json"] ? "node" : "unknown");

  if (
    language !== "node" &&
    language !== "unknown" &&
    supportsDeterministicLanguageCi(language as ProjectLanguage)
  ) {
    const ctx = minimalContextFromAiFiles(files, opts?.framework);
    const wf = buildLanguageCiWorkflow(ctx);
    if (wf) {
      assertCiWorkflowStrict(wf);
      return wf;
    }
  }

  const nvmrc = files[".nvmrc"]?.trim().replace(/^v/, "").match(/\d+/)?.[0];
  let pkg: PackageJsonForCi = {
    scripts: {},
    dependencies: {},
    devDependencies: {},
    nodeVersion: nvmrc ?? files["__node_engine"]?.match(/\d+/)?.[0] ?? "20",
  };
  try {
    const raw = JSON.parse(files["package.json"] ?? "{}") as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      engines?: { node?: string };
      packageManager?: string;
    };
    const rawNode = raw.engines?.node ?? pkg.nodeVersion;
    pkg = {
      scripts: raw.scripts ?? {},
      dependencies: raw.dependencies ?? {},
      devDependencies: raw.devDependencies ?? {},
      nodeVersion: rawNode.match(/\d+/)?.[0] ?? pkg.nodeVersion,
      packageManager: raw.packageManager,
    };
  } catch {
    /* keep defaults */
  }

  const filePaths = files["__file_paths"]?.split("\n").filter(Boolean) ?? [];
  const lockPm = files["__package_manager"];
  const packageManager =
    lockPm === "pnpm" || lockPm === "yarn" || lockPm === "bun" ? lockPm : "npm";

  const pending = pendingScriptsFromFixIds(opts?.fixIds ?? []);
  if (!projectUsesTypeScript(pkg, filePaths)) {
    delete pending.typecheck;
  }

  const profile = analyzeProjectCi({
    pkg,
    framework: opts?.framework ?? "unknown",
    filePaths,
    packageManager,
    pendingScripts: pending,
    productionBaseline: true,
    envContract: buildEnvContractFromAiFiles(files),
    isStaticSpa: files["__is_static_spa"] === "true",
    hasPlaywright: files["__has_playwright"] === "true",
  });

  const wf = buildProjectCiWorkflow(
    profile,
    minimalContextFromAiFiles(files, opts?.framework).intelligence,
  );
  assertCiWorkflowStrict(wf);
  return wf;
}

export function shouldUseDeterministicCi(files: Record<string, string>): boolean {
  const language = files["__language"];
  if (
    language &&
    language !== "unknown" &&
    supportsDeterministicLanguageCi(language as ProjectLanguage)
  ) {
    return true;
  }
  return Boolean(files["package.json"]);
}

function parseCiPackages(files: Record<string, string>): WorkspacePackage[] {
  const raw = files["__ci_packages"];
  if (!raw) return [];
  try {
    return JSON.parse(raw) as WorkspacePackage[];
  } catch {
    return [];
  }
}

function minimalContextFromAiFiles(
  files: Record<string, string>,
  framework?: string,
): import("./project-context.server").ProjectContext {
  const language = (files["__language"] ??
    "unknown") as import("./project-context.server").ProjectLanguage;
  const filePaths = files["__file_paths"]?.split("\n").filter(Boolean) ?? [];
  return {
    fullName: "",
    framework: framework ?? files["__framework"] ?? "unknown",
    resolvedFramework: files["__framework"] ?? framework ?? "unknown",
    language,
    isNodeProject: language === "node",
    packageManager: (files["__package_manager"] as "npm") ?? "npm",
    filePaths,
    pkg: {
      scripts: {},
      nodeVersion: files["__node_engine"]?.match(/\d+/)?.[0] ?? "20",
      hasBackend: false,
      dependencies: {},
      devDependencies: {},
    },
    mergedDeps: {},
    stack: {
      frameworks: [],
      services: [],
      deployTargets: [],
      profile: files["__profile"] ?? "General",
    },
    manifests: {
      goMod: files["go.mod"],
      gemfile: files["Gemfile"],
      requirements: files["requirements.txt"],
      pyprojectToml: files["pyproject.toml"],
      pipfile: files["Pipfile"],
      cargoToml: files["Cargo.toml"],
      composerJson: files["composer.json"],
      pomXml: files["pom.xml"],
      buildGradle: files["build.gradle"],
      makefile: files["Makefile"],
    },
    usesTypeScript: files["__uses_typescript"] === "true",
    usesReact: files["__uses_react"] === "true",
    hasExpress: files["__has_express"] === "true",
    isStaticSpa: files["__is_static_spa"] === "true",
    hasNextAppRouter: false,
    hasExistingCi: files["__has_ci"] === "true",
    hasExistingDockerfile: files["__has_dockerfile"] === "true",
    deployConfigs: files["__deploy_configs"]?.split(", ") ?? [],
    envVars: files["detected_env_vars"]?.split(", ") ?? [],
    intelligence: {
      monorepo: files["__monorepo"] === "true",
      packages: parseCiPackages(files),
      envContract: buildEnvContractFromAiFiles(files),
      integrations: {
        stripe: /stripe/i.test(files["__integrations"] ?? ""),
        firebase: /firebase/i.test(files["__integrations"] ?? ""),
        supabase: /supabase/i.test(files["__integrations"] ?? ""),
        prisma: /prisma/i.test(files["__integrations"] ?? ""),
        auth: /auth/i.test(files["__integrations"] ?? ""),
        hasWebhooks: false,
        signals: files["__integrations"]?.split(", ") ?? [],
      },
      structure: {
        entryPoints: [],
        routePaths: files["__routes"]?.split("\n") ?? [],
        apiPaths: files["__api_paths"]?.split("\n") ?? [],
        componentPaths: [],
      },
      codeSamples: [],
      runtimeModel: (files["__runtime_model"] as ProjectIntelligence["runtimeModel"]) ?? "unknown",
    },
  };
}

function buildEnvContractFromAiFiles(files: Record<string, string>) {
  const build = files["__env_build"]?.split(", ").filter(Boolean) ?? [];
  const test = files["__env_test"]?.split(", ").filter(Boolean) ?? [];
  const all = [...new Set([...build, ...test, ...(files["detected_env_vars"]?.split(", ") ?? [])])];
  return { build, test, runtime: test, all, refs: [] };
}
