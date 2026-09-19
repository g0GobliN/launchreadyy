import type { SandboxCommand } from "../adapters/sandbox";

export type PackageManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "pip"
  | "poetry"
  | "go"
  | "bundler"
  | "composer"
  | "cargo"
  | "maven"
  | "gradle"
  | "dotnet"
  | "mix"
  | "none";

export type SandboxEcosystem =
  | "node"
  | "python"
  | "go"
  | "ruby"
  | "php"
  | "rust"
  | "java"
  | "dotnet"
  | "elixir";

export type DetectedCommandSet = {
  packageManager: PackageManager;
  ecosystem: SandboxEcosystem;
  commands: SandboxCommand[];
  /** True when commands came from package.json scripts rather than CI parity. */
  source: "package-scripts" | "framework-default" | "ecosystem-default";
};

const LOCKFILES: Record<"npm" | "pnpm" | "yarn" | "bun", string[]> = {
  pnpm: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
  bun: ["bun.lockb", "bun.lock"],
  yarn: ["yarn.lock"],
  npm: ["package-lock.json"],
};

function hasPath(filePaths: string[], rootDir: string | null, name: string): boolean {
  return (rootDir ? filePaths.includes(`${rootDir}/${name}`) : false) || filePaths.includes(name);
}

function hasPathMatch(filePaths: string[], rootDir: string | null, re: RegExp): boolean {
  return filePaths.some((p) => {
    if (rootDir && !p.startsWith(`${rootDir}/`) && p !== rootDir) return false;
    const base = rootDir && p.startsWith(`${rootDir}/`) ? p.slice(rootDir.length + 1) : p;
    return re.test(base) || re.test(p);
  });
}

/** A nested app may pin its own package manager; otherwise the repo root decides. */
function detectPackageManager(filePaths: string[], rootDir: string | null): PackageManager {
  const has = (name: string) => hasPath(filePaths, rootDir, name);
  if (LOCKFILES.pnpm.some(has)) return "pnpm";
  if (LOCKFILES.bun.some(has)) return "bun";
  if (LOCKFILES.yarn.some(has)) return "yarn";
  return "npm";
}

/**
 * Where install has to run. A monorepo normally keeps one lockfile at the repo root
 * while the app itself lives in a subdirectory — running `npm ci` in the subdirectory
 * would fail on a missing lockfile, so install follows the lockfile, not the app.
 */
function installDir(
  filePaths: string[],
  rootDir: string | null,
  pm: PackageManager,
): string | undefined {
  if (!rootDir) return undefined;
  if (pm === "npm" || pm === "pnpm" || pm === "yarn" || pm === "bun") {
    const names = LOCKFILES[pm];
    if (names.some((n) => filePaths.includes(`${rootDir}/${n}`))) return rootDir;
    if (names.some((n) => filePaths.includes(n))) return undefined;
    return rootDir;
  }
  return rootDir;
}

