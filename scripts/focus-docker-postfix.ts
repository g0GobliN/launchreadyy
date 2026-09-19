/**
 * Focused post-fix: only nextjs-app + python-fastapi docker builds.
 *   npx tsx scripts/focus-docker-postfix.ts
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dockerfile as dockerfileFor, DOCKER_IGNORE } from "../src/lib/fix-executor.server";
import {
  NEXT_CONFIG_STANDALONE,
  NEXT_CONFIG_STANDALONE_PATH,
  patchNextConfigStandalone,
} from "../src/lib/fix-executor/body/next/config";
import {
  resolveProjectLanguage,
  inferProjectFacts,
  clampNodeVersion,
} from "../src/lib/project-context.server";
import { detectFramework, type PackageJsonLike } from "../src/lib/scanner-rules";
import { baseCtx } from "../src/lib/fix-tool-catalog";

const ROOT = process.env.LR_FIXTURES_DIR ?? path.join(process.cwd(), ".scratch/real-fixtures");
const LOG = path.join(process.cwd(), ".cursor/debug-71a43f.log");

function log(hypothesisId: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  const payload = {
    sessionId: "71a43f",
    runId: "post-fix-2",
    hypothesisId,
    location: "focus-docker-postfix.ts",
    message,
    data,
    timestamp: Date.now(),
  };
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(payload) + "\n");
  fetch("http://127.0.0.1:7893/ingest/e28805d0-f091-4071-9114-aec1fa88ea31", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "71a43f" },
    body: JSON.stringify(payload),
  }).catch(() => {});
  // #endregion
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const skip = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    "out",
    "vendor",
    "target",
    "_build",
    "deps",
  ]);
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (!skip.has(ent.name)) walk(path.join(dir, ent.name));
      } else if (ent.isFile()) {
        out.push(path.relative(root, path.join(dir, ent.name)).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return out;
}

function readText(root: string, rel: string) {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
}

function readJson(root: string, rel: string) {
  const t = readText(root, rel);
  if (!t) return null;
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildCtx(root: string) {
  const filePaths = listFiles(root);
  const pkgRaw = readJson(root, "package.json");
  const guessed = pkgRaw ? detectFramework(pkgRaw as PackageJsonLike) : "unknown";
  const { language, resolvedFramework } = resolveProjectLanguage(guessed, filePaths, !!pkgRaw);
  const pkg = {
    scripts: (pkgRaw?.scripts as Record<string, string>) ?? {},
    dependencies: (pkgRaw?.dependencies as Record<string, string>) ?? {},
    devDependencies: (pkgRaw?.devDependencies as Record<string, string>) ?? {},
    nodeVersion: clampNodeVersion(undefined),
    hasBackend: false,
    packageManager: pkgRaw?.packageManager as string | undefined,
  };
  const facts = inferProjectFacts(
    language,
    resolvedFramework,
    { ...pkg, raw: undefined },
    filePaths,
  );
  const packageManager = filePaths.includes("pnpm-lock.yaml") ? "pnpm" : "npm";
  const manifests = {
    goMod: readText(root, "go.mod"),
    gemfile: readText(root, "Gemfile"),
    requirements: readText(root, "requirements.txt"),
    pyprojectToml: readText(root, "pyproject.toml"),
    pipfile: readText(root, "Pipfile"),
    cargoToml: readText(root, "Cargo.toml"),
    composerJson: readText(root, "composer.json"),
    pomXml: readText(root, "pom.xml"),
    buildGradle: readText(root, "build.gradle") ?? readText(root, "build.gradle.kts"),
    makefile: readText(root, "Makefile"),
    mixExs: readText(root, "mix.exs"),
    pubspecYaml: readText(root, "pubspec.yaml"),
    packageSwift: readText(root, "Package.swift"),
  };
  return baseCtx({
    language,
    resolvedFramework,
    isNodeProject: language === "node",
    packageManager,
    filePaths,
    pkg,
    mergedDeps: { ...pkg.dependencies, ...pkg.devDependencies },
    manifests,
    hasExpress: facts.hasExpress,
    isStaticSpa: facts.isStaticSpa,
    usesTypeScript: facts.usesTypeScript,
    usesReact: facts.usesReact,
    hasNextAppRouter: facts.hasNextAppRouter,
    hasExistingCi: facts.hasExistingCi,
    hasExistingDockerfile: facts.hasExistingDockerfile,
    deployConfigs: facts.deployConfigs,
  });
}

function run(cmd: string, args: string[], timeoutMs = 12 * 60_000) {
  const res = spawnSync(cmd, args, {
    timeout: timeoutMs,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return { ok: res.status === 0, out: `${res.stdout ?? ""}\n${res.stderr ?? ""}` };
}

const targets = [
  { name: "nextjs-app", hyp: "H6" },
  { name: "python-fastapi", hyp: "H7" },
];

const results: { repo: string; ok: boolean }[] = [];
for (const t of targets) {
  const root = path.join(ROOT, t.name);
  const ctx = buildCtx(root);
  const fw = t.name === "python-fastapi" ? "Python" : ctx.resolvedFramework;
  const content = dockerfileFor(
    fw,
    (ctx.packageManager as "npm" | "pnpm" | "yarn" | "bun") || "npm",
    ctx.filePaths,
    ctx.manifests,
    "",
    (p) => readText(root, p) ?? undefined,
  );
  const work = path.join(ROOT, `.work-focus-${t.name}-${Date.now()}`);
  fs.cpSync(root, work, {
    recursive: true,
    filter: (p) => !p.includes(`${path.sep}.git`),
  });
  fs.writeFileSync(path.join(work, "Dockerfile"), content);
  fs.writeFileSync(path.join(work, ".dockerignore"), DOCKER_IGNORE);
  if (fw === "Next.js") {
    let patched = false;
    for (const cp of ["next.config.ts", "next.config.js", "next.config.mjs"]) {
      const existing = readText(root, cp);
      if (existing !== null) {
        fs.writeFileSync(path.join(work, cp), patchNextConfigStandalone(existing) ?? existing);
        patched = true;
        break;
      }
    }
    if (!patched)
      fs.writeFileSync(path.join(work, NEXT_CONFIG_STANDALONE_PATH), NEXT_CONFIG_STANDALONE);
  }
  log(t.hyp, "generated", {
    repo: t.name,
    hasPoetry: content.includes("poetry install"),
    hasStripePlaceholder: content.includes("STRIPE_SECRET_KEY=sk_test_build_placeholder"),
    hasLibpq: content.includes("libpq-dev"),
    hasPy39: content.includes("python:3.9-slim"),
    hasStandaloneConfig: fs.existsSync(path.join(work, NEXT_CONFIG_STANDALONE_PATH)),
  });
  console.log(
    `[GEN] ${t.name} poetry=${content.includes("poetry install")} stripePH=${content.includes("STRIPE_SECRET_KEY=sk_test_build_placeholder")} libpq=${content.includes("libpq-dev")}`,
  );
  const build = run("docker", ["build", "-t", `lr-focus-${t.name}`, work]);
  log(t.hyp, "docker_build", {
    repo: t.name,
    ok: build.ok,
    detailTail: build.out.slice(-600),
  });
  console.log(`[${build.ok ? "PASS" : "FAIL"}] ${t.name} docker build`);
  if (!build.ok) console.log(build.out.slice(-1000));
  results.push({ repo: t.name, ok: build.ok });
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${work}:/repo`,
    "alpine:3.20",
    "sh",
    "-c",
    "chown -R 1000:1000 /repo 2>/dev/null || true",
  ]);
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(JSON.stringify(results));
process.exit(results.every((r) => r.ok) ? 0 : 1);
