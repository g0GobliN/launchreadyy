export interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

/**
 * How sure the scanner is about a finding. Platform-wide — every category carries it.
 * high = direct positive/negative signal; medium = heuristic that custom code may satisfy;
 * low = pattern-only inference. Low-confidence findings sort last within their severity band.
 */
export type Confidence = "high" | "medium" | "low";

/** How the conclusion was reached — a finding can combine several methods. */
export type DetectionMethod = "rule-based" | "framework-aware" | "ai-assisted" | "sandbox-verified";

export interface IssueInput {
  category: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  why: string;
  timeSaved: string;
  fixId: string;
  checkedFor?: string[];
  /** Set only when the finding fired because something bad WAS found (not because something good is missing). Overrides the "None found" evidence text. */
  foundEvidence?: string;
  confidence?: Confidence;
  /** Plain-language remediation shown on the finding card, independent of any auto-fix. */
  recommendedFix?: string;
  /** Relative AI effort for explaining or fixing this issue. */
  aiEffort?: number;
  /** How we reached this conclusion — shown next to confidence in the evidence disclosure. */
  detection?: DetectionMethod[];
  /** When a sandbox-verified finding was actually confirmed — powers "Verified X ago" copy. */
  verifiedAt?: string;
}

export const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 15,
  high: 10,
  medium: 5,
  low: 2,
};

export const README_SETUP_HEADING =
  /##?\s*(setup|install|installation|getting.started|quick.start|development|run.locally|local.development|running.locally|prerequisites|configuration|dev.setup)/i;

export const README_PATHS = ["README.md", "readme.md", "README", "README.markdown", "Readme.md"];

export function calcScore(issues: IssueInput[]): number {
  const total = issues.reduce((sum, i) => sum + (SEVERITY_WEIGHT[i.severity] ?? 0), 0);
  return Math.max(0, 100 - total);
}

export function hasReadmeSetupSection(readme: string | null): boolean {
  if (!readme) return false;
  return README_SETUP_HEADING.test(readme);
}

export function detectFramework(pkg: PackageJsonLike): string {
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  // Order matters — check more specific frameworks before generic ones
  if (all.expo || all["expo-router"]) return "Expo";
  if (all["react-native"]) return "React Native";
  if (all.electron) return "Electron";
  if (all["@tauri-apps/api"] || all["@tauri-apps/cli"]) return "Tauri";
  if (all.next) return "Next.js";
  if (all["@remix-run/react"] || all["@remix-run/node"] || all["@remix-run/server-runtime"])
    return "Remix";
  if (all["astro"]) return "Astro";
  if (all["nuxt"]) return "Nuxt";
  if (all["@sveltejs/kit"]) return "SvelteKit";
  if (all["svelte"]) return "Svelte";
  if (all["@tanstack/react-router"] || all["@tanstack/router"]) return "TanStack";
  if (all["vite"]) return "Vite";
  if (all["hono"]) return "Hono";
  if (all["fastify"]) return "Fastify";
  if (all["express"]) return "Express";
  if (all["@nestjs/core"]) return "NestJS";
  if (all["koa"]) return "Koa";
  if (all["react"]) return "React";
  if (all["vue"]) return "Vue";
  return "unknown";
}

export function isSupportedFramework(framework: string): boolean {
  return [
    "Next.js",
    "Remix",
    "Astro",
    "Nuxt",
    "SvelteKit",
    "Svelte",
    "TanStack",
    "Vite",
    "Hono",
    "Fastify",
    "Express",
    "NestJS",
    "Koa",
    "React",
    "Vue",
    "Expo",
    "React Native",
    "Electron",
    "Tauri",
    "Flutter",
    "Swift",
    "Kotlin",
  ].includes(framework);
}

export function checkCI(
  files: string[],
  issues: IssueInput[],
  fixId = "github-actions",
  opts?: { severity?: IssueInput["severity"]; skip?: boolean },
) {
  if (opts?.skip) return;

  const checkedFor = [
    ".github/workflows",
    "CircleCI",
    "GitLab CI",
    "Azure Pipelines",
    "Bitbucket Pipelines",
  ];
  const hasCI = files.some(
    (f) => f.startsWith(".github/workflows/") && (f.endsWith(".yml") || f.endsWith(".yaml")),
  );
  if (!hasCI) {
    const isAi = fixId === "ci-ai";
    issues.push({
      category: "CI/CD",
      title: isAi ? "No CI workflow (AI-tailored fix available)" : "No GitHub Actions CI workflow",
      severity: opts?.severity ?? "high",
      why: isAi
        ? "Every push should run lint, typecheck, and tests. AI generates a workflow tailored to your framework and scripts."
        : "Every push to main is untested. A single bad merge can break production silently.",
      timeSaved: "2h",
      fixId,
      checkedFor,
    });
  }
}

