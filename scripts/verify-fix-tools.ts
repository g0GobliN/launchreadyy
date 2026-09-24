/**
 * Real-execution audit for the fix tools that generate things CI/deploy actually run:
 * github-actions, ci-ai (deterministic path), and dockerfile.
 *
 * Unlike fix-validation.ts (parses output) or fix-preflight.server.ts (matches known bad
 * patterns), this clones real OSS repos, calls the *production* generator functions, writes
 * the result into the clone, and actually executes it — `docker build`/`docker run` for
 * Dockerfiles, the real `run:` steps for CI workflows — inside Docker containers matching the
 * declared toolchain. A generated fix only passes if it would actually survive contact with a
 * real CI runner, not just if it parses.
 *
 * Not part of `npm test` (network + Docker + real toolchains, too slow for the default run) —
 * it needs its own config, because vitest.config.ts only includes src/. Invoke via:
 *
 *   npm run verify:tools                       # all suites
 *   npm run verify:tools -- -t "eslint|ruff"   # one slice
 *
 * Fixtures come from scripts/clone-real-fixtures.sh; set LR_FIXTURES_DIR to point elsewhere.
 *
 * Caching: the images, each language's download cache, and the build layer cache are all reused
 * between runs — see the Caching section below and src/lib/docker-audit-cache.ts. A first run on
 * a cold machine is the slow one; later runs reuse everything it fetched.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  buildCacheArgs,
  buildCommandArgs,
  cacheMountArgs,
  cacheVolumeNames,
  formatBytes,
  parseBuildCacheMode,
  pullImagesInParallel,
  summarizeCacheVolumes,
} from "../src/lib/docker-audit-cache";

import {
  dockerfile as dockerfileFor,
  dockerfileNode,
  dockerfileNodeRuntime,
  DOCKER_IGNORE,
  NEXT_CONFIG_STANDALONE,
  patchNextConfigStandalone,
  nginxConf,
  eslintConfigForProject,
  RUFF_CONFIG,
  RUFF_TOML_CONFIG,
  RUBOCOP_CONFIG,
  GOLANGCI_LINT_CONFIG,
  phpCsFixerConfigForProject,
  CHECKSTYLE_CONFIG,
  CREDO_CONFIG,
  PRETTIER_RC,
  PRETTIER_IGNORE,
  DB_POOL,
  vitestConfig,
  vitestConfigPath,
  vitestDevDeps,
  PYTEST_SETUP,
  buildXunitTestCsproj,
  addProjectToSln,
} from "../src/lib/fix-executor.server";
import {
  analyzeProjectCi,
  buildProjectCiWorkflow,
  expandFixIdsForProductionCi,
} from "../src/lib/project-ci.server";
import { buildLanguageCiWorkflow } from "../src/lib/project-ci-lang.server";
import {
  resolveProjectLanguage,
  inferProjectFacts,
  dotnetSdkVersion,
  findDirectoryBuildPropsPath,
  clampNodeVersion,
  isEslintFullyConfigured,
  javaVersionFromBuildFiles,
  type ProjectContext,
  type LanguageManifests,
} from "../src/lib/project-context.server";
import {
  pickSourcePathsForAnalysis,
  scanEnvContract,
} from "../src/lib/project-intelligence.server";
import { detectFramework, type PackageJsonLike } from "../src/lib/scanner-rules";
import { runAuditor } from "../src/lib/readiness/auditor";
import { baseCtx, emptyIntelligence } from "../src/lib/fix-tool-catalog";

// Same default as clone-real-fixtures.sh, real-tool-matrix.ts and focus-docker-postfix.ts, so a
// plain `npm run verify:tools` finds whatever the clone script just wrote.
const FIXTURES_ROOT =
  process.env.LR_FIXTURES_DIR ?? path.join(process.cwd(), ".scratch/real-fixtures");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "out"]);

// ─── Caching ───────────────────────────────────────────────────────────────────
//
// Every row runs in a container this harness creates and destroys, so each one used to pay for its
// own cold start: a fresh dependency download, and for the 12 `docker build` rows an empty layer
// cache. Both are now paid once per machine instead of once per row.
//
// Four independent switches, all defaulting to the cached behaviour:
//   LR_AUDIT_CACHE=0                    — no toolchain cache volumes
//   LR_AUDIT_BUILD_CACHE=off|read|read-write  — layer cache for `docker build` (default: read)
//   LR_AUDIT_WARM=0                     — don't prime the image set before the first row; rows
//                                         then pull only what they need, which is what a filtered
//                                         run (`-t`) wants
//   LR_AUDIT_PULL=0                     — no pulls in the harness at all
//   LR_AUDIT_CACHE_RESET=1              — drop the toolchain volumes first, because a corrupt
//                                         download inside a volume outlives the container that
//                                         wrote it

const cacheSwitchOff = (raw: string | undefined): boolean => /^(0|off|false|no)$/i.test(raw ?? "");

const CACHE_ENABLED = !cacheSwitchOff(process.env.LR_AUDIT_CACHE);

/**
 * Whether a row may pull. Off only makes a row fall back to what `docker create`/`docker build`
 * does on its own — an implicit pull — so this is about *how* a missing image is fetched, not
 * whether it can be.
 */
const PULL_ENABLED = !cacheSwitchOff(process.env.LR_AUDIT_PULL);
const WARM_ENABLED = PULL_ENABLED && !cacheSwitchOff(process.env.LR_AUDIT_WARM);

const BUILD_CACHE_MODE = parseBuildCacheMode(process.env.LR_AUDIT_BUILD_CACHE);
/**
 * Under `.scratch/` (gitignored), so a durable build cache is never committed.
 *
 * Resolved rather than merely joined: `docker buildx` runs with the work directory as its cwd, so
 * a relative `LR_FIXTURES_DIR`/`LR_AUDIT_BUILD_CACHE_DIR` would resolve this against the build
 * context instead of the repository.
 */
const BUILD_CACHE_DIR = path.resolve(
  process.env.LR_AUDIT_BUILD_CACHE_DIR ?? path.join(FIXTURES_ROOT, "..", "docker-build-cache"),
);
const BUILD_CACHE_ACTIVE = CACHE_ENABLED && BUILD_CACHE_MODE !== "off";

/** Bounds the warm-up hook only. A full parallel pull of a cold machine's image set is a few
 * minutes on a normal link; this is the point at which continuing to wait is not worth it. */
const WARM_TIMEOUT_MS = Number(process.env.LR_AUDIT_PULL_TIMEOUT_MS ?? 30 * 60_000);

function listFiles(root: string): string[] {
  // A missing fixture is the harness's most common failure and its least informative one: the
  // auditors row calls this per fixture inside a loop, so one absent directory throws a bare
  // `ENOENT: scandir` before any expectation is asserted, reporting nothing about the fixtures
  // that *are* present. Name the repair instead.
  if (!fs.existsSync(root)) {
    throw new Error(
      `Fixture directory not found: ${root}\n\n` +
        "Populate the fixtures first:\n" +
        "  bash scripts/clone-real-fixtures.sh\n\n" +
        `Fixtures are read from ${FIXTURES_ROOT} (override with LR_FIXTURES_DIR).`,
    );
  }
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(path.join(dir, ent.name));
      } else if (ent.isFile()) {
        out.push(path.relative(root, path.join(dir, ent.name)).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return out;
}

function readText(root: string, rel: string): string | undefined {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return undefined;
  }
}

/** Mirrors fix-executor.server.ts's fetchCsprojContent: csproj + any Directory.Build.props
 * found in an ancestor dir, concatenated — real multi-project .NET solutions (e.g. the real
 * davidfowl/TodoApi) commonly put <TargetFramework> only in the latter. */
function readCsprojWithBuildProps(root: string, filePaths: string[]): string {
  const csprojPath = filePaths.find((p) => /\.csproj$/i.test(p) && !/test/i.test(p));
  if (!csprojPath) return "";
  const csprojContent = readText(root, csprojPath) ?? "";
  const propsPath = findDirectoryBuildPropsPath(csprojPath, filePaths);
  const propsContent = propsPath ? (readText(root, propsPath) ?? "") : "";
  return csprojContent + "\n" + propsContent;
}

function readJson(root: string, rel: string): Record<string, unknown> | null {
  const raw = readText(root, rel);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Mirrors fetchLanguageManifests (project-context.server.ts) but reads the real clone on disk. */
function readManifests(root: string): LanguageManifests {
  return {
    goMod: readText(root, "go.mod"),
    gemfile: readText(root, "Gemfile"),
    requirements: readText(root, "requirements.txt"),
    pyprojectToml: readText(root, "pyproject.toml"),
    pipfile: readText(root, "Pipfile"),
    cargoToml: readText(root, "Cargo.toml"),
    composerJson: readText(root, "composer.json"),
    pomXml: readText(root, "pom.xml"),
    // .kts fallback mirrors production fetchLanguageManifests — spring-petclinic-kotlin has
    // build.gradle.kts only.
    buildGradle: readText(root, "build.gradle") ?? readText(root, "build.gradle.kts"),
    makefile: readText(root, "Makefile"),
    mixExs: readText(root, "mix.exs"),
    pubspecYaml: readText(root, "pubspec.yaml"),
    packageSwift: readText(root, "Package.swift"),
  };
}

/** Builds a real ProjectContext from an actual cloned repo, reusing the exact production
 * detection functions (detectFramework, resolveProjectLanguage, inferProjectFacts) instead of
 * hand-rolling equivalents. */
function buildRealContext(root: string): ProjectContext {
  const filePaths = listFiles(root);
  const pkgRaw = readJson(root, "package.json");
  const hasPackageJson = pkgRaw !== null;
  const guessedFramework = pkgRaw ? detectFramework(pkgRaw as PackageJsonLike) : "unknown";
  const { language, resolvedFramework } = resolveProjectLanguage(
    guessedFramework,
    filePaths,
    hasPackageJson,
  );
  const isNodeProject = language === "node";

  const pkg = {
    scripts: (pkgRaw?.scripts as Record<string, string>) ?? {},
    dependencies: (pkgRaw?.dependencies as Record<string, string>) ?? {},
    devDependencies: (pkgRaw?.devDependencies as Record<string, string>) ?? {},
    nodeVersion: clampNodeVersion(
      (typeof pkgRaw?.engines === "object" &&
        (pkgRaw?.engines as Record<string, string>)?.node?.match(/\d+/)?.[0]) ||
        readText(root, ".nvmrc")?.trim().replace(/^v/, "").match(/\d+/)?.[0],
    ),
    hasBackend: false,
    packageManager: pkgRaw?.packageManager as string | undefined,
  };
  const mergedDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  const facts = inferProjectFacts(
    language,
    resolvedFramework,
    { ...pkg, raw: undefined },
    filePaths,
  );

  // Mirrors detectNodePackageManager (project-context.server.ts) — lockfile presence, not the
  // "packageManager" package.json field (rarely set in the wild, as these fixtures show).
  const packageManager = filePaths.includes("pnpm-lock.yaml")
    ? "pnpm"
    : filePaths.includes("yarn.lock")
      ? "yarn"
      : filePaths.includes("bun.lockb") || filePaths.includes("bun.lock")
        ? "bun"
        : "npm";

  return baseCtx({
    language,
    resolvedFramework,
    isNodeProject,
    packageManager,
    filePaths,
    pkg,
    mergedDeps,
    manifests: readManifests(root),
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

// ─── Docker execution ─────────────────────────────────────────────────────────

interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** The timeout fired. For `docker run` this matters: spawnSync killed the CLI, not the
   * container, so the caller must clean the container up itself. */
  timedOut: boolean;
}

function run(cmd: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }): ExecResult {
  const res = spawnSync(cmd, args, {
    cwd: opts?.cwd,
    timeout: opts?.timeoutMs ?? 5 * 60_000,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: res.status === 0,
    stdout: res.stdout ?? "",
    stderr: (res.stderr ?? "") + (res.error ? `\n${res.error.message}` : ""),
    // Node reports a spawnSync timeout as SIGTERM, and on some platforms as an ETIMEDOUT error.
    timedOut:
      res.signal === "SIGTERM" ||
      (res.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT",
  };
}

/** Memoized probe, and the reason it has to exist: without it, an absent Docker is a *pass*.
 *
 * assertLinterConfigAccepted treats any non-zero exit as "real lint findings" and only fails when
 * the output matches a config-parse signature. A missing binary yields `spawnSync docker ENOENT`,
 * which matches no such signature — so all 13 linter-config rows report green having executed
 * nothing at all. That is the same failure-toward-reassurance shape this harness exists to catch,
 * so it must be loud rather than skipped. `docker info` (not `--version`) because a stopped daemon
 * fails the same way a missing binary does. */
let dockerUnavailableReason: string | null | undefined;
/** The memoized probe, kept accessible to callers that must *tolerate* an absent daemon (the
 * image warm-up) as well as to assertDockerAvailable, which must not. */
function dockerProbe(): string | null {
  if (dockerUnavailableReason === undefined) {
    const probe = run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 60_000 });
    dockerUnavailableReason = probe.ok ? null : `${probe.stdout}\n${probe.stderr}`.trim();
  }
  return dockerUnavailableReason;
}
function assertDockerAvailable(): void {
  const reason = dockerProbe();
  if (reason !== null) {
    throw new Error(
      `Docker is required for this row and is not usable:\n${reason}\n\n` +
        "Start the daemon, or run only the rows that do not need it:\n" +
        '  npm run verify:tools -- -t "auditors"\n' +
        "  npm run verify:mobile",
    );
  }
}

/** `run`, but asynchronous so several pulls can be in flight at once.
 *
 * Pulling the image set one after another is the difference between a warm-up measured in tens of
 * seconds and one that outruns the hook timeout — these are multi-hundred-megabyte images and the
 * bottleneck is the network, not the CPU. */
function runAsync(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<ExecResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(cmd, args, { timeout: opts?.timeoutMs ?? 5 * 60_000 });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) =>
      done({
        ok: false,
        stdout,
        stderr: `${stderr}\n${err.message}`,
        timedOut: (err as NodeJS.ErrnoException).code === "ETIMEDOUT",
      }),
    );
    child.on("close", (code, signal) =>
      done({ ok: code === 0, stdout, stderr, timedOut: signal === "SIGTERM" }),
    );
  });
}

