/**
 * Capability 6 — verify-before-PR loop.
 * Runs sandboxed install/build/lint against candidate fix files.
 * Failure after bounded retries blocks the PR entirely.
 */

import { getSandboxAdapter } from "../adapters/sandbox";
import {
  detectSandboxCommands,
  detectSandboxEcosystem,
  sandboxImageSupports,
} from "../sandbox/commands";
import { mergeEnvVars, parseEnvExampleLiterals } from "../sandbox/env-placeholder";
import { repoPath } from "../sandbox/build-settings";
import { getProjectBuildSettings } from "../sandbox/build-settings.server";
import { loadDecryptedProjectEnvVars } from "../sandbox/project-env-vars.server";
import { isFeatureEnabled } from "../site-config.server";
import { SANDBOX_TIMEOUT_MS } from "../fix-meta";
import { stepsToIssues } from "./index";
import { classifyFailure, type VerifyFailureCategory } from "./failure-classify";
import { resolveSandboxNodeVersion, resolveExactNodeVersion } from "../sandbox/node-version";
import type { SandboxStepResult } from "../adapters/sandbox";

export type VerifyBeforePrInput = {
  token: string;
  repoId: string;
  repoFullName: string;
  userLogin: string;
  defaultBranch: string;
  files: { path: string; content: string }[];
  includeTest?: boolean;
};

export type { VerifyFailureCategory };

export type VerifyBeforePrResult =
  | { status: "passed"; verified: true }
  | { status: "skipped"; reason: string; verified: false }
  | {
      status: "failed";
      verified: false;
      category: VerifyFailureCategory;
      steps: SandboxStepResult[];
      message: string;
    };

const MAX_RETRIES = 2;

export { classifyFailure };

/**
 * Verify candidate files in an isolated sandbox before opening a PR.
 * Every retry boots another sandbox, so the loop is bounded by MAX_RETRIES and the installation's
 * concurrency control.
 */
export async function verifyBeforePr(input: VerifyBeforePrInput): Promise<VerifyBeforePrResult> {
  return runVerifyBeforePr(input);
}