// Real secrets-exposure detection — not "missing a file", but "a credential file is sitting in
// git history right now". Something an AI editor has no reason to proactively flag for you;
// it's a security audit finding, not a generation task.
export function checkReadme(readme: string | null, issues: IssueInput[], fixId = "readme") {
  if (!hasReadmeSetupSection(readme)) {
    const isAi = fixId === "readme-ai";
    issues.push({
      category: "Documentation",
      title: isAi
        ? "Missing setup instructions (AI-written fix available)"
        : "Missing setup instructions",
      severity: "medium",
      why: isAi
        ? "AI writes setup docs using your actual repo name, stack, and npm scripts so new contributors can run the project immediately."
        : "When setup steps are implicit, launches get blocked by avoidable handoffs. Clear runbook-style setup docs reduce production-time confusion.",
      timeSaved: "1h",
      fixId,
      checkedFor: ["README.md", "setup/install/getting started section"],
    });
  }
}

// Generic fallback for "no tests at all" — only fires if a more tailored testing fix (AI vitest
// for Next.js/Vite/React, AI Supertest for Express) hasn't already been queued for this same gap.
// Call this AFTER the framework-specific checks so it can see what they already added.
export function checkTestScript(
  scripts: Record<string, string>,
  issues: IssueInput[],
  fixId = "vitest",
) {
  const hasTailoredTestingFix = issues.some(
    (i) => i.fixId === "vitest-ai" || i.fixId === "api-tests",
  );
  if (hasTailoredTestingFix) return;

  const test = scripts["test"] ?? "";
  const isMissing = !test || test.startsWith("echo") || test.includes("no test specified");
  if (isMissing) {
    issues.push({
      category: "Testing",
      title: "No test script in package.json",
      severity: "high",
      why: "Without a runnable test command, your delivery process has no safety gate. Regressions ship silently because CI has nothing authoritative to execute.",
      timeSaved: "1h",
      fixId,
      checkedFor: ['package.json scripts["test"]'],
    });
  }
}

export function checkLintScript(scripts: Record<string, string>, issues: IssueInput[]) {
  if (!scripts["lint"]) {
    issues.push({
      category: "Code Quality",
      title: "No lint script in package.json",
      severity: "medium",
      why: "Linting catches low-cost correctness issues before they become production bugs. Without it, review cycles slow down and consistency drifts.",
      timeSaved: "30m",
      fixId: "eslint",
      checkedFor: ['package.json scripts["lint"]'],
    });
  }
}

/** Platform deploy configs — Dockerfile not required when these exist. */
const PLATFORM_DEPLOY_FILES = [
  "vercel.json",
  ".vercel/project.json",
  "railway.json",
  "railway.toml",
  "render.yaml",
  "fly.toml",
  "netlify.toml",
  "Procfile",
  "app.yaml",
  "wrangler.toml",
];

export function hasPlatformDeployConfig(files: string[]): boolean {
  return files.some((f) =>
    PLATFORM_DEPLOY_FILES.some(
      (p) => f === p || f.endsWith(`/${p}`) || (p.startsWith(".") && f.includes(p)),
    ),
  );
}

export function checkDockerfile(
  files: string[],
  issues: IssueInput[],
  deployTargets: string[] = [],
) {
  const platformHosted = deployTargets.some((t) =>
    ["Vercel", "Railway", "Render", "Netlify", "Fly.io", "Cloudflare"].includes(t),
  );
  if (platformHosted || hasPlatformDeployConfig(files)) return;

  const hasDocker = files.some(
    (f) =>
      f === "Dockerfile" ||
      f === "docker-compose.yml" ||
      f === "docker-compose.yaml" ||
      f.endsWith("/Dockerfile"),
  );
  if (!hasDocker) {
    issues.push({
      category: "Deployment",
      title: "No Dockerfile or docker-compose",
      severity: "medium",
      why: "Without reproducible build artifacts, production behavior differs from local and CI. A container baseline removes environment drift during launch week.",
      timeSaved: "2h",
      fixId: "dockerfile",
      checkedFor: [
        "Dockerfile",
        "docker-compose.yml",
        "docker-compose.yaml",
        ...PLATFORM_DEPLOY_FILES,
      ],
    });
  }
}

export interface NonJsManifests {
  requirements?: string | null;
  pyprojectToml?: string | null;
  gemfile?: string | null;
  goMod?: string | null;
  composerJson?: string | null;
  cargoToml?: string | null;
  mixExs?: string | null;
  pomXml?: string | null;
  buildGradle?: string | null;
  pubspecYaml?: string | null;
}