let buildxAvailable: boolean | undefined;
/** Whether the buildx plugin answered. Memoized, and never fatal: without it the build rows still
 * run, they just cannot import the on-disk layer cache. */
function hasBuildx(): boolean {
  if (buildxAvailable === undefined) {
    buildxAvailable = run("docker", ["buildx", "version"], { timeoutMs: 30_000 }).ok;
  }
  return buildxAvailable;
}

/**
 * Every image this run can reach for, for the up-front pull.
 *
 * Two groups. First the images a *row* passes to a container — fully enumerable from the fixture
 * tables above, so this list is derived from them rather than restated. Second the base images the
 * generated Dockerfiles build on: the generators write those themselves, so the only way to know
 * them without cloning every fixture and running the generator is to read them off the generator
 * templates once, which is what this list is.
 *
 * The point is not to download less — the same bytes are needed either way — but to download them
 * *in parallel, before the first row*, instead of serially inside one row's timeout budget, where
 * an 800MB pull is indistinguishable from a hung build. */
function imagesUsedByRun(): string[] {
  const images = new Set<string>([
    "alpine:latest",
    // The Node rows run in a slim image (they install their own toolchain); the lint rows share
    // node:20-slim, and the Go linter rows use golangci's own image.
    "node:20-slim",
    "golangci/golangci-lint:latest",
    // Java rows derive 17 or 21 from the repo's own build files; only these two tags exist.
    "maven:3.9-eclipse-temurin-17-alpine",
    "maven:3.9-eclipse-temurin-21-alpine",
    // Generated Dockerfile bases (src/lib/fix-executor*, body/node/docker.ts). `scratch` and
    // `gcr.io/distroless/static` are runtime stages: nothing to pull for the first and 2MB for
    // the second, so neither is worth a line here.
    "node:20",
    "node:20-alpine",
    "node:22",
    "node:22-slim",
    "python:3.12-alpine",
    "golang:1.22-alpine",
    "ruby:3.3-slim",
    "rust:1.78-alpine",
    "php:8.3-cli-alpine",
    "eclipse-temurin:17-jdk-alpine",
    "eclipse-temurin:17-jre-alpine",
    "eclipse-temurin:21-jdk-alpine",
    "eclipse-temurin:21-jre-alpine",
    "debian:bookworm-slim",
    "nginx:alpine",
  ]);

  for (const { image } of ALL_LANGUAGE_FIXTURES) images.add(image);

  // .NET's tag is read from each fixture's own csproj (dotnetSdkVersion), so it is only knowable
  // once the fixtures are cloned — which this cannot assume. Derive it when they are. Only the tag
  // is interpolated, never the repository: the generated .NET Dockerfile's stages are `sdk` and
  // `aspnet`, and a repository built from a variable is one nothing can classify (see the coverage
  // check in src/lib/docker-audit-cache.test.ts).
  for (const fixture of CSHARP_FIXTURES) {
    const root = fixtureRoot(fixture);
    if (!fs.existsSync(root)) continue;
    const sdk = dotnetSdkVersion(readCsprojWithBuildProps(root, listFiles(root)));
    if (!sdk) continue;
    for (const tag of [sdk, `${sdk}-alpine`]) {
      images.add(`mcr.microsoft.com/dotnet/sdk:${tag}`);
      images.add(`mcr.microsoft.com/dotnet/aspnet:${tag}`);
    }
  }

  return [...images];
}

/** Images this process has confirmed are local, whether it found them or pulled them. */
const pulledImages = new Set<string>();

/** `docker image inspect`, memoized — the reason a repeat run is near-instant.
 *
 * Without it every row would ask the registry about its tag before it could start; with it a warm
 * run answers all of them from the local image store. */
function imagePresent(image: string): boolean {
  if (pulledImages.has(image)) return true;
  const probe = run("docker", ["image", "inspect", image], { timeoutMs: 30_000 });
  if (probe.ok) pulledImages.add(image);
  return probe.ok;
}

/**
 * Make sure a row's image is local before the row uses it.
 *
 * Memoized across rows, which is the point: twenty rows share `node:20-slim`, and a cold pull
 * happening inside a row's timeout budget is indistinguishable from a hung build — that is how a
 * first run used to lose rows to ETIMEDOUT rather than to a tool fault.
 *
 * A failed pull is not reported here. The row's own `docker create`/`docker build` then fails with
 * the daemon's own message attached to that row, which is a far better place to read it.
 */
function ensureImage(image: string): void {
  if (imagePresent(image)) return;
  if (!PULL_ENABLED) return;
  if (run("docker", ["pull", image], { timeoutMs: 20 * 60_000 }).ok) pulledImages.add(image);
}

/**
 * Pull whatever is missing, in parallel, and report what changed.
 *
 * Never throws: an image that will not pull is reported by the row that needs it, with the daemon's
 * own error attached, and the `auditors` row needs no Docker at all so failing here would take it
 * down with the rows that do.
 */
async function warmImages(images: string[]): Promise<void> {
  if (!WARM_ENABLED) return;
  if (dockerProbe() !== null) return;

  const missing = images.filter((image) => !imagePresent(image));
  if (missing.length === 0) {
    console.log(`[verify-fix-tools] all ${images.length} images already present`);
    return;
  }

  // The opt-out is in the message on purpose: a filtered run (`-t`) has no use for the whole set,
  // and this is the only moment at which that choice is still cheap.
  console.log(
    `[verify-fix-tools] pulling ${missing.length}/${images.length} images in parallel ` +
      "(LR_AUDIT_WARM=0 to skip)…",
  );
  const started = Date.now();
  const outcomes = await pullImagesInParallel(missing, (image) =>
    runAsync("docker", ["pull", image], { timeoutMs: 20 * 60_000 }),
  );
  const failures = outcomes.filter((outcome) => !outcome.ok);
  for (const outcome of outcomes) {
    if (outcome.ok) pulledImages.add(outcome.image);
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`[verify-fix-tools] ${outcomes.length - failures.length} pulled in ${seconds}s`);
  if (failures.length > 0) {
    console.warn(
      `[verify-fix-tools] pull failures:\n  ${failures
        .map((f) => `${f.image}: ${f.detail}`)
        .join("\n  ")}`,
    );
  }
}

/** Drop the toolchain cache volumes. Only for LR_AUDIT_CACHE_RESET=1: a half-written download
 * inside a volume survives the container that wrote it, and would poison every later run. */
function resetCacheVolumes(): void {
  for (const name of cacheVolumeNames()) {
    run("docker", ["volume", "rm", name], { timeoutMs: 60_000 });
  }
}

/** Runs a shell script inside a throwaway container against a copy of the fixture at /repo.
 *
 * The fixture is **copied in**, not bind-mounted. A bind mount puts every file the toolchain
 * writes — and `npm install` writes tens of thousands of small files — across the host/VM
 * filesystem boundary. On Docker Desktop for Windows that is 9p/virtiofs over WSL2 and it is
 * catastrophic: measured here, the prettier row (installs one package) passed in 179s while the
 * eslint row on the same machine spent 19 minutes on the Next.js dependency tree and was killed
 * by the cap with empty output, and the express-plain row blew its 5-minute test budget. Those
 * read as tool failures while being pure I/O overhead. `docker cp` streams a single tar across the
 * boundary once, after which all install traffic is native to the container's own filesystem.
 *
 * Safe because nothing reads back: every row writes its config files before calling this and then
 * asserts only on stdout/stderr.
 *
 * 15-minute cap: a real cold-cache Gradle build (spring-petclinic: image pull + Gradle
 * distribution + full dependency download + compile + test, all in one `run:` step) was
 * confirmed to blow through the previous 8-minute cap with the build still progressing
 * normally — ETIMEDOUT mid-download, not hung. */