async function runVerifyBeforePr(input: VerifyBeforePrInput): Promise<VerifyBeforePrResult> {
  const skipped = (reason: string): VerifyBeforePrResult => ({
    status: "skipped",
    reason,
    verified: false,
  });
  if (!(await isFeatureEnabled("flag_sandbox_verify"))) {
    return { status: "skipped", reason: "Sandbox verification disabled", verified: false };
  }
  const adapter = getSandboxAdapter();
  if (!adapter.available()) {
    return { status: "skipped", reason: "Sandbox provider not configured", verified: false };
  }

  const timeoutMs = SANDBOX_TIMEOUT_MS;

  const { GitHubFileProvider } = await import("../scan-engine/github-file-provider");
  const provider = new GitHubFileProvider(input.token, input.repoFullName, input.defaultBranch);
  const filePaths = await provider.listFiles();

  // The repo's saved overrides, exactly as processSandboxVerifyJob applies them. Omitting them
  // here meant a monorepo ran install/build at the repo root rather than in its app directory,
  // failed, and — since a failure blocks the PR entirely — a perfectly good fix never shipped.
  // These settings exist precisely because detection got it wrong for that repo.
  const buildSettings = await getProjectBuildSettings(input.repoId);
  const rootDir = buildSettings.rootDir;

  let scripts: Record<string, string> = {};
  let exampleValues: Record<string, string> = {};
  let envKeys: string[] = [];
  let enginesNode: string | undefined;

  try {
    const pkgRaw = await provider.readFile(repoPath(rootDir, "package.json"));
    if (pkgRaw) {
      const pkg = JSON.parse(pkgRaw) as {
        scripts?: Record<string, string>;
        engines?: { node?: string };
      };
      scripts = pkg.scripts ?? {};
      enginesNode = pkg.engines?.node;
    }
  } catch {
    /* ignore */
  }

  // Pin the runtime the same way processSandboxVerifyJob does. This passed no `runtime` at all,
  // so the pre-PR check ran on the provider's default Node while the durable job ran on the
  // repo's own — and a failure here *blocks the PR entirely*. An Astro repo pinning 22 via
  // .nvmrc had its fix rejected on `Unsupported engine ... current: v20.9.0`, having already
  // passed the very same install/build/lint on the durable path minutes earlier.
  let nvmrc: string | undefined;
  for (const candidate of [repoPath(rootDir, ".nvmrc"), ".nvmrc"]) {
    if (nvmrc || !filePaths.includes(candidate)) continue;
    try {
      nvmrc = (await provider.readFile(candidate)) ?? undefined;
    } catch {
      /* ignore */
    }
  }
  const requestedNodeVersion =
    buildSettings.nodeVersion ?? resolveSandboxNodeVersion({ nvmrc, enginesNode });
  const nodeVersion = requestedNodeVersion
    ? await resolveExactNodeVersion(requestedNodeVersion)
    : undefined;

  for (const name of [".env.example", ".env.sample", ".env.template"]) {
    if (!filePaths.includes(name)) continue;
    try {
      const content = await provider.readFile(name);
      if (content) {
        const parsed = parseEnvExampleLiterals(content);
        exampleValues = { ...exampleValues, ...parsed };
        envKeys = [...new Set([...envKeys, ...Object.keys(parsed)])];
      }
    } catch {
      /* ignore */
    }
  }

  let userValues: Record<string, string> = {};
  try {
    userValues = await loadDecryptedProjectEnvVars(input.repoId, input.userLogin);
    envKeys = [...new Set([...envKeys, ...Object.keys(userValues)])];
  } catch {
    /* ignore */
  }

  const overlayPaths = new Set([...filePaths, ...input.files.map((f) => f.path)]);
  const ecosystem = detectSandboxEcosystem([...overlayPaths], rootDir);
  if (!ecosystem) {
    return skipped(
      "No supported project manifest for sandbox verification (Node/Python/Go/Ruby/PHP/Rust/Java/.NET/Elixir).",
    );
  }

  if (!sandboxImageSupports(ecosystem)) {
    return skipped(
      `Sandbox template missing ${ecosystem} toolchain — rebuild launchreadyy or use static analysis only`,
    );
  }

  // A fix may itself add the script it needs, so overlay content wins over what the repo has —
  // matched against the app's package.json, which in a monorepo is not the one at the root.
  const appPkgPath = repoPath(rootDir, "package.json");
  for (const f of input.files) {
    if (f.path === appPkgPath || f.path === "package.json") {
      try {
        const pkg = JSON.parse(f.content) as { scripts?: Record<string, string> };
        scripts = { ...scripts, ...(pkg.scripts ?? {}) };
      } catch {
        /* ignore */
      }
    }
  }

  let lastFail: VerifyBeforePrResult | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Attempt 0 runs on the slot claimed above; each retry boots another sandbox and pays for
    // it. If another attempt cannot start, report what we already learned
    // rather than silently running a machine nobody is paying for.

    const merged = mergeEnvVars({ keys: envKeys, userValues, exampleValues });
    const env = merged.valuesAsRecord();
    const commandSet = detectSandboxCommands({
      filePaths: [...overlayPaths],
      scripts,
      // Either this run asked for tests, or the repo has them switched on — same rule the
      // durable sandbox job uses.
      includeTest: input.includeTest === true || buildSettings.includeTest,
      rootDir,
      buildCommand: buildSettings.buildCommand,
    });

    if (commandSet.commands.length === 0) {
      return skipped("No sandbox commands detected for this repository");
    }

    const files = await buildOverlayTree(provider, filePaths, input.files, rootDir);
    const result = await adapter.run({
      source: { kind: "files", files },
      env,
      commands: commandSet.commands,
      timeoutMs,
      runtime: ecosystem === "node" ? { language: "node", version: nodeVersion } : undefined,
    });

    if (result.skipped) {
      return skipped(result.skipReason ?? result.providerError ?? "skipped");
    }
    if (result.providerError && result.steps.length === 0) {
      return skipped(result.providerError);
    }

    // The sandbox ran and produced steps, so it reached a verdict — this slot is spent whether
    // the verdict is pass or fail, and a later skip must not hand it back.

    if (result.ok) {
      return { status: "passed", verified: true };
    }

    const category = classifyFailure(result.steps);
    const issues = stepsToIssues(result.steps, new Date().toISOString());
    lastFail = {
      status: "failed",
      verified: false,
      category,
      steps: result.steps,
      message: issues[0]?.foundEvidence ?? issues[0]?.why ?? "Sandbox verification failed",
    };

    if (category === "env") {
      const demanded = extractDemandedEnvKeys(result.steps);
      for (const k of demanded) {
        if (!envKeys.includes(k)) envKeys.push(k);
      }
      continue;
    }

    if (attempt < MAX_RETRIES && category === "unknown") continue;
    break;
  }

  return (
    lastFail ?? {
      status: "failed",
      verified: false,
      category: "unknown",
      steps: [],
      message: "Sandbox verification failed",
    }
  );
}

function extractDemandedEnvKeys(steps: SandboxStepResult[]): string[] {
  const blob = steps.map((s) => `${s.stdout}\n${s.stderr}`).join("\n");
  const keys = new Set<string>();
  for (const m of blob.matchAll(
    /(?:Missing environment variable|process\.env\.|env\()["']?([A-Z][A-Z0-9_]{2,})/g,
  )) {
    keys.add(m[1]!);
  }
  return [...keys];
}

const MANIFESTS = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "tsconfig.json",
];

export async function buildOverlayTree(
  provider: { readFile: (path: string) => Promise<string | null> },
  filePaths: string[],
  overlays: { path: string; content: string }[],
  rootDir?: string | null,
): Promise<Record<string, string>> {
  const overlayMap = new Map(overlays.map((f) => [f.path.replace(/^\/+/, ""), f.content]));
  const files: Record<string, string> = {};

  // Both the repo root and the app directory: a monorepo keeps its lockfile at the root while the
  // app's own package.json — the one install and build actually read — lives under rootDir.
  const needed = new Set<string>([
    ...overlayMap.keys(),
    ...MANIFESTS,
    ...(rootDir ? MANIFESTS.map((m) => repoPath(rootDir, m)) : []),
  ]);

  let added = 0;
  for (const p of filePaths) {
    if (overlayMap.has(p) || needed.has(p)) {
      needed.add(p);
      continue;
    }
    if (
      added < 150 &&
      (/\.(tsx?|jsx?|mjs|cjs|json|astro)$/.test(p) ||
        p.startsWith("src/") ||
        p.startsWith("app/") ||
        p.startsWith("pages/"))
    ) {
      needed.add(p);
      added++;
    }
  }

  for (const path of needed) {
    if (overlayMap.has(path)) {
      files[path] = overlayMap.get(path)!;
      continue;
    }
    const content = await provider.readFile(path);
    if (content != null) files[path] = content;
  }
  for (const [path, content] of overlayMap) {
    files[path] = content;
  }
  return files;
}