export function detectLanguage(files: string[]): string {
  if (files.some((f) => f === "pubspec.yaml")) return "Flutter";
  if (
    files.some((f) => f === "Package.swift" || f.endsWith(".xcodeproj") || /\.xcodeproj\//.test(f))
  ) {
    return "Swift";
  }
  if (files.some((f) => f === "go.mod")) return "Go";
  if (files.some((f) => f === "Gemfile")) return "Ruby";
  if (files.some((f) => f === "requirements.txt" || f === "pyproject.toml" || f === "setup.py"))
    return "Python";
  if (files.some((f) => f === "mix.exs")) return "Elixir";
  const ktCount = files.filter((f) => /\.(kt|kts)$/.test(f) && !f.includes("build.gradle")).length;
  const javaCount = files.filter((f) => f.endsWith(".java")).length;
  const hasJvmBuild = files.some(
    (f) => f === "build.gradle.kts" || f === "build.gradle" || f === "pom.xml",
  );
  // Kotlin builds with Maven (pom.xml) too, not only Gradle — decide by .kt dominance, not the
  // build tool. This was previously gated on build.gradle, so a Maven + Kotlin project (Spring Boot
  // Kotlin, etc.) fell through to "Java" and got offered checkstyle, which cannot lint .kt files.
  if (hasJvmBuild && ktCount > 0 && ktCount >= javaCount) return "Kotlin";
  if (hasJvmBuild) return "Java";
  if (files.some((f) => f === "composer.json")) return "PHP";
  if (files.some((f) => f === "Cargo.toml")) return "Rust";
  if (files.some((f) => f.endsWith(".csproj"))) return "C#";
  return "unknown";
}

export function checkMonitoring(
  deps: Record<string, string>,
  files: string[],
  issues: IssueInput[],
  manifests?: NonJsManifests,
) {
  const checkedFor = [
    "Sentry",
    "Datadog",
    "LogRocket",
    "PostHog",
    "New Relic",
    "Bugsnag",
    "Rollbar",
    "Highlight.io",
    "OpenTelemetry",
  ];
  const hasMonitoring =
    // Sentry
    deps["@sentry/react"] ||
    deps["@sentry/nextjs"] ||
    deps["@sentry/node"] ||
    deps["@sentry/browser"] ||
    deps["@sentry/vue"] ||
    deps["@sentry/svelte"] ||
    files.some((f) => /sentry/i.test(f)) ||
    (manifests?.requirements && /sentry.sdk/i.test(manifests.requirements)) ||
    (manifests?.gemfile && /sentry-ruby|sentry-rails/i.test(manifests.gemfile)) ||
    (manifests?.goMod && /getsentry\/sentry-go/.test(manifests.goMod)) ||
    (manifests?.composerJson && /sentry\/sentry/.test(manifests.composerJson)) ||
    (manifests?.cargoToml && /^\s*sentry\s*=/m.test(manifests.cargoToml)) ||
    (manifests?.pomXml && /io\.sentry/.test(manifests.pomXml)) ||
    // Datadog
    deps["dd-trace"] ||
    deps["@datadog/browser-rum"] ||
    deps["@datadog/browser-logs"] ||
    deps["datadog-lambda-js"] ||
    (manifests?.requirements && /ddtrace/i.test(manifests.requirements)) ||
    (manifests?.gemfile && /dogapi|datadog/i.test(manifests.gemfile)) ||
    (manifests?.goMod && /DataDog\/dd-trace-go/.test(manifests.goMod)) ||
    (manifests?.pomXml && /dd-trace-api/.test(manifests.pomXml)) ||
    // LogRocket
    deps["logrocket"] ||
    deps["logrocket-react"] ||
    // PostHog
    deps["posthog-js"] ||
    deps["posthog-node"] ||
    // New Relic
    deps["newrelic"] ||
    deps["@newrelic/browser-agent"] ||
    (manifests?.requirements && /newrelic/i.test(manifests.requirements)) ||
    (manifests?.gemfile && /newrelic/i.test(manifests.gemfile)) ||
    // Bugsnag
    deps["@bugsnag/js"] ||
    deps["@bugsnag/plugin-react"] ||
    deps["@bugsnag/node"] ||
    // Rollbar
    deps["rollbar"] ||
    // Highlight.io
    deps["@highlight-run/node"] ||
    deps["highlight.run"] ||
    // OpenTelemetry (covers Honeycomb, Grafana, self-hosted setups)
    deps["@opentelemetry/api"] ||
    deps["@opentelemetry/sdk-node"];

  if (!hasMonitoring) {
    issues.push({
      category: "Monitoring",
      title: "No error monitoring detected",
      severity: "medium",
      why: "No recognised monitoring library found. If you have custom error logging or use server logs, you can accept this as not applicable.",
      timeSaved: "2h",
      fixId: "monitoring",
      checkedFor,
    });
  }
}

/** Every E2B runner we recognise, plus the config files and directories they generate. */
const E2E_DEPS = [
  "@playwright/test",
  "playwright",
  "cypress",
  "@cypress/react",
  "puppeteer",
  "nightwatch",
  "testcafe",
  "webdriverio",
];
const E2E_FILES =
  /^(playwright|cypress|nightwatch|wdio|testcafe)\.config\.[cm]?[jt]s$|^cypress\.json$|^(e2e|cypress|tests\/e2e)\//;

/**
 * E2E coverage was decided by a single dependency name, `@playwright/test` — so a project that
 * installs the `playwright` package instead (same runner, different distribution) was told it had
 * no end-to-end tests while its `playwright.config.ts` sat in the repo root. Any one of a known
 * runner, its config file, or its test directory is proof enough.
 */
export function hasE2ETests(deps: Record<string, string>, files: string[]): boolean {
  return E2E_DEPS.some((d) => deps[d]) || files.some((f) => E2E_FILES.test(f));
}

const E2E_CHECKED_FOR = [
  "playwright / cypress / puppeteer / nightwatch / testcafe / webdriverio dependency",
  "playwright.config.* / cypress.config.* / wdio.config.*",
  "e2e/ or cypress/ directory",
];

export function checkNextJs(deps: Record<string, string>, files: string[], issues: IssueInput[]) {
  if (!deps["vitest"]) {
    issues.push({
      category: "Testing",
      title: "No unit tests",
      severity: "high",
      why: "Vitest integrates tightly with Next.js and gives fast feedback on component and logic regressions. AI-generated tests import your real components.",
      timeSaved: "3h",
      fixId: "vitest-ai",
      checkedFor: ["vitest"],
    });
  }
  if (!hasE2ETests(deps, files)) {
    issues.push({
      category: "Testing",
      title: "No end-to-end tests",
      severity: "medium",
      why: "E2E tests catch broken user flows that unit tests miss. AI-generated tests cover your actual routes.",
      timeSaved: "4h",
      fixId: "playwright-ai",
      checkedFor: E2E_CHECKED_FOR,
    });
  }
  const hasErrorBoundary = files.some(
    (f) =>
      /^app\/.*\/error\.(tsx?|jsx?)$/.test(f) ||
      /^app\/error\.(tsx?|jsx?)$/.test(f) ||
      /^pages\/_error\.(tsx?|jsx?)$/.test(f),
  );
  if (!hasErrorBoundary) {
    issues.push({
      category: "Reliability",
      title: "Missing error boundary (error.tsx)",
      severity: "medium",
      why: "Without an error boundary, uncaught errors show a generic Next.js error page instead of a branded fallback.",
      timeSaved: "1h",
      fixId: "error-boundary",
      checkedFor: ["app/**/error.tsx", "app/error.tsx", "pages/_error.tsx"],
    });
  }
}

export function checkVite(deps: Record<string, string>, files: string[], issues: IssueInput[]) {
  if (!deps["vitest"]) {
    issues.push({
      category: "Testing",
      title: "No unit tests",
      severity: "high",
      why: "Vitest is the fastest unit test runner for Vite projects and shares the same config. AI-generated tests import your real components.",
      timeSaved: "3h",
      fixId: "vitest-ai",
      checkedFor: ["vitest"],
    });
  }
  if (!hasE2ETests(deps, files)) {
    issues.push({
      category: "Testing",
      title: "No end-to-end tests",
      severity: "medium",
      why: "E2E tests catch broken user flows that unit tests miss. AI-generated tests cover your actual routes.",
      timeSaved: "4h",
      fixId: "playwright-ai",
      checkedFor: E2E_CHECKED_FOR,
    });
  }
  const hasEslint =
    deps["eslint"] ||
    files.some((f) =>
      /^\.(eslintrc(\.(js|ts|json|cjs|mjs))?|eslint\.config\.(js|ts|cjs|mjs))$/.test(f),
    );
  if (!hasEslint) {
    issues.push({
      category: "Code Quality",
      title: "ESLint not configured",
      severity: "high",
      why: "Linting enforces predictable code quality under delivery pressure. Missing lint config increases churn and lets obvious bugs survive review.",
      timeSaved: "1h",
      fixId: "eslint",
      checkedFor: ["eslint dependency", ".eslintrc*", "eslint.config.*"],
    });
  }
  const hasPrettier =
    deps["prettier"] || files.some((f) => /^\.prettierrc(\.(js|ts|json|yaml|yml))?$/.test(f));
  if (!hasPrettier) {
    issues.push({
      category: "Code Quality",
      title: "Prettier not configured",
      severity: "low",
      why: "Prettier removes formatting debates and keeps diffs clean.",
      timeSaved: "30m",
      fixId: "prettier",
      checkedFor: ["prettier dependency", ".prettierrc*"],
    });
  }
}

export function checkExpress(
  deps: Record<string, string>,
  issues: IssueInput[],
  files: string[] = [],
  sourceContent: string = "",
) {
  const healthEndpointsChecked = ["/health", "/healthz", "/ready", "/readyz", "/livez"];
  const loggerPackagesChecked = ["morgan", "winston", "pino"];
  const dbPoolingChecked = ["pg-pool", "@databases/pg", "new Pool()", "createPool()"];
  // helmet / rate-limit / cors live in scanner/security/express-middleware.ts
  const hasHealthCheck =
    /get\s*\(\s*['"]\/health['"]/i.test(sourceContent) ||
    files.some((f) => /health/i.test(f) && /\.(ts|js)$/.test(f));
  if (!hasHealthCheck) {
    issues.push({
      category: "Reliability",
      title: "No health check endpoint",
      severity: "medium",
      why: "Railway, Kubernetes, and most cloud platforms use health checks to determine if your app is alive. Without one, deployments may succeed but never receive traffic.",
      timeSaved: "15m",
      fixId: "health-check",
      checkedFor: healthEndpointsChecked,
    });
  }
  const hasDbPool =
    deps["pg-pool"] ||
    deps["@databases/pg"] ||
    /new Pool\(/i.test(sourceContent) ||
    /createPool/i.test(sourceContent);
  // The db-pool fix generates a Postgres pg-pool (src/lib/db.ts + pg-pool deps), so only flag
  // Postgres apps that lack one. Previously mysql2/better-sqlite3/mongoose also triggered this,
  // which shipped a Postgres pool into apps that don't use Postgres — mongoose already pools
  // internally, better-sqlite3 is a synchronous file DB with no pool, and mysql2 needs a MySQL
  // pool, not pg-pool. Flagging them produced a broken fix and wasted an AI run.
  const hasDb = Boolean(deps["pg"]);
  if (hasDb && !hasDbPool) {
    issues.push({
      category: "Reliability",
      title: "No database connection pool",
      severity: "high",
      why: "Per-request DB connections collapse under realistic launch traffic. Pooling stabilizes latency and prevents avoidable outage patterns.",
      timeSaved: "2h",
      fixId: "db-pool",
      checkedFor: dbPoolingChecked,
    });
  }
  const hasLogger = deps["morgan"] || deps["winston"] || deps["pino"];
  if (!hasLogger) {
    issues.push({
      category: "Observability",
      title: "Missing request logger (Morgan / Pino)",
      severity: "medium",
      why: "Without request logs, triage starts blind during incidents. Structured logs are the fastest path from symptom to root cause in production.",
      timeSaved: "1h",
      fixId: "logger",
      checkedFor: loggerPackagesChecked,
    });
  }
  if (!deps["supertest"]) {
    issues.push({
      category: "Testing",
      title: "Missing API tests (Supertest)",
      severity: "high",
      why: "Supertest lets you test Express routes without a real server, ensuring endpoints behave correctly.",
      timeSaved: "3h",
      fixId: "api-tests",
      checkedFor: ["supertest"],
    });
  }
}

// Well-known base configs that enable strict or strictNullChecks by default.
// If tsconfig.json extends one of these, we must not flag the project as missing strict mode
// — the setting is already active through the base, even if not spelled out locally.
const STRICT_BASE_CONFIGS = new Set([
  "@tsconfig/strictest",
  "@tsconfig/strict",
  "@tsconfig/recommended",
  "@tsconfig/node-lts",
  "@tsconfig/node20",
  "@tsconfig/node18",
  "@tsconfig/node16",
  "@tsconfig/bun",
  "@tsconfig/svelte",
  "@tsconfig/nextjs",
  "@tsconfig/vite-react",
  "@tsconfig/esm",
]);

export function checkTypeScriptStrict(tsconfigRaw: string | null, issues: IssueInput[]) {
  if (!tsconfigRaw) return;
  try {
    const parsed = JSON.parse(tsconfigRaw) as {
      extends?: string | string[];
      compilerOptions?: { strict?: boolean; strictNullChecks?: boolean };
    };

    // Check explicit compiler options first
    const opts = parsed.compilerOptions ?? {};
    if (opts.strict === true || opts.strictNullChecks === true) return;

    // Check if the base config already enables strict mode — resolving `extends` prevents
    // generating a no-op PR that adds a setting already inherited from the base config.
    const extendsField = parsed.extends;
    const bases = Array.isArray(extendsField) ? extendsField : extendsField ? [extendsField] : [];
    const inheritsStrict = bases.some((base) => {
      const pkg = base
        .split("/")
        .slice(0, base.startsWith("@") ? 2 : 1)
        .join("/");
      return STRICT_BASE_CONFIGS.has(pkg) || STRICT_BASE_CONFIGS.has(base);
    });
    if (inheritsStrict) return;

    issues.push({
      category: "Code Quality",
      title: "TypeScript null safety is off",
      severity: "medium",
      why: "Most production TypeScript crashes come from unchecked null/undefined paths. Enabling null safety catches these during CI instead of at runtime.",
      timeSaved: "ongoing",
      fixId: "ts-strict",
      checkedFor: [
        "compilerOptions.strict",
        "compilerOptions.strictNullChecks",
        "strict base tsconfig extends",
      ],
    });
  } catch {
    // unparseable tsconfig — skip
  }
}

export function checkNonJsTesting(
  language: string,
  files: string[],
  manifests: NonJsManifests,
  issues: IssueInput[],
) {
  if (language === "python") {
    const hasPytest =
      files.some((f) => /^tests?\/test_.*\.py$|^test_.*\.py$/.test(f)) ||
      (manifests.requirements && /pytest/i.test(manifests.requirements));
    if (!hasPytest) {
      issues.push({
        category: "Testing",
        title: "No pytest tests found",
        severity: "high",
        why: "Without tests, regressions go undetected and CI can't verify correctness. Pytest is the standard Python test runner.",
        timeSaved: "2h",
        fixId: "pytest",
        checkedFor: ["tests/test_*.py", "test_*.py", "pytest in requirements"],
      });
    }
  } else if (language === "ruby") {
    const hasTests =
      files.some((f) => /^spec\//.test(f) || /^test\//.test(f)) ||
      (manifests.gemfile && /rspec|minitest/i.test(manifests.gemfile));
    if (!hasTests) {
      issues.push({
        category: "Testing",
        title: "No RSpec tests found",
        severity: "high",
        why: "Without tests, regressions go undetected. RSpec is the standard Ruby test framework.",
        timeSaved: "2h",
        fixId: "rspec",
        checkedFor: ["spec/", "test/", "rspec/minitest in Gemfile"],
      });
    }
  } else if (language === "php") {
    const hasTests =
      files.some((f) => /^tests?\//.test(f) || /phpunit\.xml/.test(f)) ||
      (manifests.composerJson && /phpunit/i.test(manifests.composerJson));
    if (!hasTests) {
      issues.push({
        category: "Testing",
        title: "No PHPUnit tests found",
        severity: "high",
        why: "Without tests, regressions go undetected. PHPUnit is the standard PHP test framework.",
        timeSaved: "2h",
        fixId: "phpunit",
        checkedFor: ["tests/", "phpunit.xml", "phpunit in composer.json"],
      });
    }
  }
  if (language === "go") {
    const hasTests = files.some((f) => /_test\.go$/.test(f));
    if (!hasTests) {
      issues.push({
        category: "Testing",
        title: "No Go tests found",
        severity: "high",
        why: "Without tests, regressions go undetected. Go's built-in testing package is the standard.",
        timeSaved: "2h",
        fixId: "go-test-ai",
        checkedFor: ["*_test.go"],
      });
    }
  } else if (language === "java") {
    const hasTests =
      files.some((f) => /Test\.java$/.test(f) || /src\/test\//.test(f)) ||
      (manifests.pomXml && /junit|testng/i.test(manifests.pomXml)) ||
      (manifests.buildGradle && /junit|testImplementation/i.test(manifests.buildGradle));
    if (!hasTests) {
      issues.push({
        category: "Testing",
        title: "No JUnit tests found",
        severity: "high",
        why: "Without tests, regressions go undetected. JUnit is the standard Java test framework.",
        timeSaved: "2h",
        fixId: "junit-ai",
        checkedFor: ["src/test/", "*Test.java", "junit in pom.xml/build.gradle"],
      });
    }
  } else if (language === "rust") {
    const hasIntegrationTests = files.some((f) => /^tests\/.+\.rs$/.test(f));
    const hasModuleTests = files.some((f) => /\/tests\.rs$/.test(f) || /\/test\.rs$/.test(f));
    if (!hasIntegrationTests && !hasModuleTests) {
      issues.push({
        category: "Testing",
        title: "No Rust tests found",
        severity: "high",
        why: "Without tests, regressions go undetected. cargo test is the standard Rust test runner.",
        timeSaved: "2h",
        fixId: "cargo-test-ai",
        checkedFor: ["tests/*.rs", "src/**/tests.rs", "cargo test in CI"],
      });
    }
  } else if (language === "csharp" || language === "c#") {
    const hasTests =
      files.some((f) => /Tests?\.cs$/.test(f) || /\/tests?\//i.test(f)) ||
      files.some((f) => f.endsWith(".csproj") && files.some((p) => /xunit|nunit|mstest/i.test(p)));
    if (!hasTests) {
      issues.push({
        category: "Testing",
        title: "No xUnit tests found",
        severity: "high",
        why: "Without tests, regressions go undetected. xUnit is the standard .NET test framework.",
        timeSaved: "2h",
        fixId: "xunit-ai",
        checkedFor: ["*Tests.cs", "tests/", "xunit in .csproj"],
      });
    }
  } else if (language === "elixir") {
    const hasTests =
      files.some((f) => /^test\//.test(f) && /\.exs?$/.test(f)) ||
      (manifests.mixExs && /ex_unit/i.test(manifests.mixExs));
    if (!hasTests) {
      issues.push({
        category: "Testing",
        title: "No ExUnit tests found",
        severity: "high",
        why: "Without tests, regressions go undetected. ExUnit is the standard Elixir test framework.",
        timeSaved: "2h",
        fixId: "exunit-ai",
        checkedFor: ["test/", "ex_unit in mix.exs"],
      });
    }
  } else if (language === "dart" || language === "flutter") {
    const hasTests =
      files.some((f) => /^test\/.*_test\.dart$/.test(f)) ||
      files.some((f) => /^integration_test\//.test(f)) ||
      (manifests.pubspecYaml && /flutter_test/i.test(manifests.pubspecYaml));
    if (!hasTests) {
      issues.push({
        category: "Testing",
        title: "No Flutter tests found",
        severity: "high",
        why: "Without widget or integration tests, mobile regressions ship to the store undetected.",
        timeSaved: "2h",
        fixId: "dart-test-ai",
        checkedFor: ["test/*_test.dart", "integration_test/", "flutter_test in pubspec.yaml"],
      });
    }
  } else if (language === "swift") {
    const hasTests =
      files.some((f) => /Tests\.swift$/.test(f) || /Tests\//.test(f)) ||
      files.some((f) => /\.xctestplan$/.test(f));
    if (!hasTests) {
      issues.push({
        category: "Testing",
        title: "No XCTest suite found",
        severity: "high",
        why: "Without XCTest coverage, iOS/macOS releases lack automated verification.",
        timeSaved: "2h",
        fixId: "swift-test-ai",
        checkedFor: ["*Tests.swift", "Tests/", ".xctestplan"],
      });
    }
  } else if (language === "kotlin") {
    const hasTests =
      files.some((f) => /src\/(androidTest|test)\//.test(f)) ||
      (manifests.buildGradle && /androidTest|testImplementation/i.test(manifests.buildGradle));
    if (!hasTests) {
      issues.push({
        category: "Testing",
        title: "No Android instrumented/unit tests found",
        severity: "high",
        why: "Without Gradle test targets, Android builds ship without automated checks.",
        timeSaved: "2h",
        fixId: "kotlin-test-ai",
        checkedFor: ["src/androidTest/", "src/test/", "testImplementation in build.gradle"],
      });
    }
  }
}

/** Mobile / desktop launch gaps for JS-based platform stacks. */
export function checkPlatformLaunchReadiness(
  framework: string,
  files: string[],
  issues: IssueInput[],
) {
  if (framework === "Expo" || framework === "React Native") {
    const hasEas = files.some((f) => /eas\.json$/.test(f));
    const hasAppConfig = files.some((f) =>
      /^(app|app\.config)\.(json|js|ts)$/.test(f.split("/").pop() ?? f),
    );
    if (!hasEas && !hasAppConfig) {
      issues.push({
        category: "Deployment",
        title: "No Expo / React Native app configuration",
        severity: "high",
        why: "Mobile builds need app.json or app.config and usually EAS Build before store release.",
        timeSaved: "2h",
        fixId: "github-actions",
        checkedFor: ["app.json", "app.config.js", "app.config.ts", "eas.json"],
      });
    } else if (!hasEas) {
      issues.push({
        category: "Deployment",
        title: "No EAS Build configuration",
        severity: "medium",
        why: "EAS Build is the standard Expo pipeline for iOS and Android store binaries.",
        timeSaved: "1h",
        fixId: "github-actions",
        checkedFor: ["eas.json"],
      });
    }
  } else if (framework === "Electron") {
    const hasBuilder = files.some((f) => /electron-builder\.(json|ya?ml)$/.test(f));
    if (!hasBuilder) {
      issues.push({
        category: "Deployment",
        title: "No electron-builder configuration",
        severity: "high",
        why: "Desktop releases need a packager config for Windows, macOS, and Linux binaries.",
        timeSaved: "2h",
        fixId: "github-actions",
        checkedFor: ["electron-builder.json", "electron-builder.yml"],
      });
    }
  } else if (framework === "Tauri") {
    const hasTauriConf = files.some((f) => /tauri\.conf\.json$/.test(f));
    if (!hasTauriConf) {
      issues.push({
        category: "Deployment",
        title: "No Tauri configuration",
        severity: "high",
        why: "Tauri desktop apps need tauri.conf.json for bundling and platform targets.",
        timeSaved: "2h",
        fixId: "github-actions",
        checkedFor: ["tauri.conf.json", "src-tauri/tauri.conf.json"],
      });
    }
  }
}

export function checkNonJsLinting(
  language: string,
  files: string[],
  manifests: {
    requirements?: string | null;
    gemfile?: string | null;
    composerJson?: string | null;
    pomXml?: string | null;
    buildGradle?: string | null;
    mixExs?: string | null;
  },
  issues: IssueInput[],
) {
  if (language === "python") {
    const hasRuff =
      files.some((f) => /^ruff\.toml$/.test(f)) ||
      (manifests.requirements && /ruff/i.test(manifests.requirements));
    const hasFlake = files.some((f) => /^\.flake8$|^setup\.cfg$/.test(f));
    if (!hasRuff && !hasFlake) {
      issues.push({
        category: "Code Quality",
        title: "No Python linter configured",
        severity: "medium",
        why: "Ruff catches unused imports, undefined names, and style issues in milliseconds — faster than flake8 or pylint.",
        timeSaved: "1h",
        fixId: "ruff",
        checkedFor: ["ruff.toml", ".flake8", "setup.cfg", "ruff in requirements"],
      });
    }
  } else if (language === "ruby") {
    const hasRubocop =
      files.some((f) => /^\.rubocop\.ya?ml$/.test(f)) ||
      (manifests.gemfile && /rubocop/i.test(manifests.gemfile));
    if (!hasRubocop) {
      issues.push({
        category: "Code Quality",
        title: "No RuboCop linter configured",
        severity: "medium",
        why: "RuboCop enforces consistent Ruby style and catches common mistakes before they reach production.",
        timeSaved: "1h",
        fixId: "rubocop",
        checkedFor: [".rubocop.yml", ".rubocop.yaml", "rubocop in Gemfile"],
      });
    }
  } else if (language === "go") {
    const hasGolangci = files.some((f) => /^\.golangci\.ya?ml$/.test(f));
    if (!hasGolangci) {
      issues.push({
        category: "Code Quality",
        title: "No golangci-lint config",
        severity: "medium",
        why: "golangci-lint runs a curated set of Go linters including errcheck, staticcheck, and govet — catches bugs `go vet` alone misses.",
        timeSaved: "1h",
        fixId: "golangci-lint",
        checkedFor: [".golangci.yml", ".golangci.yaml"],
      });
    }
  } else if (language === "php") {
    const composerBlob = manifests.composerJson ?? "";
    const hasLinter =
      files.some((f) => /^phpcs\.xml(\.dist)?$|^\.php-cs-fixer\.php$|^pint\.json$/.test(f)) ||
      /phpcs|php-cs-fixer|pint|phpmd/i.test(composerBlob);
    if (!hasLinter) {
      issues.push({
        category: "Code Quality",
        title: "No PHP linter configured",
        severity: "medium",
        why: "PHP CS Fixer or PHP_CodeSniffer enforce style consistency and catch potential bugs before they reach production.",
        timeSaved: "1h",
        fixId: "phpcs",
        checkedFor: [
          "phpcs.xml",
          ".php-cs-fixer.php",
          "pint.json",
          "phpcs/php-cs-fixer in composer.json",
        ],
      });
    }
  } else if (language === "java") {
    const javaBlob = [manifests.pomXml, manifests.buildGradle].filter(Boolean).join("\n");
    const hasLinter =
      files.some((f) => /^checkstyle\.xml$|^pmd\.xml$/.test(f)) ||
      /checkstyle|pmd|spotbugs|errorprone/i.test(javaBlob);
    if (!hasLinter) {
      issues.push({
        category: "Code Quality",
        title: "No Java static analysis configured",
        severity: "medium",
        why: "Checkstyle or SpotBugs catch style violations and common bugs (null dereferences, resource leaks) in CI before they ship.",
        timeSaved: "1h",
        fixId: "checkstyle",
        checkedFor: ["checkstyle.xml", "pmd.xml", "checkstyle/spotbugs in pom.xml or build.gradle"],
      });
    }
  } else if (language === "elixir") {
    const hasCredo =
      files.some((f) => /^\.credo\.exs$/.test(f)) ||
      (manifests.mixExs && /credo/i.test(manifests.mixExs));
    if (!hasCredo) {
      issues.push({
        category: "Code Quality",
        title: "No Credo linter configured",
        severity: "medium",
        why: "Credo enforces Elixir style guidelines and catches common anti-patterns before they make it to production.",
        timeSaved: "1h",
        fixId: "credo",
        checkedFor: [".credo.exs", "credo in mix.exs"],
      });
    }
  }
}

export function checkNonJsHealthCheck(language: string, files: string[], issues: IssueInput[]) {
  const checkedFor = ["/health", "/healthz", "/ready", "/readyz", "/livez"];
  const hasHealthRoute =
    files.some((f) => /health/i.test(f)) ||
    // Go-specific check
    (language === "go" && files.some((f) => /^internal\/health\//.test(f)));
  if (!hasHealthRoute) {
    issues.push({
      category: "Reliability",
      title: "No health check endpoint",
      severity: "medium",
      why: "Railway, Kubernetes, and most cloud platforms use health checks to determine if your app is alive. Without one, deployments may succeed but never receive traffic.",
      timeSaved: "15m",
      fixId: "health-check",
      checkedFor,
    });
  }
}

export function checkNonJsDockerfile(files: string[], issues: IssueInput[]) {
  const hasDocker = files.some(
    (f) =>
      f === "Dockerfile" ||
      f === "docker-compose.yml" ||
      f === "docker-compose.yaml" ||
      f.endsWith("/Dockerfile"),
  );
  if (!hasDocker) {
    issues.push({
      category: "Deployment",
      title: "No Dockerfile or docker-compose",
      severity: "medium",
      why: "A Dockerfile makes builds reproducible across local, CI, and production hosts.",
      timeSaved: "2h",
      fixId: "dockerfile",
      checkedFor: ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"],
    });
  }
}

const SEVERITY_RANK: Record<IssueInput["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Combine two issues that share a fixId, keeping the worse one's narrative and both sets of
 * evidence. Order-independent apart from ties, which keep the earlier issue.
 */
function mergeIssues(a: IssueInput, b: IssueInput): IssueInput {
  const base = SEVERITY_RANK[b.severity] < SEVERITY_RANK[a.severity] ? b : a;
  const other = base === a ? b : a;

  const evidence = [a.foundEvidence, b.foundEvidence].filter((e): e is string =>
    Boolean(e && e.trim()),
  );
  const uniqueEvidence = [...new Set(evidence)];

  return {
    ...base,
    severity: base.severity,
    foundEvidence: uniqueEvidence.length > 0 ? uniqueEvidence.join(" ") : undefined,
    checkedFor:
      a.checkedFor || b.checkedFor
        ? [...new Set([...(base.checkedFor ?? []), ...(other.checkedFor ?? [])])]
        : undefined,
  };
}

/**
 * Collapse issues to one per fixId. A fixId names a fix *tool*, and the UI renders one action per
 * issue, so two rows sharing an id would offer the same fix twice.
 *
 * Collisions merge rather than drop. Dropping silently discarded real findings every time a check
 * located more than one instance of the same problem — five vulnerable dependencies reported one
 * CVE, several unguarded API routes reported one route — and because those checks sort worst-first,
 * the surviving row always looked plausible while the count was wrong. Checks should still
 * aggregate their own findings so the title carries an accurate count; this is the backstop that
 * keeps the failure from being invisible when they don't.
 */
export function dedupeIssues(issues: IssueInput[]): IssueInput[] {
  const byFixId = new Map<string, IssueInput>();
  for (const issue of issues) {
    const existing = byFixId.get(issue.fixId);
    byFixId.set(issue.fixId, existing ? mergeIssues(existing, issue) : issue);
  }
  return [...byFixId.values()];
}