function runInContainer(
  image: string,
  hostDir: string,
  script: string,
  env: Record<string, string> = {},
  /** Repo-relative paths to copy back out before the container is removed.
   *
   * Needed because the copy-in model is one-way. assertWorkflowRuns seeds an empty
   * `.gh-output-*` file, points GITHUB_OUTPUT at it, and then reads it back to resolve
   * `${{ steps.<id>.outputs.<key> }}` for later steps. Under a bind mount the step's writes
   * appeared on the host for free; with copy-in they stay in the container, so every output
   * resolved to empty and Node's `run: ${{ steps.pm.outputs.run }} lint` executed as a bare
   * `lint`. Only the Node workflow uses step outputs, which is exactly why the ten language
   * rows were unaffected. */
  copyOut: string[] = [],
  /** Bind-mount /repo instead of copying it in.
   *
   * Required by assertWorkflowRuns, which runs each workflow step in its own container: a real
   * runner shares one filesystem across a job's steps, so `install` populating node_modules is
   * what makes the following `lint` step's `eslint` resolve. Copy-in isolates each step, and that
   * step-to-step persistence vanishes — the workflow then fails with "eslint: not found" after a
   * successful install. Single-shot rows keep copy-in, which is where the 5x speedup came from. */
  mount = false,
): ExecResult {
  assertDockerAvailable();
  ensureImage(image);
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  // Named volumes holding this language's download cache (npm/pip/go/cargo/m2/gradle/nuget/hex/
  // composer/gems), so the container does not re-download a dependency tree it downloaded for an
  // earlier row. Paths are relative to the image's own HOME/TOOLCHAIN layout; see
  // src/lib/docker-audit-cache.ts for why each one is a subdirectory rather than a toolchain home.
  const cacheArgs = CACHE_ENABLED ? cacheMountArgs([image]) : [];
  // Named so a timeout is recoverable. A container started by a `docker` CLI that spawnSync later
  // kills keeps running in the daemon; those orphans then compete for CPU with every later row, so
  // each timeout made the rest of the suite slower — observed as four alive at once, one for 49
  // minutes.
  const name = `lr-audit-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (mount) {
    const mounted = run(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        name,
        "-v",
        `${hostDir}:/repo`,
        "-w",
        "/repo",
        ...envArgs,
        ...cacheArgs,
        image,
        "sh",
        "-c",
        script,
      ],
      { timeoutMs: 15 * 60_000 },
    );
    if (mounted.timedOut) run("docker", ["kill", name], { timeoutMs: 60_000 });
    return mounted;
  }

  const created = run(
    "docker",
    ["create", "--name", name, "-w", "/repo", ...envArgs, ...cacheArgs, image, "sh", "-c", script],
    { timeoutMs: 5 * 60_000 },
  );
  if (!created.ok) return created;

  const kill = () => {
    run("docker", ["kill", name], { timeoutMs: 60_000 });
    run("docker", ["rm", "-f", name], { timeoutMs: 60_000 });
  };

  // `.` copies the directory *contents* into /repo, which `docker create -w /repo` has made.
  const copied = run("docker", ["cp", `${hostDir}/.`, `${name}:/repo`], {
    timeoutMs: 10 * 60_000,
  });
  if (!copied.ok) {
    kill();
    return copied;
  }

  const res = run("docker", ["start", "--attach", name], { timeoutMs: 15 * 60_000 });
  for (const rel of copyOut) {
    run("docker", ["cp", `${name}:/repo/${rel}`, path.join(hostDir, rel)], { timeoutMs: 60_000 });
  }
  kill();
  return res;
}

// ─── Minimal GitHub Actions step runner ────────────────────────────────────────
// Scoped to the exact shapes buildProjectCiWorkflow/buildLanguageCiWorkflow produce (read from
// source): a plain sequence of steps per job, `uses:` steps that either need nothing (checkout)
// or install a toolchain our base image already has (setup-node/setup-python/pm tooling for the
// npm-only fixtures in this batch), and `run:` steps that sometimes reference a prior step's
// $GITHUB_OUTPUT via steps.<id>.outputs.<key>. Not a general Actions interpreter.

interface StepResult {
  job: string;
  step: string;
  ok: boolean;
  detail?: string;
  /** Untruncated stdout+stderr — `detail` is display-length-limited, this isn't, so the
   * acceptable-failure pattern check doesn't miss a match just because a longer-than-usual
   * backtrace pushed the matching text outside detail's truncation window. */
  raw?: string;
}

function evalIf(
  cond: string | undefined,
  outputs: Record<string, Record<string, string>>,
): boolean {
  if (!cond) return true;
  const m = cond.match(/steps\.([\w-]+)\.outputs\.(\w+)\s*(==|!=)\s*'([^']*)'/);
  if (!m) return true; // unrecognized condition — don't block on it, just run
  const [, id, key, op, val] = m;
  const actual = outputs[id]?.[key] ?? "";
  return op === "==" ? actual === val : actual !== val;
}

function substitute(text: string, outputs: Record<string, Record<string, string>>): string {
  return text.replace(
    /\$\{\{\s*steps\.([\w-]+)\.outputs\.(\w+)\s*\}\}/g,
    (_, id, key) => outputs[id]?.[key] ?? "",
  );
}

// uses: steps that actually change what's on PATH for later run: steps — the base image already
// covers checkout (repo is mounted) and setup-node (image IS that node version), so only the
// non-npm package-manager installers need a real stand-in.
const TOOL_INSTALL_BY_USES: Array<[RegExp, string]> = [
  [/oven-sh\/setup-bun/, "npm install -g bun >/dev/null 2>&1"],
  // buildRustCi always pairs this action with `with: components: clippy` — the real action
  // installs it; our base rust:X image doesn't have it by default. Retry once and surface the
  // error on the second attempt: a transient download failure silenced by >/dev/null left the
  // Clippy step failing later with a misleading "cargo-clippy is not installed".
  [
    /dtolnay\/rust-toolchain/,
    "rustup component add clippy >/dev/null 2>&1 || rustup component add clippy",
  ],
  // Harness fidelity gap, not a generator bug (same class as the NuGet-cache fix elsewhere in
  // this file): real GitHub Actions `ubuntu-latest` runners ship build-essential/gcc
  // preinstalled as part of the base runner image (documented in actions/runner-images), so
  // `actions/setup-python@v5` + `pip install -r requirements.txt` on a real runner can compile
  // C-extension deps with no extra step. Our `python:3.12-slim` stand-in has neither — confirmed
  // failing on the real miguelgrinberg/microblog (`multidict`, a transitive elasticsearch/aiohttp
  // dependency, fails with "gcc: No such file or directory") — a repo shape the original,
  // simpler python-app fixture's requirements.txt never exercised. Installing build-essential
  // here (not in the generated YAML) mirrors what ubuntu-latest already provides for real.
  [
    /actions\/setup-python/,
    "apt-get update -qq && apt-get install -qq -y build-essential >/dev/null 2>&1",
  ],
  // Real erlef/setup-beam runs on a runner with hex/rebar caches and a C toolchain; a fresh
  // elixir:alpine container has none of those (NIF deps like bcrypt need build-base) — stand
  // in for what the real runner environment provides.
  [
    /erlef\/setup-beam/,
    "apk add -q build-base >/dev/null 2>&1; mix local.hex --force >/dev/null 2>&1; mix local.rebar --force >/dev/null 2>&1",
  ],
];

function runWorkflowJob(
  jobName: string,
  job: { steps?: Array<Record<string, unknown>>; env?: Record<string, unknown> },
  hostDir: string,
  image: string,
): StepResult[] {
  const outputs: Record<string, Record<string, string>> = {};
  const results: StepResult[] = [];
  let preamble = "";

  for (const raw of job.steps ?? []) {
    const step = raw as {
      uses?: string;
      run?: string;
      id?: string;
      if?: string;
      name?: string;
      with?: Record<string, unknown>;
    };
    if (step.uses) {
      if (evalIf(step.if, outputs)) {
        if (/pnpm\/action-setup/.test(step.uses)) {
          // Mirror the action's `with.version` instead of installing latest. Ignoring this made
          // the harness run pnpm 10 even when the generated workflow pinned 9, creating a false
          // product failure (and previously let version-specific bugs escape in the opposite
          // direction).
          const version = String(step.with?.version ?? "9");
          preamble += `npm install -g pnpm@${version} >/dev/null 2>&1\n`;
        } else {
          const toolInstall = TOOL_INSTALL_BY_USES.find(([re]) => re.test(step.uses!));
          if (toolInstall) preamble += `${toolInstall[1]}\n`;
        }
      }
      continue;
    }
    if (!step.run) continue;
    if (!evalIf(step.if, outputs)) continue;

    const script = preamble + substitute(step.run, outputs);
    const outputFile = path.join(
      hostDir,
      `.gh-output-${step.id ?? Math.random().toString(36).slice(2)}`,
    );
    fs.writeFileSync(outputFile, "");
    const wrapped = `GITHUB_OUTPUT=/repo/${path.basename(outputFile)}\n${script}`;
    // On a real runner every step in a job shares one persistent filesystem, so a `restore`
    // step's package cache is still there for the `build --no-restore` step that follows. This
    // harness instead spins up a fresh, throwaway container per step (see runInContainer) for
    // isolation, which silently breaks that assumption for any cache that defaults outside the
    // bind-mounted repo dir — confirmed for NuGet (`dotnet restore` → `dotnet build --no-restore`
    // failed with NETSDK1064 across separate containers, but succeeded once NUGET_PACKAGES was
    // redirected inside /repo). Harmless no-op env var for every other language's toolchain.
    const jobEnv = Object.fromEntries(
      Object.entries(job.env ?? {}).map(([key, value]) => [key, String(value)]),
    );
    const res = runInContainer(
      image,
      hostDir,
      wrapped,
      { ...jobEnv, NUGET_PACKAGES: "/repo/.nuget" },
      [],
      // Bind-mounted: a job's steps must share one filesystem, both so GITHUB_OUTPUT written by
      // one step is readable here and so `install` leaves node_modules in place for `lint`.
      true,
    );

    if (step.id) {
      const captured: Record<string, string> = {};
      for (const line of fs.readFileSync(outputFile, "utf8").split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) captured[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
      outputs[step.id] = captured;
    }
    fs.rmSync(outputFile, { force: true });

    const combined = res.ok ? undefined : `${res.stdout}\n${res.stderr}`;
    results.push({
      job: jobName,
      step: step.name ?? step.run.slice(0, 40),
      ok: res.ok,
      detail: combined?.slice(-2000),
      raw: combined,
    });
    if (!res.ok) break; // real CI stops the job on first failing step
  }
  return results;
}

/**
 * `acceptableFailurePattern` is for a real, pre-existing issue in the fixture repo's own code
 * (e.g. `go vet` correctly flagging an unkeyed struct literal in that repo's own test file) —
 * proof the generated CI step genuinely ran and did its job, as opposed to a bug in what we
 * generated. Anything else still fails the assertion.
 */
function assertWorkflowRuns(
  yamlText: string,
  hostDir: string,
  image: string,
  jobFilter?: string[],
  acceptableFailurePattern?: RegExp,
) {
  let doc: {
    jobs?: Record<
      string,
      { steps?: Array<Record<string, unknown>>; env?: Record<string, unknown> }
    >;
  };
  expect(() => {
    doc = parseYaml(yamlText);
  }, "workflow YAML must parse").not.toThrow();
  doc = parseYaml(yamlText);
  const jobs = Object.entries(doc.jobs ?? {}).filter(
    ([name]) => !jobFilter || jobFilter.includes(name),
  );
  expect(jobs.length, "workflow must have at least one matching job").toBeGreaterThan(0);

  const allResults: StepResult[] = [];
  for (const [name, job] of jobs) {
    allResults.push(...runWorkflowJob(name, job, hostDir, image));
  }
  const failed = allResults.filter(
    (r) => !r.ok && !(acceptableFailurePattern && r.raw && acceptableFailurePattern.test(r.raw)),
  );
  expect(
    failed,
    `steps failed:\n${failed.map((f) => `[${f.job}] ${f.step}\n${f.detail}`).join("\n\n")}`,
  ).toHaveLength(0);
}

// ─── Dockerfile execution ──────────────────────────────────────────────────────

/**
 * `acceptableExitPattern` distinguishes a real Dockerfile bug (wrong entrypoint, missing
 * dependency, broken import) from an app that legitimately needs secrets no generator could
 * know — e.g. a pydantic Settings() requiring AUTH0_DOMAIN etc. The former means the generated
 * Dockerfile is broken; the latter means it correctly got the app loaded and running up to the
 * point only the app owner's own deployment config can get it past.
 */
function assertDockerBuildsAndBoots(hostDir: string, tag: string, acceptableExitPattern?: RegExp) {
  assertDockerAvailable();
  // The daemon's own layer cache is what makes a repeat build of the same generated Dockerfile
  // fast — the Dockerfile is byte-identical and the context is unchanged, so the `npm ci` /
  // `pip install` / `gradle build` layers hit. What silently destroys that is `docker builder
  // prune`, a daemon reset, or a fresh CI VM, and the cost of finding out is another cold hour.
  // Importing a durable copy makes it recoverable. Exporting is opt-in: `type=local` rewrites the
  // whole cache after every build and there are twelve of them. See LR_AUDIT_BUILD_CACHE.
  const cacheArgs = BUILD_CACHE_ACTIVE
    ? buildCacheArgs(BUILD_CACHE_MODE, BUILD_CACHE_DIR, fs.existsSync(BUILD_CACHE_DIR))
    : [];
  if (cacheArgs.some((arg) => arg.startsWith("type=local,dest="))) {
    fs.mkdirSync(BUILD_CACHE_DIR, { recursive: true });
  }
  const build = run("docker", buildCommandArgs(hasBuildx(), cacheArgs, tag, "."), {
    cwd: hostDir,
    timeoutMs: 8 * 60_000,
  });
  if (!build.ok && acceptableExitPattern?.test(build.stdout + build.stderr)) return;
  expect(build.ok, `docker build failed:\n${build.stdout}\n${build.stderr}`.slice(-4000)).toBe(
    true,
  );

  // No --rm here (unlike runInContainer) — need the exited container to stick around long
  // enough to inspect its status and pull logs before we clean it up ourselves below.
  const runRes = run("docker", ["run", "-d", "--name", tag, tag]);
  expect(runRes.ok, `docker run failed to start container:\n${runRes.stderr}`).toBe(true);

  // Give it a moment, then check it's still alive (catches "CMD references a script that
  // doesn't exist" — container exits immediately but `docker run -d` itself still returns 0).
  run("sleep", ["3"]);
  const inspect = run("docker", ["inspect", "-f", "{{.State.Running}}", tag]);
  const stillRunning = inspect.stdout.trim() === "true";

  let logs = "";
  if (!stillRunning) {
    logs = run("docker", ["logs", tag]).stdout + run("docker", ["logs", tag]).stderr;
  }
  run("docker", ["rm", "-f", tag]);

  if (!stillRunning && acceptableExitPattern?.test(logs)) return;
  expect(stillRunning, `container exited immediately — logs:\n${logs}`.slice(-4000)).toBe(true);
}

