import type { ProjectContext, ProjectLanguage } from "./project-context.server";
import { dotnetSdkVersion, javaVersionFromBuildFiles } from "./project-context.server";
import { detectPhpFramework } from "./backend-patch.server";

const CI_HEADER = `name: CI

on:
  push:
    branches: [main, master, develop]
  pull_request:

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
`;

function hasPath(ctx: ProjectContext, pattern: RegExp): boolean {
  return ctx.filePaths.some((p) => pattern.test(p));
}

function manifest(
  ctx: ProjectContext,
  key: keyof NonNullable<ProjectContext["manifests"]>,
): string {
  return ctx.manifests?.[key] ?? "";
}

export function buildLanguageCiWorkflow(ctx: ProjectContext, csprojContent = ""): string | null {
  let wf: string | null = null;
  switch (ctx.language) {
    case "go":
      wf = buildGoCi(ctx);
      break;
    case "python":
      wf = buildPythonCi(ctx);
      break;
    case "ruby":
      wf = buildRubyCi(ctx);
      break;
    case "rust":
      wf = buildRustCi(ctx);
      break;
    case "php":
      wf = buildPhpCi(ctx);
      break;
    case "java":
      wf = buildJavaCi(ctx);
      break;
    case "csharp":
      wf = buildCsharpCi(ctx, csprojContent);
      break;
    case "elixir":
      wf = buildElixirCi(ctx);
      break;
    case "dart":
      wf = buildDartCi(ctx);
      break;
    case "swift":
      wf = buildSwiftCi(ctx);
      break;
    case "kotlin":
      wf = buildKotlinCi(ctx);
      break;
    default:
      return null;
  }
  return wf ? withSecretScanJob(wf) : null;
}

const SECRET_SCAN_JOB = `  secret-scan:
    name: Security (secret scan)
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - name: Scan for committed secrets
        run: |
          FAIL=0
          if find . -name ".env" -not -name ".env.example" -not -path "*/node_modules/*" | grep -q .; then
            echo "WARNING: .env file in repo"
          fi
          if grep -rE "sk_live_" --include="*.go" --include="*.py" --include="*.rb" --exclude-dir=vendor . 2>/dev/null | grep -q .; then
            echo "FOUND: live API key in source"; FAIL=1
          fi
          [ $FAIL -eq 0 ] || exit 1
          echo "Secret scan passed."
`;

function withSecretScanJob(yaml: string): string {
  if (yaml.includes("secret-scan:")) return yaml;
  return `${yaml.trimEnd()}\n${SECRET_SCAN_JOB}`;
}

function buildGoCi(ctx: ProjectContext): string {
  const steps = [
    "      - uses: actions/checkout@v4",
    `      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
          cache: true`,
    "      - name: Sync modules\n        run: go mod tidy",
    "      - name: Vet\n        run: go vet ./...",
  ];
  if (hasPath(ctx, /_test\.go$/)) {
    steps.push("      - name: Test\n        run: go test ./...");
  }
  return `${CI_HEADER}
jobs:
  ci:
    name: CI (go vet · test)
    runs-on: ubuntu-latest
    steps:
${steps.join("\n")}
`;
}