function installCommand(
  pm: PackageManager,
  opts: { filePaths: string[]; rootDir: string | null },
): string {
  const berry =
    hasPath(opts.filePaths, opts.rootDir, ".yarnrc.yml") ||
    hasPathMatch(opts.filePaths, opts.rootDir, /(^|\/)\.yarn\//);
  switch (pm) {
    case "pnpm":
      // --network-concurrency caps parallel downloads — lower peak memory on
      // large dependency trees inside a resource-limited sandbox.
      return "pnpm install --frozen-lockfile --network-concurrency=4";
    case "yarn":
      // Berry rejects classic --frozen-lockfile; Yarn 1 rejects --immutable.
      return berry
        ? "yarn install --immutable"
        : "yarn install --frozen-lockfile --network-concurrency=4";
    case "bun":
      return "bun install --frozen-lockfile";
    default: {
      // `npm ci` requires package-lock.json — without it the step always fails and
      // hard-gates the score UI for perfectly fine repos that never committed a lockfile.
      const hasLock = hasPath(opts.filePaths, opts.rootDir, "package-lock.json");
      return hasLock
        ? "npm ci --no-audit --no-fund --maxsockets=4"
        : "npm install --no-audit --no-fund --maxsockets=4";
    }
  }
}

function runScript(pm: PackageManager, script: string): string {
  switch (pm) {
    case "pnpm":
      return `pnpm run ${script}`;
    case "yarn":
      return `yarn ${script}`;
    case "bun":
      return `bun run ${script}`;
    default:
      return `npm run ${script}`;
  }
}

/**
 * Ecosystems whose toolchains are baked into `launchreadyy/template.ts`.
 * Rebuild the E2B template after changing this set (`npm run e2b:build:prod`).
 * Without `E2B_TEMPLATE_ID`, only Node/Python (base image) are claimed — otherwise
 * we'd plan `bundle`/`mvn`/… against a bare image and hard-fail the run.
 */
export const SANDBOX_IMAGE_ECOSYSTEMS: ReadonlySet<SandboxEcosystem> = new Set([
  "node",
  "python",
  "go",
  "rust",
  "ruby",
  "php",
  "java",
  "dotnet",
  "elixir",
]);

const BASE_IMAGE_ECOSYSTEMS: ReadonlySet<SandboxEcosystem> = new Set(["node", "python"]);

/** True when the current E2B template is expected to have this ecosystem's CLI. */
export function sandboxImageSupports(ecosystem: SandboxEcosystem): boolean {
  if (!SANDBOX_IMAGE_ECOSYSTEMS.has(ecosystem)) return false;
  if (BASE_IMAGE_ECOSYSTEMS.has(ecosystem)) return true;
  const templateId =
    typeof process !== "undefined" ? process.env.E2B_TEMPLATE_ID?.trim() : undefined;
  return Boolean(templateId);
}

/**
 * Pick the primary ecosystem for sandbox install/build/lint.
 * Node normally wins when package.json exists (JS monorepos often also have Go modules), but
 * PHP frameworks commonly commit package.json only for Vite/Webpack assets. Their application
 * dependencies and executable backend live in Composer, so framework markers must win.
 */
export function detectSandboxEcosystem(
  filePaths: string[],
  rootDir: string | null = null,
): SandboxEcosystem | null {
  const isPhpFramework =
    hasPath(filePaths, rootDir, "composer.json") &&
    (hasPath(filePaths, rootDir, "artisan") ||
      hasPath(filePaths, rootDir, "bin/console") ||
      hasPath(filePaths, rootDir, "public/index.php"));
  if (isPhpFramework) return "php";
  if (hasPath(filePaths, rootDir, "package.json")) return "node";
  if (hasPath(filePaths, rootDir, "go.mod")) return "go";
  if (
    hasPath(filePaths, rootDir, "pyproject.toml") ||
    hasPath(filePaths, rootDir, "requirements.txt") ||
    hasPath(filePaths, rootDir, "Pipfile")
  ) {
    return "python";
  }
  if (hasPath(filePaths, rootDir, "Gemfile")) return "ruby";
  if (hasPath(filePaths, rootDir, "composer.json")) return "php";
  if (hasPath(filePaths, rootDir, "Cargo.toml")) return "rust";
  if (
    hasPath(filePaths, rootDir, "pom.xml") ||
    hasPath(filePaths, rootDir, "build.gradle") ||
    hasPath(filePaths, rootDir, "build.gradle.kts")
  ) {
    return "java";
  }
  if (hasPathMatch(filePaths, rootDir, /\.csproj$/i)) return "dotnet";
  if (hasPath(filePaths, rootDir, "mix.exs")) return "elixir";
  return null;
}

function nodeCommands(opts: {
  filePaths: string[];
  scripts: Record<string, string>;
  includeTest?: boolean;
  rootDir: string | null;
  buildCommand?: string | null;
}): DetectedCommandSet {
  const rootDir = opts.rootDir;
  const pm = detectPackageManager(opts.filePaths, rootDir) as "npm" | "pnpm" | "yarn" | "bun";
  const scripts = opts.scripts;
  const appDir = rootDir ?? undefined;
  const commands: SandboxCommand[] = [
    {
      step: "install",
      command: installCommand(pm, { filePaths: opts.filePaths, rootDir }),
      cwd: installDir(opts.filePaths, rootDir, pm),
    },
  ];

  // Only build when the repo actually declares one (or the user set an explicit command).
  // This used to always append `npm run build` so that "a missing script surfaces as a real
  // failure rather than a silent skip" — but plenty of deployable Node apps legitimately have
  // no build step (a plain Express API, a CLI). For those, `npm run build` exits with
  // "Missing script: build", the run is marked *failed*, and a failed run hard-gates the score
  // UI — so a working repo was told it was broken and never shown its readiness score.
  // An absent build script is a fact about the project, not a defect in it.
  if (opts.buildCommand || scripts.build) {
    commands.push({
      step: "build",
      command: opts.buildCommand || runScript(pm, "build"),
      cwd: appDir,
    });
  }

  if (scripts.lint) {
    commands.push({ step: "lint", command: runScript(pm, "lint"), cwd: appDir });
  }

  if (opts.includeTest && (scripts.test || scripts["test:ci"])) {
    const name = scripts["test:ci"] ? "test:ci" : "test";
    commands.push({ step: "test", command: runScript(pm, name), cwd: appDir });
  }

  return {
    packageManager: pm,
    ecosystem: "node",
    commands,
    source: Object.keys(scripts).length > 0 ? "package-scripts" : "framework-default",
  };
}

function pythonCommands(opts: {
  filePaths: string[];
  includeTest?: boolean;
  rootDir: string | null;
  buildCommand?: string | null;
}): DetectedCommandSet {
  const cwd = opts.rootDir ?? undefined;
  const poetry = hasPath(opts.filePaths, opts.rootDir, "poetry.lock");
  const pm: PackageManager = poetry ? "poetry" : "pip";
  const commands: SandboxCommand[] = [];

  if (poetry) {
    // Old locks pin packages that fail to build on modern CPython (pyyaml 6.0, greenlet 1.1.x).
    // Prefer export→rewrite→pip so we don't fight poetry.lock hashes. Poetry 2 needs the export plugin.
    const rewriteReq =
      "python3 -c \"import pathlib,re; p=pathlib.Path('/tmp/lr-req.txt'); t=p.read_text();" +
      " t=re.sub(r'(?i)pyyaml==6\\\\.0(\\\\.0)?', 'PyYAML>=6.0.1', t);" +
      " t=re.sub(r'(?i)greenlet==1\\\\.1\\\\.\\\\d+', 'greenlet>=3.0.0', t);" +
      ' p.write_text(t)"';
    commands.push({
      step: "install",
      command: [
        `(pip install -q poetry-plugin-export && poetry export -f requirements.txt --without-hashes --only main -o /tmp/lr-req.txt && ${rewriteReq} && pip install -r /tmp/lr-req.txt)`,
        "(poetry install --no-interaction --no-ansi --only main --no-root)",
        "(pip install 'pyyaml>=6.0.1' 'greenlet>=3.0.0' && poetry install --no-interaction --no-ansi --only main --no-root)",
      ].join(" || "),
      cwd,
    });
  } else if (hasPath(opts.filePaths, opts.rootDir, "requirements.txt")) {
    commands.push({
      step: "install",
      command: "pip install -r requirements.txt",
      cwd,
    });
  } else if (hasPath(opts.filePaths, opts.rootDir, "pyproject.toml")) {
    commands.push({
      step: "install",
      command: "pip install -e .",
      cwd,
    });
  } else {
    commands.push({ step: "install", command: "pip install -e . || true", cwd });
  }

  if (opts.buildCommand) {
    commands.push({ step: "build", command: opts.buildCommand, cwd });
  }

  // Prefer project-declared lint via ruff when a config exists — never force ruff on
  // every poetry project (most don't have it → lint step fails the whole verify run).
  const hasRuffConfig =
    hasPathMatch(opts.filePaths, opts.rootDir, /(^|\/)ruff\.toml$/i) ||
    hasPathMatch(opts.filePaths, opts.rootDir, /(^|\/)\.ruff\.toml$/i);
  if (hasRuffConfig) {
    commands.push({
      step: "lint",
      command: poetry
        ? "poetry run ruff check . || ruff check ."
        : "ruff check . || python -m ruff check .",
      cwd,
    });
  }

  if (opts.includeTest) {
    commands.push({
      step: "test",
      command: poetry ? "poetry run pytest -q" : "pytest -q",
      cwd,
    });
  }

  return { packageManager: pm, ecosystem: "python", commands, source: "ecosystem-default" };
}

function goCommands(opts: {
  includeTest?: boolean;
  rootDir: string | null;
  buildCommand?: string | null;
}): DetectedCommandSet {
  const cwd = opts.rootDir ?? undefined;
  const commands: SandboxCommand[] = [
    { step: "install", command: "go mod download", cwd },
    { step: "build", command: opts.buildCommand || "go build ./...", cwd },
  ];
  if (opts.includeTest) {
    commands.push({ step: "test", command: "go test ./...", cwd });
  }
  return { packageManager: "go", ecosystem: "go", commands, source: "ecosystem-default" };
}

function rubyCommands(opts: {
  includeTest?: boolean;
  rootDir: string | null;
  buildCommand?: string | null;
}): DetectedCommandSet {
  const cwd = opts.rootDir ?? undefined;
  const commands: SandboxCommand[] = [
    {
      step: "install",
      // RubyGems removed Gem.inflate — pin Bundler 2.5.x. Rails 4.x needs Ruby ≤2.7.
      command:
        'if grep -qE "rails.{0,40}4\\." Gemfile Gemfile.lock 2>/dev/null; then ' +
        "mise install ruby@2.7.8 && " +
        "mise exec ruby@2.7.8 -- gem install bundler:1.17.3 --no-document && " +
        'OPENSSL_DIR="$HOME/.local/share/mise/installs/ruby/2.7.8/openssl"; ' +
        'export PKG_CONFIG_PATH="$OPENSSL_DIR/lib/pkgconfig:${PKG_CONFIG_PATH:-}"; ' +
        'mise exec ruby@2.7.8 -- bundle config set --local build.puma --with-opt-dir="$OPENSSL_DIR"; ' +
        "sed -i -e \"s/^gem 'puma'.*/gem 'puma', '~> 4.3.12'/\" Gemfile; " +
        "grep -q \"gem 'json'\" Gemfile || echo \"gem 'json', '1.8.6'\" >> Gemfile; " +
        // 1.0.7 pins nokogiri ~> 1.6.0; 1.0.9 uses ~> 1.6 so 1.12.x is allowed.
        "grep -q \"gem 'nokogiri'\" Gemfile || echo \"gem 'nokogiri', '1.12.5'\" >> Gemfile; " +
        "mise exec ruby@2.7.8 -- bundle _1.17.3_ update json puma nokogiri rails-dom-testing; " +
        "else " +
        "gem install bundler:2.5.23 --no-document && " +
        "bundle _2.5.23_ install --jobs=4 --retry=3; " +
        "fi",
      cwd,
    },
  ];
  if (opts.buildCommand) {
    commands.push({ step: "build", command: opts.buildCommand, cwd });
  }
  if (opts.includeTest) {
    commands.push({ step: "test", command: "bundle exec rspec || bundle exec rake test", cwd });
  }
  return { packageManager: "bundler", ecosystem: "ruby", commands, source: "ecosystem-default" };
}

function phpCommands(opts: {
  includeTest?: boolean;
  rootDir: string | null;
  buildCommand?: string | null;
}): DetectedCommandSet {
  const cwd = opts.rootDir ?? undefined;
  const commands: SandboxCommand[] = [
    // Advisories + PHP version skew vs sandbox image: still fetch deps so verify isn't blocked.
    {
      step: "install",
      command:
        "composer config audit.block-insecure false >/dev/null 2>&1; composer install --no-interaction --prefer-dist --no-security-blocking --ignore-platform-req=php --no-scripts",
      cwd,
    },
  ];
  if (opts.buildCommand) {
    commands.push({ step: "build", command: opts.buildCommand, cwd });
  }
  if (opts.includeTest) {
    commands.push({ step: "test", command: "vendor/bin/phpunit || ./vendor/bin/phpunit", cwd });
  }
  return { packageManager: "composer", ecosystem: "php", commands, source: "ecosystem-default" };
}

function rustCommands(opts: {
  includeTest?: boolean;
  rootDir: string | null;
  buildCommand?: string | null;
}): DetectedCommandSet {
  const cwd = opts.rootDir ?? undefined;
  const commands: SandboxCommand[] = [
    { step: "install", command: "cargo fetch", cwd },
    { step: "build", command: opts.buildCommand || "cargo build --locked", cwd },
  ];
  if (opts.includeTest) {
    commands.push({ step: "test", command: "cargo test --locked", cwd });
  }
  return { packageManager: "cargo", ecosystem: "rust", commands, source: "ecosystem-default" };
}

function javaCommands(opts: {
  filePaths: string[];
  includeTest?: boolean;
  rootDir: string | null;
  buildCommand?: string | null;
}): DetectedCommandSet {
  const cwd = opts.rootDir ?? undefined;
  const gradle =
    hasPath(opts.filePaths, opts.rootDir, "build.gradle") ||
    hasPath(opts.filePaths, opts.rootDir, "build.gradle.kts") ||
    hasPath(opts.filePaths, opts.rootDir, "gradlew");
  const pm: PackageManager = gradle ? "gradle" : "maven";
  // files-source uploads drop +x on gradlew; toolchains need foojay to auto-download JDKs.
  // Append after pluginManagement (never prepend) — Gradle forbids plugins before it.
  const gradleFlags =
    "--no-daemon -Dorg.gradle.java.installations.auto-download=true -Dorg.gradle.java.installations.auto-detect=true";
  const gradlePrep = [
    "chmod +x ./gradlew 2>/dev/null || true",
    // shell function: append foojay when pluginManagement exists, else prepend
    'inject_foojay() { f="$1"; kts="$2"; [ -f "$f" ] || return 0; ' +
      'grep -q foojay-resolver "$f" && return 0; ' +
      'if [ "$kts" = 1 ]; then b=$(printf "%s\\n" "plugins {" "  id(\\"org.gradle.toolchains.foojay-resolver-convention\\") version \\"0.9.0\\"" "}"); ' +
      'else b=$(printf "%s\\n" "plugins {" "  id \\"org.gradle.toolchains.foojay-resolver-convention\\" version \\"0.9.0\\"" "}"); fi; ' +
      'if grep -q pluginManagement "$f"; then printf "\\n%s\\n" "$b" >> "$f"; ' +
      'else tmp=/tmp/lr-settings.$$; printf "%s\\n\\n" "$b" > "$tmp"; cat "$f" >> "$tmp"; mv "$tmp" "$f"; fi; }; ' +
      "inject_foojay settings.gradle.kts 1; inject_foojay settings.gradle 0",
  ].join("; ");
  const commands: SandboxCommand[] = gradle
    ? [
        {
          step: "install",
          command: `${gradlePrep}; ./gradlew dependencies ${gradleFlags} || gradle dependencies ${gradleFlags}`,
          cwd,
        },
        {
          step: "build",
          command:
            opts.buildCommand ||
            `chmod +x ./gradlew 2>/dev/null || true; ./gradlew assemble ${gradleFlags} || gradle assemble ${gradleFlags}`,
          cwd,
        },
      ]
    : [
        { step: "install", command: "mvn -B -q dependency:resolve", cwd },
        { step: "build", command: opts.buildCommand || "mvn -B -q -DskipTests package", cwd },
      ];
  if (opts.includeTest) {
    commands.push({
      step: "test",
      command: gradle
        ? `chmod +x ./gradlew 2>/dev/null || true; ./gradlew test ${gradleFlags} || gradle test ${gradleFlags}`
        : "mvn -B -q test",
      cwd,
    });
  }
  return { packageManager: pm, ecosystem: "java", commands, source: "ecosystem-default" };
}

function dotnetCommands(opts: {
  includeTest?: boolean;
  rootDir: string | null;
  buildCommand?: string | null;
}): DetectedCommandSet {
  const cwd = opts.rootDir ?? undefined;
  // global.json / net9 need SDK 9; image often has only 8. Do NOT use `exit` inside `||`
  // groups — that kills the shell before later fallbacks run.
  const restore =
    'export DOTNET_ROOT="${DOTNET_ROOT:-$HOME/.dotnet}"; export PATH="$DOTNET_ROOT:$PATH"; ' +
    "dotnet restore || " +
    "{ curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/lr-dotnet-install.sh && " +
    'bash /tmp/lr-dotnet-install.sh --channel 9.0 --install-dir "$DOTNET_ROOT" && ' +
    'export PATH="$DOTNET_ROOT:$PATH" && dotnet restore; } || ' +
    "{ [ -f global.json ] && mv global.json /tmp/lr-global.json; " +
    'bash /tmp/lr-dotnet-install.sh --channel 8.0 --install-dir "$DOTNET_ROOT" 2>/dev/null; ' +
    'export PATH="$DOTNET_ROOT:$PATH"; dotnet restore; EC=$?; ' +
    "[ -f /tmp/lr-global.json ] && mv /tmp/lr-global.json global.json; " +
    "[ $EC -eq 0 ]; }";
  const commands: SandboxCommand[] = [
    { step: "install", command: restore, cwd },
    { step: "build", command: opts.buildCommand || "dotnet build --no-restore", cwd },
  ];
  if (opts.includeTest) {
    commands.push({ step: "test", command: "dotnet test --no-build", cwd });
  }
  return { packageManager: "dotnet", ecosystem: "dotnet", commands, source: "ecosystem-default" };
}

function elixirCommands(opts: {
  includeTest?: boolean;
  rootDir: string | null;
  buildCommand?: string | null;
}): DetectedCommandSet {
  const cwd = opts.rootDir ?? undefined;
  const commands: SandboxCommand[] = [
    { step: "install", command: "mix deps.get", cwd },
    { step: "build", command: opts.buildCommand || "mix compile", cwd },
  ];
  if (opts.includeTest) {
    commands.push({ step: "test", command: "mix test", cwd });
  }
  return { packageManager: "mix", ecosystem: "elixir", commands, source: "ecosystem-default" };
}

/**
 * Build the install/build/lint/test command set for a sandbox run across supported ecosystems.
 * Prefers package.json when present; otherwise detects Go/Python/Ruby/PHP/Rust/Java/C#/Elixir.
 * Returns null when no supported manifest is found (caller should skip, not fail).
 *
 * `rootDir` and `buildCommand` come from the repo's saved build settings and only
 * ever override detection — with both unset this behaves exactly as before for Node.
 */
export function detectSandboxCommands(opts: {
  filePaths: string[];
  scripts?: Record<string, string>;
  includeTest?: boolean;
  rootDir?: string | null;
  buildCommand?: string | null;
}): DetectedCommandSet {
  const rootDir = opts.rootDir || null;
  const ecosystem = detectSandboxEcosystem(opts.filePaths, rootDir);

  if (
    ecosystem === "node" ||
    (!ecosystem && opts.scripts && Object.keys(opts.scripts).length > 0)
  ) {
    // Legacy callers that only pass scripts still get Node commands (tests / older paths).
    return nodeCommands({
      filePaths: opts.filePaths,
      scripts: opts.scripts ?? {},
      includeTest: opts.includeTest,
      rootDir,
      buildCommand: opts.buildCommand,
    });
  }

  if (!ecosystem) {
    // No manifest — return empty Node-shaped set so existing callers don't crash.
    // processSandboxVerifyJob / verify-before-pr check ecosystem via detectSandboxEcosystem.
    return {
      packageManager: "none",
      ecosystem: "node",
      commands: [],
      source: "framework-default",
    };
  }

  switch (ecosystem) {
    case "python":
      return pythonCommands({ ...opts, rootDir });
    case "go":
      return goCommands({ ...opts, rootDir });
    case "ruby":
      return rubyCommands({ ...opts, rootDir });
    case "php":
      return phpCommands({ ...opts, rootDir });
    case "rust":
      return rustCommands({ ...opts, rootDir });
    case "java":
      return javaCommands({ ...opts, rootDir });
    case "dotnet":
      return dotnetCommands({ ...opts, rootDir });
    case "elixir":
      return elixirCommands({ ...opts, rootDir });
    default:
      return nodeCommands({
        filePaths: opts.filePaths,
        scripts: opts.scripts ?? {},
        includeTest: opts.includeTest,
        rootDir,
        buildCommand: opts.buildCommand,
      });
  }
}