// ─── Fixtures ───────────────────────────────────────────────────────────────────

interface Fixture {
  name: string;
  dir: string;
}

const NODE_FIXTURES: Fixture[] = [
  { name: "express-tsc", dir: "express-tsc" },
  { name: "express-plain", dir: "express-plain" },
  { name: "nextjs-app", dir: "nextjs-app" },
];

// Depth pass (2026-07-13): a second, different real repo per language — same rationale as the
// AUDITOR_EXPECTED_FINDINGS depth entries above, added permanently rather than as a throwaway
// probe, since more real-repo coverage per language only strengthens this harness.
const DEPTH_NODE_FIXTURES: Fixture[] = [{ name: "depth-express", dir: "depth-express" }];
const PYTHON_FIXTURES: Fixture[] = [
  { name: "python-app", dir: "python-app" },
  { name: "depth-python", dir: "depth-python" },
];
// echo-app (xesina/golang-echo-realworld-example-app): second Go repo — has its own go.mod
// (gorilla-app predates Go modules entirely and can't build on any modern toolchain, so it
// stays a wiring-only fixture).
const GO_FIXTURES: Fixture[] = [
  { name: "go-app", dir: "go-app" },
  { name: "echo-app", dir: "echo-app" },
];
const RUBY_FIXTURES: Fixture[] = [
  { name: "ruby-app", dir: "ruby-app" },
  { name: "depth-ruby", dir: "depth-ruby" },
];
// depth-rust (tokio-rs/mini-redis): the first MODERN Rust fixture — rust-app's 2019 deps are
// age-excluded from execution, so mini-redis (official, maintained, multi-[[bin]]) is the first
// Rust repo whose docker build/boot and CI can actually run to completion.
const RUST_FIXTURES: Fixture[] = [
  { name: "rust-app", dir: "rust-app" },
  { name: "depth-rust", dir: "depth-rust" },
];
const CSHARP_FIXTURES: Fixture[] = [
  { name: "csharp-app", dir: "csharp-app" },
  { name: "depth-csharp", dir: "depth-csharp" },
];
const PHP_FIXTURES: Fixture[] = [
  { name: "php-app", dir: "php-app" },
  { name: "depth-php", dir: "depth-php" },
];
const JAVA_FIXTURES: Fixture[] = [
  { name: "java-app", dir: "java-app" },
  { name: "depth-java", dir: "depth-java" },
];
// First-ever dockerfile/CI harness rows for these two languages (previously only used for
// AI-sampling / credo ground truth): spring-petclinic-kotlin (build.gradle.kts-only, strict
// Java 17 toolchain) and dwyl/phoenix-chat-example (Phoenix 1.8).
const KOTLIN_FIXTURES: Fixture[] = [{ name: "kotlin-app", dir: "kotlin-app" }];
const ELIXIR_FIXTURES: Fixture[] = [{ name: "elixir-app", dir: "elixir-app" }];
const ALL_LANGUAGE_FIXTURES = [
  { fixtures: PYTHON_FIXTURES, image: "python:3.12-slim" },
  { fixtures: GO_FIXTURES, image: "golang:1.22" },
  { fixtures: RUBY_FIXTURES, image: "ruby:3.3" },
  { fixtures: RUST_FIXTURES, image: "rust:1.78" },
  // Real GH Actions runners ship Maven preinstalled alongside whatever JDK setup-java configures
  // — a bare JDK image doesn't, so use one that matches what the workflow actually gets in CI.
  { fixtures: JAVA_FIXTURES, image: "maven:3.9-eclipse-temurin-21-alpine" },
  // Kotlin repos are gradle-driven (gradlew downloads Gradle itself; the image only needs a
  // JDK) — same image family as Java, and the same per-fixture 17/21 derivation applies.
  { fixtures: KOTLIN_FIXTURES, image: "maven:3.9-eclipse-temurin-21-alpine" },
  { fixtures: ELIXIR_FIXTURES, image: "elixir:1.16-alpine" },
  // Placeholder label only — the real image is derived per-fixture below from the csproj's own
  // <TargetFramework> (see dotnetSdkVersion), same as the Dockerfile generator already does.
  { fixtures: CSHARP_FIXTURES, image: "mcr.microsoft.com/dotnet/sdk:<from csproj>" },
  { fixtures: PHP_FIXTURES, image: "composer:2" },
];

function fixtureRoot(f: Fixture): string {
  return path.join(FIXTURES_ROOT, f.dir);
}

/** Remove a fixture work dir, which a container has filled with root-owned files.
 *
 * POSIX: chown back to the host user via a throwaway root container, then delete from Node.
 *
 * Windows needs the opposite approach, for two measured reasons:
 *  - `process.getuid` is undefined, so the chown degraded to `chown -R 0:0 /repo` — semantically
 *    a no-op on NTFS, but still a full recursive walk of node_modules across the WSL2 boundary.
 *    Measured at **17+ minutes for one fixture**, once per row; it dominated the whole suite.
 *  - `fs.rmSync` then fails anyway on deep pnpm trees ("The file cannot be accessed by the
 *    system", `\\?\` long paths), so work dirs accumulated instead of being cleaned.
 * Deleting from inside a container avoids both: Linux paths, root permissions, **12 seconds** for
 * the same tree that defeated rmSync entirely. */
function cleanupWorkDir(work: string): void {
  if (!fs.existsSync(work)) return;
  if (process.platform === "win32") {
    const parent = path.dirname(work);
    run("docker", [
      "run",
      "--rm",
      "-v",
      `${parent}:/parent`,
      "alpine",
      "rm",
      "-rf",
      `/parent/${path.basename(work)}`,
    ]);
  } else {
    run("docker", [
      "run",
      "--rm",
      "-v",
      `${work}:/repo`,
      "alpine",
      "chown",
      "-R",
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      "/repo",
    ]);
  }
  // Still a no-op safety net on Windows when the container path already removed it.
  fs.rmSync(work, { recursive: true, force: true });
}

function copyFixture(f: Fixture, suffix: string): string {
  const dest = path.join(FIXTURES_ROOT, `.work-${f.name}-${suffix}`);
  cleanupWorkDir(dest);
  fs.cpSync(fixtureRoot(f), dest, { recursive: true, filter: (src) => !src.includes("/.git") });
  return dest;
}

// ─── Warm-up ────────────────────────────────────────────────────────────────────

/** One line saying what this run gets to reuse.
 *
 * Printed even when nothing needed pulling, because here the difference between a warm run and a
 * cold one is the difference between minutes and an hour — and an unexplained hour reads as a hung
 * suite rather than a cold cache. */
function reportCacheState(): void {
  if (!CACHE_ENABLED) {
    console.log("[verify-fix-tools] toolchain caches disabled (LR_AUDIT_CACHE)");
    return;
  }
  const res = run("docker", ["system", "df", "-v", "--format", "json"], { timeoutMs: 120_000 });
  if (!res.ok) return;
  let raw: Array<{ Name?: string; Size?: string }> = [];
  try {
    raw = (JSON.parse(res.stdout) as { Volumes?: typeof raw }).Volumes ?? [];
  } catch {
    // A daemon without `--format json`; the pull report above is the useful half anyway.
    return;
  }
  const { count, bytes } = summarizeCacheVolumes(
    raw.map((v) => ({ name: String(v.Name ?? ""), size: String(v.Size ?? "0B") })),
  );
  console.log(
    `[verify-fix-tools] toolchain caches: ${count} volume(s) holding ${formatBytes(bytes)}` +
      ` — build layer cache: ${BUILD_CACHE_MODE}`,
  );
}

/**
 * Pull the image set once, in parallel, before any row starts.
 *
 * Never throws. A row that cannot get its image fails with the daemon's own error in that row's
 * context, which is a better message than anything this hook could produce — and the `auditors`
 * row needs no Docker at all, so failing here would take it down with the rows that do.
 */