function buildPythonCi(ctx: ProjectContext): string {
  const pyproject = manifest(ctx, "pyprojectToml");
  const requirements = manifest(ctx, "requirements");
  const usesPytest =
    hasPath(ctx, /(^|\/)tests?\//) || /pytest/i.test(pyproject) || /pytest/i.test(requirements);
  const usesRuff = hasPath(ctx, /^ruff\.toml$/) || /\[tool\.ruff/i.test(pyproject);
  const isDjango = hasPath(ctx, /^manage\.py$/);

  const steps = [
    "      - uses: actions/checkout@v4",
    hasPath(ctx, /^\.python-version$/)
      ? `      - uses: actions/setup-python@v5
        with:
          python-version-file: '.python-version'
          cache: 'pip'`
      : `      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'`,
  ];

  if (manifest(ctx, "pyprojectToml")) {
    steps.push("      - name: Install\n        run: pip install -e '.[dev]' || pip install -e .");
  } else if (manifest(ctx, "requirements")) {
    steps.push("      - name: Install\n        run: pip install -r requirements.txt");
  } else if (manifest(ctx, "pipfile")) {
    steps.push(
      "      - name: Install\n        run: pip install pipenv && pipenv install --dev --skip-lock",
    );
  } else {
    steps.push("      - name: Install\n        run: pip install pytest ruff");
  }

  if (usesRuff) {
    steps.push("      - name: Lint\n        run: ruff check .");
  }
  if (isDjango) {
    steps.push("      - name: Test\n        run: python manage.py test");
  } else if (usesPytest) {
    steps.push("      - name: Test\n        run: pytest");
  } else if (hasPath(ctx, /(^|\/)test_.*\.py$/)) {
    steps.push("      - name: Test\n        run: python -m pytest");
  }

  if (steps.length <= 3) {
    steps.push("      - name: Compile check\n        run: python -m compileall -q .");
  }

  return `${CI_HEADER}
jobs:
  ci:
    name: CI (python)
    runs-on: ubuntu-latest
    steps:
${steps.join("\n")}
`;
}

function buildRubyCi(ctx: ProjectContext): string {
  const gemfile = manifest(ctx, "gemfile");
  const usesRspec = /rspec/i.test(gemfile) || hasPath(ctx, /spec\//);
  const steps = [
    "      - uses: actions/checkout@v4",
    `      - uses: ruby/setup-ruby@v1
        with:
          bundler-cache: false`,
    "      - name: Install gems\n        run: bundle install",
  ];
  if (usesRspec) {
    steps.push("      - name: Test\n        run: bundle exec rspec");
  } else if (/minitest/i.test(gemfile)) {
    steps.push("      - name: Test\n        run: bundle exec rake test");
  } else {
    steps.push(
      "      - name: Test\n        run: bundle exec rake test || bundle exec ruby -Itest test/",
    );
  }
  return `${CI_HEADER}
jobs:
  ci:
    name: CI (ruby)
    runs-on: ubuntu-latest
    steps:
${steps.join("\n")}
`;
}

function buildRustCi(ctx: ProjectContext): string {
  const steps = [
    "      - uses: actions/checkout@v4",
    `      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy`,
    // No `-D warnings`: escalating a repo's own pre-existing lints to hard errors makes the
    // generated CI red on day one for most real codebases — same class as the Elixir
    // --warnings-as-errors bug (both confirmed against real repos this audit). Clippy still
    // reports everything in the log; failing is reserved for actual compile errors.
    "      - name: Clippy\n        run: cargo clippy --all-targets",
    "      - name: Test\n        run: cargo test",
  ];
  return `${CI_HEADER}
jobs:
  ci:
    name: CI (cargo clippy · test)
    runs-on: ubuntu-latest
    steps:
${steps.join("\n")}
`;
}

function buildPhpCi(ctx: ProjectContext): string {
  const composer = manifest(ctx, "composerJson");
  const phpFw = detectPhpFramework(ctx.filePaths, composer);
  let testCmd =
    phpFw === "laravel" && hasPath(ctx, /(^|\/)artisan$/)
      ? "php artisan test"
      : "vendor/bin/phpunit";
  try {
    const obj = JSON.parse(composer || "{}") as { scripts?: Record<string, string> };
    if (obj.scripts?.test) testCmd = "composer test";
  } catch {
    /* default */
  }
  const steps = [
    "      - uses: actions/checkout@v4",
    `      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          coverage: none`,
    "      - name: Install\n        run: composer update --no-interaction --prefer-dist",
  ];
  if (hasPath(ctx, /phpunit\.xml|tests?\//)) {
    steps.push(`      - name: Test\n        run: ${testCmd}`);
  }
  return `${CI_HEADER}
jobs:
  ci:
    name: CI (php)
    runs-on: ubuntu-latest
    steps:
${steps.join("\n")}
`;
}

function buildJavaCi(ctx: ProjectContext): string {
  const usesGradle =
    hasPath(ctx, /^build\.gradle(\.kts)?$/) || Boolean(manifest(ctx, "buildGradle"));
  // Real declared toolchain, not a hardcoded 21 — see javaVersionFromBuildFiles for the
  // real-repo failure this fixes (spring-petclinic's strict Java 17 Gradle toolchain).
  const javaVersion = javaVersionFromBuildFiles(
    manifest(ctx, "pomXml"),
    manifest(ctx, "buildGradle"),
  );
  const steps = ["      - uses: actions/checkout@v4"];
  if (usesGradle) {
    steps.push(
      `      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '${javaVersion}'
          cache: gradle`,
      "      - name: Test\n        run: ./gradlew test",
    );
  } else {
    steps.push(
      `      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '${javaVersion}'
          cache: maven`,
      "      - name: Test\n        run: mvn -B test",
    );
  }
  return `${CI_HEADER}
jobs:
  ci:
    name: CI (java)
    runs-on: ubuntu-latest
    steps:
${steps.join("\n")}
`;
}

function buildCsharpCi(ctx: ProjectContext, csprojContent = ""): string {
  const sdk = dotnetSdkVersion(csprojContent);
  const steps = [
    "      - uses: actions/checkout@v4",
    `      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '${sdk}.x'`,
    "      - name: Restore\n        run: dotnet restore",
    "      - name: Build\n        run: dotnet build --no-restore -c Release",
    "      - name: Test\n        run: dotnet test --no-build -c Release --verbosity normal",
  ];
  if (hasPath(ctx, /Dockerfile$/)) {
    steps.push("      - name: Docker build\n        run: docker build -t app:ci .");
  }
  return `${CI_HEADER}
jobs:
  ci:
    name: CI (csharp)
    runs-on: ubuntu-latest
    steps:
${steps.join("\n")}
`;
}

function buildElixirCi(ctx: ProjectContext): string {
  const mixExs = manifest(ctx, "mixExs");
  const usesExUnit = /ex_unit/i.test(mixExs) || hasPath(ctx, /^test\//);
  // Confirmed against the real dwyl/phoenix-chat-example: `mix test` on a Phoenix+Ecto app
  // starts by creating the test database ("The database for Chat.Repo couldn't be created")
  // — without a postgres service the generated CI fails on a real runner too. The standard
  // Phoenix scaffold's config/test.exs expects postgres/postgres on localhost:5432, which is
  // exactly what this service block provides. (The Node CI path already detects service deps
  // the same way — this branch never did.)
  const needsPostgres = usesExUnit && /postgrex|ecto_sql/i.test(mixExs);
  const steps = [
    "      - uses: actions/checkout@v4",
    `      - uses: erlef/setup-beam@v1
        with:
          otp-version: '26'
          elixir-version: '1.16'`,
    "      - name: Install deps\n        run: mix deps.get",
    // No --warnings-as-errors: confirmed against the real dwyl/phoenix-chat-example that a
    // healthy, working Phoenix app compiles with pre-existing deprecation warnings (its own
    // phx-update="append" usage, plus warnings from its resolved deps against a newer Elixir)
    // — generated CI hard-failing a user's build on warnings they already live with is the
    // "generated fix breaks on real code" class this audit exists to catch. No other
    // language's generated CI escalates warnings to errors either.
    "      - name: Compile\n        run: mix compile",
  ];
  if (usesExUnit) {
    steps.push("      - name: Test\n        run: mix test");
  }
  const services = needsPostgres
    ? `
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5`
    : "";
  return `${CI_HEADER}
jobs:
  ci:
    name: CI (elixir)
    runs-on: ubuntu-latest${services}
    steps:
${steps.join("\n")}
`;
}

export function supportsDeterministicLanguageCi(language: ProjectLanguage): boolean {
  return [
    "go",
    "python",
    "ruby",
    "rust",
    "php",
    "java",
    "kotlin",
    "csharp",
    "elixir",
    "dart",
    "swift",
  ].includes(language);
}

function buildDartCi(ctx: ProjectContext): string {
  const steps = [
    "      - uses: actions/checkout@v4",
    `      - uses: subosito/flutter-action@v2
        with:
          channel: stable`,
    "      - name: Install\n        run: flutter pub get",
    "      - name: Analyze\n        run: flutter analyze",
  ];
  if (hasPath(ctx, /^test\/.*_test\.dart$|^integration_test\//)) {
    steps.push("      - name: Test\n        run: flutter test");
  }
  return `${CI_HEADER}
jobs:
  ci:
    name: CI (flutter)
    runs-on: ubuntu-latest
    steps:
${steps.join("\n")}
`;
}

function buildSwiftCi(ctx: ProjectContext): string {
  const steps = [
    "      - uses: actions/checkout@v4",
    "      - name: Build\n        run: swift build",
  ];
  if (hasPath(ctx, /Tests\.swift$|Tests\//)) {
    steps.push("      - name: Test\n        run: swift test");
  }
  return `${CI_HEADER}
jobs:
  ci:
    name: CI (swift)
    runs-on: macos-latest
    steps:
${steps.join("\n")}
`;
}

function buildKotlinCi(ctx: ProjectContext): string {
  const usesGradle =
    hasPath(ctx, /^build\.gradle(\.kts)?$/) || Boolean(manifest(ctx, "buildGradle"));
  // Same declared-toolchain honoring as buildJavaCi — spring-petclinic-kotlin's
  // build.gradle.kts declares the identical JavaLanguageVersion.of(17) shape.
  const javaVersion = javaVersionFromBuildFiles(
    manifest(ctx, "pomXml"),
    manifest(ctx, "buildGradle"),
  );
  const steps = ["      - uses: actions/checkout@v4"];
  if (usesGradle) {
    steps.push(
      `      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '${javaVersion}'
          cache: gradle`,
      "      - name: Test\n        run: ./gradlew test",
    );
  } else {
    steps.push(
      `      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '${javaVersion}'
          cache: maven`,
      "      - name: Test\n        run: mvn -B test",
    );
  }
  return `${CI_HEADER}
jobs:
  ci:
    name: CI (android/kotlin)
    runs-on: ubuntu-latest
    steps:
${steps.join("\n")}
`;
}