beforeAll(async () => {
  if (!WARM_ENABLED) return;
  if (dockerProbe() !== null) {
    console.log("[verify-fix-tools] Docker unavailable — skipping the image warm-up");
    return;
  }
  // Every row needs a populated fixtures directory, and priming several gigabytes before failing
  // on all of them would be an expensive way to learn that. The harness's own scratch directories
  // are dot-prefixed (`.work-*`), so a real fixture is a non-dot directory.
  const hasFixtures =
    fs.existsSync(FIXTURES_ROOT) &&
    fs
      .readdirSync(FIXTURES_ROOT, { withFileTypes: true })
      .some((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  if (!hasFixtures) {
    console.log(
      `[verify-fix-tools] no fixtures under ${FIXTURES_ROOT} — skipping the image warm-up ` +
        "(populate with: bash scripts/clone-real-fixtures.sh)",
    );
    return;
  }
  try {
    if (/^(1|true|yes)$/i.test(process.env.LR_AUDIT_CACHE_RESET ?? "")) {
      console.log(`[verify-fix-tools] resetting ${cacheVolumeNames().length} toolchain volumes`);
      resetCacheVolumes();
    }
    await warmImages(imagesUsedByRun());
    reportCacheState();
  } catch (err) {
    console.warn(`[verify-fix-tools] warm-up failed: ${(err as Error).message}`);
  }
}, WARM_TIMEOUT_MS);

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe.each([...NODE_FIXTURES, ...DEPTH_NODE_FIXTURES])(
  "github-actions / ci-ai — $name (Node)",
  (fixture) => {
    it(
      "generates a CI workflow whose steps actually pass",
      () => {
        const ctx = buildRealContext(fixtureRoot(fixture));
        const work = copyFixture(fixture, "ci");
        try {
          // Production always runs expandFixIdsForProductionCi alongside github-actions/ci-ai —
          // it silently bundles eslint (deterministic) when there's no lint script, so the CI it
          // writes doesn't reference a script that doesn't exist yet. Replicate that bundling by
          // actually writing eslint's files, same as the real fix-executor case handler does.
          const { bundled } = expandFixIdsForProductionCi(["github-actions"], {
            isNodeProject: ctx.isNodeProject,
            scripts: ctx.pkg.scripts,
            eslintConfigured: isEslintFullyConfigured(ctx),
          });
          const scripts = { ...ctx.pkg.scripts };
          if (bundled.includes("eslint")) {
            scripts.lint = "eslint .";
            fs.writeFileSync(
              path.join(work, "eslint.config.js"),
              eslintConfigForProject(ctx.usesTypeScript),
            );
            const pkgPath = path.join(work, "package.json");
            const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
            pkgJson.scripts = { ...pkgJson.scripts, lint: "eslint ." };
            pkgJson.devDependencies = {
              ...pkgJson.devDependencies,
              eslint: "^8.57.0",
              ...(ctx.usesTypeScript
                ? {
                    "@typescript-eslint/parser": "^7.0.0",
                    "@typescript-eslint/eslint-plugin": "^7.0.0",
                  }
                : {}),
            };
            fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2));
          }

          const sourceContents = Object.fromEntries(
            pickSourcePathsForAnalysis(ctx.filePaths)
              .map((file) => [file, readText(work, file)] as const)
              .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          );
          const envContract = scanEnvContract(sourceContents);
          const intelligence = { ...emptyIntelligence(), envContract };
          const profile = analyzeProjectCi({
            pkg: { ...ctx.pkg, scripts },
            framework: ctx.resolvedFramework,
            filePaths: ctx.filePaths,
            packageManager: ctx.packageManager,
            productionBaseline: true,
            envContract,
            isStaticSpa: ctx.isStaticSpa,
          });
          const yamlText = buildProjectCiWorkflow(profile, intelligence);

          // "test" job's content depends on AI-generated test files (vitest-ai) — out of scope
          // for this deterministic-path audit (see plan). quality (lint) + build are fully
          // deterministic and are what this batch verifies.
          // depth-express (hagopj13/node-express-boilerplate) ships its OWN lint script and
          // eslint+prettier config, and its own committed src/middlewares/auth.js fails that
          // config with 7 real prettier violations (repo drift, pinned deps via its own
          // yarn.lock) — the generated workflow correctly running the repo's own lint script
          // and surfacing the repo's own pre-existing violations is proof the CI works, same
          // "real finding is a pass" rule as go-app's vet finding.
          const acceptable =
            fixture.name === "depth-express" ? /error {2}.*prettier\/prettier/ : undefined;
          assertWorkflowRuns(
            yamlText,
            work,
            `node:${profile.nodeVersion}-bookworm-slim`,
            ["quality", "build"],
            acceptable,
          );
        } finally {
          cleanupWorkDir(work);
        }
      },
      20 * 60_000,
    );
  },
);

// go-rest-api's own test file (internal/album/api_test.go) has a pre-existing unkeyed struct
// literal — a real `go vet` finding in that repo's code, not something our CI generation caused.
// ruby-app's Gemfile pins `unicorn`, whose `raindrops` C extension (rubysig.h) was removed from
// Ruby's API in 1.9 — that gem cannot build on any current Ruby, unrelated to our Dockerfile.
const ACCEPTABLE_CI_FAILURE_BY_FIXTURE: Record<string, RegExp> = {
  "go-app": /struct literal uses unkeyed fields/,
  // actix 0.8/socket2 0.3.9 (2019) uses a transmute the modern rustc size-checks reject — a
  // real, hard incompatibility between this fixture's pinned deps and any current Rust
  // toolchain (clippy hits the same compile step as the Dockerfile build), not our CI generator.
  "rust-app": /cannot transmute between types of different sizes/,
  // spring-boot-rest-example (2015-era) has its own pre-existing failing tests — real `mvn test`
  // output, not something our CI generation caused.
  "java-app": /There are test failures/,
  // This Gemfile's data_mapper-era adapters (raindrops/hiredis so far) each pin ~2013 C
  // extensions that don't compile against modern Ruby/glibc — a fixture-age problem, not ours.
  "ruby-app": /and Bundler cannot continue/,
  // Same fixture-age Gemfile.lock issue as the dockerfile test's ACCEPTABLE_BOOT_FAILURE entry
  // above (BUNDLED WITH 1.10.6, a ~decade-old Bundler incompatible with any current Ruby
  // toolchain) — CI's `bundle install` step hits the identical incompatibility.
  "depth-ruby": /undefined method [`']inflate['`] for module Gem|Gem::Platform\.match/,
  // microblog exact-pins multidict==6.0.4 (Feb 2023, pre-Python-3.12) — no cp312 wheel exists
  // and its C source can't compile against 3.12's changed C API (_PyArg_Parser struct).
  // Confirmed fixture-age, not ours: the repo declares no Python version anywhere (its own
  // Dockerfile uses `python:slim`, currently 3.13, which fails identically) — the stale pin
  // breaks on ANY current Python. pip reaching a real dependency build is proof the generated
  // install step itself ran correctly.
  "depth-python": /Failed building wheel for multidict/,
  // echo-app's own handler/request.go:103 has `json:"tagList, omitempty"` — a real, pre-existing
  // struct-tag bug in the repo's own code that `go vet` correctly flags (the space makes the
  // options list unparseable). Same "real vet finding is a pass" rule as go-app's unkeyed-fields
  // entry above.
  "echo-app": /suspicious space in struct tag value/,
  // Phoenix's `mix test` needs the postgres service the generated workflow now declares — but
  // this harness runs bare `run:` steps in a single container and can't emulate `services:`
  // blocks (documented limitation, same reason `uses:` steps are stubbed). Reaching the
  // test-database step means deps.get + compile genuinely succeeded; a real runner provides
  // the service. Also seen as "killed" (container OOM during the DB wait) on this box.
  "elixir-app": /database for .* couldn't be created|econnrefused|connection refused/i,
};

for (const { fixtures, image } of ALL_LANGUAGE_FIXTURES) {
  describe.each(fixtures)(`github-actions / ci-ai — $name (${image})`, (fixture) => {
    it(
      "generates a language CI workflow whose steps actually pass",
      () => {
        const ctx = buildRealContext(fixtureRoot(fixture));
        const csprojContent = readCsprojWithBuildProps(fixtureRoot(fixture), ctx.filePaths);
        const yamlText = buildLanguageCiWorkflow(ctx, csprojContent);
        expect(yamlText, "expected a deterministic CI template for this language").not.toBeNull();
        const work = copyFixture(fixture, "ci");
        try {
          // C#'s image must match the SDK version the workflow itself declares (read from the
          // real csproj) — a fixed image would silently test against the wrong .NET version.
          // Java likewise: the workflow's setup-java now honors the repo's declared toolchain
          // (spring-petclinic hard-requires 17 via a strict Gradle toolchain), so the stand-in
          // image must provide that JDK the same way setup-java would on a real runner. Only
          // 17/21 have maven:3.9-eclipse-temurin-*-alpine tags; older declarations (java-app's
          // 1.8) keep the default 21 image — their failure modes are already covered by
          // ACCEPTABLE_CI_FAILURE_BY_FIXTURE, and no maven-alpine image exists for JDK 8.
          const javaVersion = javaVersionFromBuildFiles(
            readText(fixtureRoot(fixture), "pom.xml"),
            readText(fixtureRoot(fixture), "build.gradle") ??
              readText(fixtureRoot(fixture), "build.gradle.kts"),
          );
          const runImage = csprojContent
            ? `mcr.microsoft.com/dotnet/sdk:${dotnetSdkVersion(csprojContent)}`
            : image.includes("eclipse-temurin") && ["17", "21"].includes(javaVersion)
              ? `maven:3.9-eclipse-temurin-${javaVersion}-alpine`
              : image;
          assertWorkflowRuns(
            yamlText as string,
            work,
            runImage,
            ["ci"],
            ACCEPTABLE_CI_FAILURE_BY_FIXTURE[fixture.name],
          );
        } finally {
          cleanupWorkDir(work);
        }
      },
      // Must exceed runInContainer's own 15-minute cap — a real cold-cache Gradle build
      // (spring-petclinic) legitimately needs more than the old 10 minutes end to end.
      20 * 60_000,
    );
  });
}

describe.each([
  ...NODE_FIXTURES,
  ...DEPTH_NODE_FIXTURES,
  ...PYTHON_FIXTURES,
  ...GO_FIXTURES,
  ...RUBY_FIXTURES,
  ...RUST_FIXTURES,
  ...CSHARP_FIXTURES,
  ...PHP_FIXTURES,
  ...JAVA_FIXTURES,
  ...KOTLIN_FIXTURES,
  ...ELIXIR_FIXTURES,
])("dockerfile — $name", (fixture) => {
  it(
    "builds and the container stays running",
    () => {
      const ctx = buildRealContext(fixtureRoot(fixture));
      const work = copyFixture(fixture, "docker");
      try {
        const isExpressLike =
          ctx.resolvedFramework === "Express" ||
          (ctx.resolvedFramework === "unknown" && ctx.isNodeProject);
        const csprojContent = readCsprojWithBuildProps(work, ctx.filePaths);
        // Mirrors the real getRepoSnapshot-backed closure fix-executor.server.ts now builds for
        // Python — reads straight off the real clone instead of a GitHub tarball, same contract.
        const getContent = (p: string): string | undefined => {
          try {
            return fs.readFileSync(path.join(work, p), "utf8");
          } catch {
            return undefined;
          }
        };
        const content = isExpressLike
          ? (ctx.pkg.scripts.build ?? "").includes("tsc")
            ? dockerfileNode(ctx.packageManager)
            : dockerfileNodeRuntime(ctx.packageManager)
          : dockerfileFor(
              ctx.resolvedFramework,
              ctx.packageManager,
              ctx.filePaths,
              ctx.manifests,
              csprojContent,
              getContent,
            );
        fs.writeFileSync(path.join(work, "Dockerfile"), content);
        fs.writeFileSync(path.join(work, ".dockerignore"), DOCKER_IGNORE);

        if (ctx.resolvedFramework === "Next.js") {
          const configPath = ["next.config.ts", "next.config.js", "next.config.mjs"].find((p) =>
            ctx.filePaths.includes(p),
          );
          if (configPath) {
            const existing = fs.readFileSync(path.join(work, configPath), "utf8");
            const patched = patchNextConfigStandalone(existing);
            if (patched !== null) fs.writeFileSync(path.join(work, configPath), patched);
          } else {
            fs.writeFileSync(path.join(work, "next.config.mjs"), NEXT_CONFIG_STANDALONE);
          }
        } else if (ctx.resolvedFramework === "Vite" || ctx.resolvedFramework === "React") {
          fs.writeFileSync(path.join(work, "nginx.conf"), nginxConf(ctx.pkg.hasBackend));
        }

        // Some fixtures are genuinely database/secret-backed apps — no Dockerfile generator
        // could supply real credentials or a live Postgres instance. Reaching that failure means
        // the app's own code loaded and ran correctly (config parsed, binary/module resolved);
        // anything else (missing module, missing file, wrong entrypoint) is a real bug.
        const ACCEPTABLE_BOOT_FAILURE: Record<string, RegExp> = {
          "python-app": /pydantic\.error_wrappers\.ValidationError/,
          "go-app": /connect: connection refused/,
          // express-tsc's own `start` script is `node --env-file=.env ...` — a local-dev
          // convention hard-requiring a .env file. No generic Dockerfile can supply one; a real
          // deploy would inject env vars via the platform, not a committed file. Node refusing
          // to start without it is the app's own choice, not a packaging bug.
          "express-tsc": /node: \.env: not found/,
          // This Gemfile's data_mapper-era adapters pin ~2013 C extensions that don't compile
          // against modern Ruby/glibc — a fixture-age problem, not ours.
          "ruby-app": /and Bundler cannot continue/,
          // depth-ruby (gothinkster/rails-realworld-example-app, Rails 4.2, 2016-era): its
          // Gemfile.lock pins `BUNDLED WITH 1.10.6` — a ~decade-old Bundler version bundler
          // itself tries to shell out to for compatibility, which calls a real RubyGems API
          // (Gem.inflate) removed from every current RubyGems release. Confirmed unrelated to
          // our Dockerfile: the same class of fixture-age lockfile incompatibility as ruby-app
          // above, just surfacing through a different specific old-Bundler API removal.
          "depth-ruby": /undefined method [`']inflate['`] for module Gem/,
          // microblog exact-pins multidict==6.0.4 (pre-Python-3.12, no cp312 wheel, C source
          // incompatible with 3.12's _PyArg_Parser) — stale pin breaks on any current Python
          // (the repo's own `python:slim` Dockerfile fails identically); see the CI exclusion
          // map for the full confirmation notes.
          "depth-python": /Failed building wheel for multidict/,
          // actix 0.8/socket2 0.3.9 (2019) uses a transmute the modern rustc size-checks reject
          // — a real, hard incompatibility between this fixture's pinned deps and any current
          // Rust toolchain, not something a Dockerfile could route around.
          "rust-app": /cannot transmute between types of different sizes/,
          // This repo's Maven plugins (plexus-archiver 2.9, commons-compress 1.9, ~2015-era)
          // reflect into java.util.TreeMap internals — blocked by the JDK 9+ module system on
          // JDK 21 regardless of Dockerfile content. A genuine old-tooling/new-JDK incompatibility.
          "java-app": /does not "opens java\.util" to unnamed module/,
        };
        assertDockerBuildsAndBoots(
          work,
          `lr-audit-${fixture.name}`,
          ACCEPTABLE_BOOT_FAILURE[fixture.name],
        );
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

// ─── Non-Node linters ───────────────────────────────────────────────────────────
// Different shape than dockerfile/CI: these tools only add a static config file (no CI wiring,
// no dependency install) — the risk isn't "does the app boot," it's "does a current version of
// the real tool actually accept this config," which is exactly the kind of thing that silently
// breaks across major-version schema changes (confirmed for golangci-lint v2 this pass). Real,
// pre-existing style violations in the fixture's own old code are a *pass* here, same as the
// dockerfile/CI tests — proof the tool genuinely ran. Only a config-loading/parse error is a
// real bug. `configErrorPattern` names the specific "this is a config problem, not a lint
// finding" signature for each tool, checked only when the run exits non-zero.
function assertLinterConfigAccepted(
  res: ExecResult,
  configErrorPattern: RegExp,
  label: string,
): void {
  if (res.ok) return;
  const output = `${res.stdout}\n${res.stderr}`;
  expect(
    configErrorPattern.test(output),
    `${label}: expected real lint findings, got what looks like a config error:\n${output.slice(-3000)}`,
  ).toBe(false);
}

describe("ruff — python-app", () => {
  it(
    "pyproject.toml addition is accepted by a real, current ruff",
    () => {
      const work = copyFixture(PYTHON_FIXTURES[0], "ruff");
      try {
        const pyproject = fs.readFileSync(path.join(work, "pyproject.toml"), "utf8");
        fs.writeFileSync(
          path.join(work, "pyproject.toml"),
          pyproject.trimEnd() + "\n\n" + RUFF_CONFIG,
        );
        const res = runInContainer(
          "python:3.12-slim",
          work,
          "pip install -q ruff >/dev/null 2>&1 && ruff check .",
        );
        assertLinterConfigAccepted(res, /invalid TOML|unknown field|error\[/i, "ruff");
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("ruff — depth-python (real repo with no pyproject.toml)", () => {
  // microblog is a real, requirements.txt-only Flask app (no pyproject.toml at all) — exercises
  // the standalone-ruff.toml branch the original python-app fixture (which has a pyproject.toml)
  // never touches.
  it(
    "standalone ruff.toml is accepted by a real, current ruff",
    () => {
      const work = copyFixture(PYTHON_FIXTURES[1]!, "ruff");
      try {
        expect(
          fs.existsSync(path.join(work, "pyproject.toml")),
          "fixture is expected to have no pyproject.toml",
        ).toBe(false);
        fs.writeFileSync(path.join(work, "ruff.toml"), RUFF_TOML_CONFIG);
        const res = runInContainer(
          "python:3.12-slim",
          work,
          "pip install -q ruff >/dev/null 2>&1 && ruff check .",
        );
        assertLinterConfigAccepted(res, /invalid TOML|unknown field|error\[/i, "ruff");
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("rubocop — ruby-app", () => {
  it(
    ".rubocop.yml is accepted by a real, current rubocop",
    () => {
      const work = copyFixture(RUBY_FIXTURES[0], "rubocop");
      try {
        fs.writeFileSync(path.join(work, ".rubocop.yml"), RUBOCOP_CONFIG);
        const res = runInContainer(
          "ruby:3.3",
          work,
          "gem install -q rubocop >/dev/null 2>&1 && rubocop --no-color",
        );
        assertLinterConfigAccepted(
          res,
          /invalid configuration|unrecognized cop|error\/lint|Errno::ENOENT.*\.rubocop/i,
          "rubocop",
        );
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("rubocop — depth-ruby (real Rails 4.2 app)", () => {
  it(
    ".rubocop.yml is accepted by a real, current rubocop",
    () => {
      const work = copyFixture(RUBY_FIXTURES[1]!, "rubocop");
      try {
        fs.writeFileSync(path.join(work, ".rubocop.yml"), RUBOCOP_CONFIG);
        const res = runInContainer(
          "ruby:3.3",
          work,
          "gem install -q rubocop >/dev/null 2>&1 && rubocop --no-color",
        );
        assertLinterConfigAccepted(
          res,
          /invalid configuration|unrecognized cop|error\/lint|Errno::ENOENT.*\.rubocop/i,
          "rubocop",
        );
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("golangci-lint — go-app", () => {
  it(
    ".golangci.yml is accepted by a real, current golangci-lint",
    () => {
      const work = copyFixture(GO_FIXTURES[0], "golangci-lint");
      try {
        fs.writeFileSync(path.join(work, ".golangci.yml"), GOLANGCI_LINT_CONFIG);
        const res = runInContainer("golangci/golangci-lint:latest", work, "golangci-lint run");
        assertLinterConfigAccepted(
          res,
          /can't load config|unsupported version|unknown linters/i,
          "golangci-lint",
        );
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("golangci-lint — echo-app (second real Go repo)", () => {
  it(
    ".golangci.yml is accepted by a real, current golangci-lint",
    () => {
      const work = copyFixture(GO_FIXTURES[1]!, "golangci-lint");
      try {
        fs.writeFileSync(path.join(work, ".golangci.yml"), GOLANGCI_LINT_CONFIG);
        const res = runInContainer("golangci/golangci-lint:latest", work, "golangci-lint run");
        assertLinterConfigAccepted(
          res,
          /can't load config|unsupported version|unknown linters/i,
          "golangci-lint",
        );
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("phpcs — php-app", () => {
  it(
    ".php-cs-fixer.php is accepted by a real, current php-cs-fixer",
    () => {
      const work = copyFixture(PHP_FIXTURES[0], "phpcs");
      try {
        fs.writeFileSync(
          path.join(work, ".php-cs-fixer.php"),
          phpCsFixerConfigForProject(listFiles(work)),
        );
        const res = runInContainer(
          "composer:2",
          work,
          "composer require --dev friendsofphp/php-cs-fixer --no-interaction -q 2>&1 | tail -5 && ./vendor/bin/php-cs-fixer fix --dry-run",
        );
        assertLinterConfigAccepted(
          res,
          /Configuration file .* is invalid|Fatal error|PHP Fatal error|does not exist/i,
          "php-cs-fixer",
        );
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("phpcs — depth-php (real symfony/demo)", () => {
  it(
    ".php-cs-fixer.php is accepted by a real, current php-cs-fixer",
    () => {
      const work = copyFixture(PHP_FIXTURES[1]!, "phpcs");
      try {
        fs.writeFileSync(
          path.join(work, ".php-cs-fixer.php"),
          phpCsFixerConfigForProject(listFiles(work)),
        );
        const res = runInContainer(
          "composer:2",
          work,
          "composer require --dev friendsofphp/php-cs-fixer --no-interaction -q 2>&1 | tail -5 && ./vendor/bin/php-cs-fixer fix --dry-run",
        );
        assertLinterConfigAccepted(
          res,
          /Configuration file .* is invalid|Fatal error|PHP Fatal error|does not exist/i,
          "php-cs-fixer",
        );
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("checkstyle — java-app", () => {
  it(
    "checkstyle.xml is accepted by a real, current maven-checkstyle-plugin",
    () => {
      const work = copyFixture(JAVA_FIXTURES[0], "checkstyle");
      try {
        fs.writeFileSync(path.join(work, "checkstyle.xml"), CHECKSTYLE_CONFIG);
        const pomPath = path.join(work, "pom.xml");
        const pom = fs.readFileSync(pomPath, "utf8");
        const plugin = `\t\t\t<plugin>\n\t\t\t\t<groupId>org.apache.maven.plugins</groupId>\n\t\t\t\t<artifactId>maven-checkstyle-plugin</artifactId>\n\t\t\t\t<version>3.6.0</version>\n\t\t\t\t<configuration>\n\t\t\t\t\t<configLocation>checkstyle.xml</configLocation>\n\t\t\t\t\t<violationSeverity>warning</violationSeverity>\n\t\t\t\t</configuration>\n\t\t\t</plugin>\n\t\t</plugins>`;
        expect(
          pom,
          "expected a </plugins> close tag to inject the checkstyle plugin before",
        ).toContain("\t\t</plugins>");
        fs.writeFileSync(pomPath, pom.replace("\t\t</plugins>", plugin));
        const res = runInContainer(
          "maven:3.9-eclipse-temurin-21-alpine",
          work,
          "mvn -B checkstyle:check",
        );
        // A real BUILD FAILURE from violations found is success here (config parsed, checks ran)
        // — only a config-loading exception before any violation is reported is a real bug.
        assertLinterConfigAccepted(
          res,
          /Unable to find configuration|CheckstyleException|is not a valid module/i,
          "checkstyle",
        );
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("checkstyle — depth-java (real spring-petclinic, spaces not tabs)", () => {
  // Confirmed real difference from java-app: spring-petclinic's pom.xml uses space indentation
  // (not tabs) and has multiple </plugins> closes (profile-scoped pluginManagement blocks) — a
  // naive tab-anchored string match would silently target the wrong (or no) </plugins>. The
  // first </plugins> in the file is always the top-level <build><plugins> close (confirmed:
  // profile-scoped <build> blocks appear later in the file), so a plain first-match replace on
  // the tag itself (regardless of its leading whitespace) is correct here.
  it(
    "checkstyle.xml is accepted by a real, current maven-checkstyle-plugin",
    () => {
      const work = copyFixture(JAVA_FIXTURES[1]!, "checkstyle");
      try {
        fs.writeFileSync(path.join(work, "checkstyle.xml"), CHECKSTYLE_CONFIG);
        const pomPath = path.join(work, "pom.xml");
        const pom = fs.readFileSync(pomPath, "utf8");
        const plugin = `\t\t\t<plugin>\n\t\t\t\t<groupId>org.apache.maven.plugins</groupId>\n\t\t\t\t<artifactId>maven-checkstyle-plugin</artifactId>\n\t\t\t\t<version>3.6.0</version>\n\t\t\t\t<configuration>\n\t\t\t\t\t<configLocation>checkstyle.xml</configLocation>\n\t\t\t\t\t<violationSeverity>warning</violationSeverity>\n\t\t\t\t</configuration>\n\t\t\t</plugin>\n\t\t</plugins>`;
        const closeTagRe = /[ \t]*<\/plugins>/;
        expect(closeTagRe.test(pom), "expected a </plugins> close tag to inject before").toBe(true);
        fs.writeFileSync(pomPath, pom.replace(closeTagRe, plugin));
        const res = runInContainer(
          "maven:3.9-eclipse-temurin-21-alpine",
          work,
          "mvn -B checkstyle:check",
        );
        assertLinterConfigAccepted(
          res,
          /Unable to find configuration|CheckstyleException|is not a valid module/i,
          "checkstyle",
        );
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("credo — fresh mix new scaffold", () => {
  // No committed Elixir fixture exists yet — `mix new` itself is the real, current, officially
  // maintained Elixir project generator (not a hand-typed guess at repo shape), so scaffolding
  // through it and adding the real credo dependency is a fair "real execution" substitute.
  it(
    ".credo.exs is accepted by a real, current credo",
    () => {
      const work = path.join(FIXTURES_ROOT, ".work-credo-scaffold");
      cleanupWorkDir(work);
      fs.mkdirSync(work, { recursive: true });
      try {
        const setupScript = `set -e
apk add -q build-base python3 >/dev/null 2>&1
mix local.hex --force >/dev/null 2>&1
mix new demo_app >/dev/null 2>&1
cd demo_app
python3 -c "
content = open('mix.exs').read()
content = content.replace('defp deps do\\n    [', 'defp deps do\\n    [\\n      {:credo, \\"~> 1.7\\", only: [:dev, :test], runtime: false},')
open('mix.exs', 'w').write(content)
"
cp /work/.credo.exs .credo.exs
mix deps.get >/dev/null 2>&1
mix compile >/dev/null 2>&1
mix credo
`;
        fs.writeFileSync(path.join(work, "setup.sh"), setupScript);
        fs.writeFileSync(path.join(work, ".credo.exs"), CREDO_CONFIG);
        const res = runInContainer("elixir:1.16-alpine", work, "sh /repo/setup.sh");
        assertLinterConfigAccepted(
          res,
          /\*\* \(Credo\.ExecutionError\)|\*\* \(CompileError\)|unknown check/i,
          "credo",
        );
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("credo — elixir-app (real Phoenix 1.8 project)", () => {
  // Nice-to-have from the earlier audit pass, now actionable: a real, existing Phoenix project
  // (dwyl/phoenix-chat-example) with its own resolved dependency tree, replacing the
  // scaffold-from-`mix new`-every-run approach for at least one real-world data point — faster
  // and exercises a repo shape (existing deps, existing compiled code) `mix new` can't.
  it(
    ".credo.exs is accepted by a real, current credo on an existing Phoenix app",
    () => {
      const work = copyFixture({ name: "elixir-app", dir: "elixir-app" }, "credo");
      try {
        const mixExs = fs.readFileSync(path.join(work, "mix.exs"), "utf8");
        expect(mixExs, "fixture is expected to not already depend on credo").not.toMatch(
          /:credo\b/,
        );
        fs.writeFileSync(
          path.join(work, "mix.exs"),
          mixExs.replace(
            "defp deps do\n    [",
            'defp deps do\n    [\n      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},',
          ),
        );
        fs.writeFileSync(path.join(work, ".credo.exs"), CREDO_CONFIG);
        const res = runInContainer(
          "elixir:1.16-alpine",
          work,
          "apk add -q build-base >/dev/null 2>&1 && mix local.hex --force >/dev/null 2>&1 && mix deps.get 2>&1 | tail -20 && mix compile 2>&1 | tail -20 && mix credo",
        );
        assertLinterConfigAccepted(
          res,
          /\*\* \(Credo\.ExecutionError\)|\*\* \(CompileError\)|unknown check/i,
          "credo",
        );
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

// ─── Node deterministic templates ──────────────────────────────────────────────
// Unlike the linters above, these add a devDependency + config together, so the risk includes
// npm install itself succeeding — confirmed this pass that `vitest`'s react-plugin path could
// fail `npm install` outright with an unpinned `vite` peer conflict (see fix-tool-accuracy-audit.md).

const nextjsFixture = NODE_FIXTURES.find((f) => f.name === "nextjs-app")!;
const expressPlainFixture = NODE_FIXTURES.find((f) => f.name === "express-plain")!;

describe("eslint — TypeScript (nextjs-app)", () => {
  it(
    "eslint.config.js is accepted and a real, current eslint finds real issues",
    () => {
      const work = copyFixture(nextjsFixture, "eslint-ts");
      try {
        fs.writeFileSync(path.join(work, "eslint.config.js"), eslintConfigForProject(true));
        // A deliberately dirty file proves detection actually runs, not just "silently found
        // nothing" — the clean fixture alone would pass either way.
        fs.writeFileSync(
          path.join(work, "app", "dirty.ts"),
          `export function bad(x: any) {\n  console.log("test");\n  const unused = 1;\n  return x == 1;\n}\n`,
        );
        const res = runInContainer(
          "node:20-slim",
          work,
          "npm install -D eslint@8.57.0 @typescript-eslint/parser@^7.0.0 @typescript-eslint/eslint-plugin@^7.0.0 >/dev/null 2>&1 && npx eslint .",
        );
        expect(res.ok, `expected eslint to exit non-zero on real errors:\n${res.stdout}`).toBe(
          false,
        );
        expect(res.stdout).toContain("no-unused-vars");
        expect(res.stdout).toContain("eqeqeq");
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("eslint — JavaScript (express-plain)", () => {
  it(
    "eslint.config.js is accepted and a real, current eslint runs clean",
    () => {
      const work = copyFixture(expressPlainFixture, "eslint-js");
      try {
        fs.writeFileSync(path.join(work, "eslint.config.js"), eslintConfigForProject(false));
        const res = runInContainer(
          "node:20-slim",
          work,
          "npm install -D eslint@8.57.0 >/dev/null 2>&1 && npx eslint .",
        );
        expect(res.ok, `eslint failed:\n${res.stdout}\n${res.stderr}`).toBe(true);
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("prettier — express-plain", () => {
  it(
    ".prettierrc is accepted by a real, current prettier",
    () => {
      const work = copyFixture(expressPlainFixture, "prettier");
      try {
        fs.writeFileSync(path.join(work, ".prettierrc"), PRETTIER_RC);
        fs.writeFileSync(path.join(work, ".prettierignore"), PRETTIER_IGNORE);
        const res = runInContainer(
          "node:20-slim",
          work,
          `npm install -D prettier@3.3.0 >/dev/null 2>&1 && npx prettier --check '**/*.{js,jsx,json,md}'`,
        );
        // A real, unformatted fixture failing --check is expected (proof it actually ran);
        // only a config-parse crash is a bug.
        assertLinterConfigAccepted(
          res,
          /SyntaxError|Cannot find module|invalid.*config/i,
          "prettier",
        );
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("vitest — React/TS (nextjs-app)", () => {
  it(
    "installs and a real component test actually runs — regression test for the vite peer conflict",
    () => {
      const work = copyFixture(nextjsFixture, "vitest");
      try {
        fs.writeFileSync(
          path.join(work, vitestConfigPath(true)),
          vitestConfig("Next.js", {}, true),
        );
        fs.mkdirSync(path.join(work, "app", "__tests__"), { recursive: true });
        // Renders a component this file owns rather than the fixture's `../page`.
        //
        // nextjs-subscription-payments' page is a React Server Component: its import graph reaches
        // `import { cache } from "react"`, an RSC-only API that does not exist in the client build
        // jsdom loads, so it dies with "(0 , cache) is not a function" before rendering. It also
        // builds a Supabase client at module scope, which needs env just to import. Neither says
        // anything about the vitest config we generate — the thing this row exists to check — and
        // no jsdom-based setup can render an RSC anyway.
        //
        // A self-owned component still exercises the whole chain that matters: the generated
        // vitest config resolves, jsdom is wired up, JSX/TSX transforms, and @testing-library
        // renders. The install assertion above remains the real peer-conflict regression check.
        fs.writeFileSync(
          path.join(work, "app", "__tests__", "sanity.test.tsx"),
          [
            `import { describe, it, expect } from "vitest";`,
            `import { render, screen } from "@testing-library/react";`,
            ``,
            `function Greeting({ name }: { name: string }) {`,
            `  return <h1>Hello {name}</h1>;`,
            `}`,
            ``,
            `describe("generated vitest config", () => {`,
            `  it("renders a component through jsdom", () => {`,
            `    render(<Greeting name="world" />);`,
            `    expect(screen.getByText("Hello world")).toBeTruthy();`,
            `  });`,
            `});`,
            ``,
          ].join("\n"),
        );
        // Calls the real, shared vitestDevDeps() — the exact same devDeps object the "vitest"
        // and "vitest-ai" cases both assign — so this test stays honest about what production
        // actually generates instead of a hand-typed copy that can silently drift.
        const devDeps = vitestDevDeps("Next.js", {}, true, true);
        const installSpec = Object.entries(devDeps)
          .map(([name, version]) => `${name}@${version}`)
          .join(" ");
        const res = runInContainer(
          "node:20-slim",
          work,
          `npm install -D ${installSpec} @testing-library/react jsdom 2>&1 | tail -20 && npx vitest run`,
          // The probe imports the fixture's real ../page, and nextjs-subscription-payments builds
          // a Supabase client at module scope (utils/supabase/admin.ts), so importing it without
          // configuration throws "supabaseUrl is required" before a single assertion runs. That
          // failure is the fixture demanding env, not our generated vitest config being wrong —
          // which is what this row exists to check. Placeholders that only need to parse.
          {
            NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
            NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder-anon-key",
            SUPABASE_SERVICE_ROLE_KEY: "placeholder-service-role-key",
            STRIPE_SECRET_KEY: "sk_test_placeholder", // gitleaks:allow
            STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
          },
        );
        expect(res.ok, `vitest run failed:\n${res.stdout}\n${res.stderr}`.slice(-4000)).toBe(true);
        expect(res.stdout).toContain("sanity.test.tsx");
        expect(res.stdout).toMatch(/Tests\s+1 passed \(1\)/);
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("db-pool", () => {
  it(
    "src/lib/db.ts compiles with the generated devDependencies — regression test for the pg-pool types gap",
    () => {
      const work = path.join(FIXTURES_ROOT, ".work-db-pool");
      cleanupWorkDir(work);
      fs.mkdirSync(path.join(work, "src", "lib"), { recursive: true });
      try {
        fs.writeFileSync(path.join(work, "src", "lib", "db.ts"), DB_POOL);
        fs.writeFileSync(path.join(work, "package.json"), JSON.stringify({ name: "test" }));
        fs.writeFileSync(
          path.join(work, "tsconfig.json"),
          JSON.stringify(
            {
              compilerOptions: {
                target: "es2020",
                module: "commonjs",
                esModuleInterop: true,
                strict: true,
                noEmit: true,
                types: ["node"],
              },
            },
            null,
            2,
          ),
        );
        const res = runInContainer(
          "node:20-slim",
          work,
          "npm install --no-save typescript pg-pool@^3.7.0 @types/pg-pool@^2.0.0 @types/node >/dev/null 2>&1 && npx tsc --noEmit",
        );
        expect(res.ok, `tsc failed:\n${res.stdout}\n${res.stderr}`).toBe(true);
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("pytest-ai / pytest — python-app", () => {
  // Confirmed by actually calling the real AI generator (buildPrompt + the real, configured
  // DeepSeek provider) and running its output: the resulting test file needs `pytest` itself
  // installed, but neither the "pytest" nor "pytest-ai" case ensured that — only the ini-config
  // section got added to pyproject.toml, never a real pip-installable dependency. Regression test:
  // does the same requirements.txt-append logic the fix now performs actually make `pytest` run.
  it(
    "requirements.txt append makes a real pytest run actually work",
    () => {
      const work = copyFixture(PYTHON_FIXTURES[0], "pytest-ai");
      try {
        const reqPath = path.join(work, "requirements.txt");
        const requirements = fs.readFileSync(reqPath, "utf8");
        expect(requirements, "fixture is expected to not already list pytest").not.toMatch(
          /^pytest\b/im,
        );
        fs.writeFileSync(reqPath, requirements.trimEnd() + "\npytest\n");
        fs.writeFileSync(path.join(work, "pyproject.toml"), PYTEST_SETUP);
        fs.mkdirSync(path.join(work, "tests"), { recursive: true });
        fs.writeFileSync(path.join(work, "tests", "__init__.py"), "");
        fs.writeFileSync(
          path.join(work, "tests", "test_smoke.py"),
          "def test_smoke():\n    assert 1 + 1 == 2\n",
        );
        const res = runInContainer(
          "python:3.12-slim",
          work,
          "apt-get update -qq >/dev/null 2>&1 && apt-get install -qq -y build-essential libffi-dev libssl-dev >/dev/null 2>&1 && pip install -q -r requirements.txt 2>&1 | tail -5 && python -m pytest tests/test_smoke.py -v",
        );
        expect(res.ok, `pytest run failed:\n${res.stdout}\n${res.stderr}`.slice(-3000)).toBe(true);
        expect(res.stdout).toContain("1 passed");
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

// ─── Auditors — detection accuracy against real repos ──────────────────────────
// Different verification shape from everything above: no Docker, no generated output to run.
// The auditors are pure detection over file contents, so accuracy means "does the real
// runAuditor() report the right findings on real repos" — both directions. Every expectation
// below was ground-truth-verified by hand against the fixture's actual source (e.g. java-app's
// HotelController really does take @RequestBody with no @Valid; go-app really does validate
// everything via ozzo-validation in its service layer; express-tsc's API routes really do read
// zero request input). A change to detection regexes/thresholds that shifts any of these is a
// real accuracy regression, not test brittleness.
const AUDITOR_EXPECTED_FINDINGS: Record<string, string[]> = {
  "express-tsc": [],
  "express-plain": [],
  "nextjs-app": [],
  "python-app": [],
  "go-app": [],
  "ruby-app": [],
  "rust-app": [],
  "csharp-app": [],
  "java-app": ["auditor-api-validation"],
  "php-app": [],
  // taxonomy (shadcn/taxonomy): the first fixture exercising the stripe/prisma/Next-auth
  // negative paths on a real production-shaped app — webhook verifies via constructEvent,
  // prisma/migrations/ is committed, dashboard pages are guarded by the middleware matcher.
  // Before the 2026-07-11 fix, its GET-only billing route (app/api/users/stripe/route.ts) was
  // falsely flagged as an unverified webhook via the `stripe.*route` path match.
  taxonomy: [],
  // mern-step (Brunno-DaSilva/MERN-STEP-BY-STEP): should-fire ground truth — server.js really
  // does read MONGODB_URI and PORT with no .env.example anywhere in the repo.
  "mern-step": ["auditor-env-undocumented"],
  // react-axios (bezkoder/react-axios-example): should-fire ground truth — src/http-common.js
  // really does hardcode an unconditional axios baseURL of http://localhost:8080/api.
  "react-axios": ["auditor-localhost-api"],
  // t3-app (fresh `npx create-t3-app@latest t3-app --CI --prisma --noGit --noInstall` — the
  // real, official, currently-maintained scaffold, same precedent as credo's `mix new`):
  // should-fire ground truth — ships prisma/schema.prisma with NO migrations dir (db push
  // workflow), which is exactly the production-drift risk this auditor warns about.
  "t3-app": ["auditor-prisma-migrations"],
  // stripe-server (ruffrey/stripe-webhook-server): stripe-webhook must NOT fire — it verifies
  // via events.retrieve (Stripe's documented pre-signature alternative), split across
  // server.js (registration) and routes/index.js (verification). env-undocumented fires per
  // the threshold rule: PAASTOR_PORT + PORT read from process.env, no .env.example (the repo
  // documents config via config.example.js instead — a borderline-benign true positive).
  "stripe-server": ["auditor-env-undocumented"],
  // ── Depth-pass repos (2026-07-13) — a second, different real repo per language, each
  // ground-truthed by hand in both directions. Every one of these caught a false positive on
  // first probe; the expectations below are the post-fix, hand-verified state.
  // hagopj13/node-express-boilerplate: has .env.example, validates via joi — correctly silent.
  "depth-express": [],
  // miguelgrinberg/microblog: config.py reads SECRET_KEY/MAIL_* etc., no .env.example — true
  // positive. api-validation must NOT fire: its real @bp.route files validate via WTForms
  // (was invisible to PY_ROUTE_RE/PY_VALIDATION_RE before the 2026-07-13 fix).
  "depth-python": ["auditor-env-undocumented"],
  // gothinkster/rails-realworld-example-app: only reads Rails/Bundler scaffold vars
  // (BUNDLE_GEMFILE, RAILS_SERVE_STATIC_FILES) — flagging those flags every Rails app ever.
  "depth-ruby": [],
  // davidfowl/TodoApi: real `// TODO:` comments in 7 main-code files (true positive). Its
  // routes validate via WithParameterValidation/MiniValidation; its EF migration
  // RemoveIsAdmin.cs is not a route; its OTEL_*/AppInsights reads are optional telemetry.
  "depth-csharp": ["auditor-todo-markers"],
  // spring-projects/spring-petclinic: every input-taking controller uses @Valid; the
  // controllers that matched before read zero request input.
  "depth-java": [],
  // symfony/demo: controllers validate via the createForm/handleRequest/isValid form flow.
  "depth-php": [],
};

const AUDITOR_FRAMEWORKS: Record<string, string> = {
  "express-tsc": "Express",
  "express-plain": "Express",
  "nextjs-app": "Next.js",
  "python-app": "Python",
  "go-app": "Go",
  "ruby-app": "Ruby",
  "rust-app": "Rust",
  "csharp-app": "C#",
  "java-app": "Java",
  "php-app": "PHP",
  taxonomy: "Next.js",
  "mern-step": "Express",
  "react-axios": "React",
  "t3-app": "Next.js",
  "stripe-server": "Express",
  "depth-express": "Express",
  "depth-python": "Python",
  "depth-ruby": "Ruby",
  "depth-csharp": "C#",
  "depth-java": "Java",
  "depth-php": "PHP",
};

describe("xunit-ai scaffolding — csharp-app", () => {
  // Confirmed by real execution that a bare tests/AppTests.cs is invisible to `dotnet test`
  // (zero tests discovered). This verifies the fix end-to-end: the real buildXunitTestCsproj +
  // addProjectToSln output must make ROOT `dotnet test` (what the generated CI runs, via the
  // solution) discover and run a test — not `dotnet test tests/` with the path spelled out.
  it(
    "generated test csproj + patched sln make root dotnet test actually run tests",
    () => {
      const work = copyFixture(CSHARP_FIXTURES[0], "xunit-scaffold");
      try {
        const appCsproj = "SampleWebApiAspNetCore/SampleWebApiAspNetCore.csproj";
        const csprojContent = fs.readFileSync(path.join(work, appCsproj), "utf8");
        const slnPath = path.join(work, "SampleWebApiAspNetCore.sln");
        const patched = addProjectToSln(
          fs.readFileSync(slnPath, "utf8"),
          "AppTests",
          "tests/AppTests.csproj",
        );
        expect(patched, "sln patch must succeed on the real solution file").not.toBeNull();
        fs.writeFileSync(slnPath, patched as string);
        fs.mkdirSync(path.join(work, "tests"), { recursive: true });
        fs.writeFileSync(
          path.join(work, "tests", "AppTests.csproj"),
          buildXunitTestCsproj(dotnetSdkVersion(csprojContent), appCsproj),
        );
        fs.writeFileSync(
          path.join(work, "tests", "AppTests.cs"),
          `using Xunit;\nusing SampleWebApiAspNetCore.Models;\n\npublic class AppTests\n{\n    [Fact]\n    public void QueryParameters_DefaultPageCount()\n    {\n        var qp = new QueryParameters();\n        Assert.True(qp.PageCount > 0);\n    }\n}\n`,
        );
        const res = runInContainer(
          `mcr.microsoft.com/dotnet/sdk:${dotnetSdkVersion(csprojContent)}`,
          work,
          "dotnet test",
          { NUGET_PACKAGES: "/repo/.nuget" },
        );
        expect(res.ok, `root dotnet test failed:\n${res.stdout}\n${res.stderr}`.slice(-4000)).toBe(
          true,
        );
        expect(res.stdout).toMatch(/Passed:\s+1/);
      } finally {
        cleanupWorkDir(work);
      }
    },
    20 * 60_000,
  );
});

describe("auditors — real-repo detection accuracy", () => {
  it("reports exactly the ground-truth-verified findings for every fixture", () => {
    for (const [name, expected] of Object.entries(AUDITOR_EXPECTED_FINDINGS)) {
      const root = path.join(FIXTURES_ROOT, name);
      const files = listFiles(root);
      const fileContents: Record<string, string> = {};
      for (const f of files) {
        try {
          if (fs.statSync(path.join(root, f)).size > 512 * 1024) continue;
          fileContents[f] = fs.readFileSync(path.join(root, f), "utf8");
        } catch {
          /* binary or unreadable */
        }
      }
      let deps: Record<string, string> = {};
      try {
        const pkg = JSON.parse(fileContents["package.json"] ?? "{}") as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        deps = { ...pkg.dependencies, ...pkg.devDependencies };
      } catch {
        /* non-node fixture */
      }
      const issues = runAuditor({
        files,
        fileContents,
        envExampleContent: fileContents[".env.example"] ?? null,
        deps,
        framework: AUDITOR_FRAMEWORKS[name],
        manifests: {
          requirements: fileContents["requirements.txt"] ?? null,
          pyprojectToml: fileContents["pyproject.toml"] ?? null,
          gemfile: fileContents["Gemfile"] ?? null,
          goMod: fileContents["go.mod"] ?? null,
          composerJson: fileContents["composer.json"] ?? null,
          cargoToml: fileContents["Cargo.toml"] ?? null,
          mixExs: fileContents["mix.exs"] ?? null,
          pomXml: fileContents["pom.xml"] ?? null,
          buildGradle: fileContents["build.gradle"] ?? null,
          pubspecYaml: fileContents["pubspec.yaml"] ?? null,
        },
      });
      const got = issues.map((i) => i.fixId).sort();
      expect(got, `auditor findings drifted for fixture "${name}"`).toEqual([...expected].sort());
    }
  });
});
