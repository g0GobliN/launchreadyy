export type CiStep = "lint" | "typecheck" | "test" | "build";

import type {
  EnvContract,
  ProjectIntelligence,
  WorkspacePackage,
} from "./project-intelligence.server";
import { ciMatrixPackages } from "./project-intelligence.server";

function parsePackageManagerVersion(
  packageManager: string | undefined,
  name: "pnpm" | "yarn",
): string | undefined {
  if (!packageManager) return undefined;
  const match = packageManager.match(new RegExp(`^${name}@(.+)$`));
  return match?.[1];
}

export interface PackageJsonForCi {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  nodeVersion: string;
  packageManager?: string;
}

export interface ProjectCiProfile {
  nodeVersion: string;
  pnpmVersion?: string;
  framework: string;
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  steps: CiStep[];
  summary: string;
  buildEnvVars?: string[];
  testEnvVars?: string[];
  isStaticSpa?: boolean;
  hasPlaywright?: boolean;
  productionBaseline?: boolean;
}

export function isRealTestScript(test?: string): boolean {
  if (!test?.trim()) return false;
  if (/no test specified/i.test(test)) return false;
  if (/^echo\s+/i.test(test)) return false;
  return true;
}

export function projectUsesTypeScript(pkg: PackageJsonForCi, filePaths: string[]): boolean {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.typescript) return true;
  if (filePaths.some((p) => /(^|\/)tsconfig(\.[\w-]+)?\.json$/.test(p))) return true;
  const ts = filePaths.filter(
    (p) => /\.(tsx?|mts)$/.test(p) && !p.endsWith(".d.ts") && !p.includes("node_modules"),
  ).length;
  const js = filePaths.filter(
    (p) => /\.(jsx?|mjs|cjs)$/.test(p) && !p.includes("node_modules") && !/\.config\./.test(p),
  ).length;
  return ts > 0 && ts >= js;
}

export function analyzeProjectCi(input: {
  pkg: PackageJsonForCi;
  framework: string;
  filePaths: string[];
  packageManager: ProjectCiProfile["packageManager"];
  pendingScripts?: Partial<Record<CiStep, boolean>>;
  /** CI fix bundles eslint/vitest — workflow must include those gates */
  productionBaseline?: boolean;
  envVars?: string[];
  isStaticSpa?: boolean;
  hasPlaywright?: boolean;
  envContract?: EnvContract;
}): ProjectCiProfile {
  const scripts = { ...input.pkg.scripts };
  const pending = input.pendingScripts ?? {};
  const baseline = input.productionBaseline === true;
  const usesTs = projectUsesTypeScript(input.pkg, input.filePaths);
  const steps: CiStep[] = [];
  const reasons: string[] = [];

  const willLint = Boolean(scripts.lint?.trim()) || pending.lint === true || baseline;
  const willTypecheck =
    usesTs && (Boolean(scripts.typecheck?.trim()) || pending.typecheck === true);
  const willTest = isRealTestScript(scripts.test) || pending.test === true || baseline;
  const willBuild = Boolean(scripts.build?.trim()) || baseline;

  if (willLint) {
    steps.push("lint");
    reasons.push(baseline && !scripts.lint ? "lint (production baseline)" : "lint");
  }
  if (willTypecheck) {
    steps.push("typecheck");
    reasons.push("typecheck");
  }
  if (willTest) {
    steps.push("test");
    reasons.push(
      baseline && !isRealTestScript(scripts.test) ? "test (production baseline)" : "test",
    );
  }
  if (willBuild && Boolean(scripts.build?.trim() || baseline)) {
    if (
      scripts.build?.trim() ||
      input.framework === "Vite" ||
      input.framework === "React" ||
      input.framework === "Next.js"
    ) {
      steps.push("build");
      reasons.push("build");
    }
  }

  const pnpmVersion = parsePackageManagerVersion(input.pkg.packageManager, "pnpm");
  // Next.js evaluates server route modules while collecting build output, so server-only values
  // can be required during `next build` as well as at runtime. Static browser builds only need
  // their public build contract.
  const buildEnv = input.envContract
    ? input.framework === "Next.js"
      ? [...new Set(input.envContract.all)]
      : input.envContract.build
    : (input.envVars ?? []).filter((v) => v.startsWith("VITE_") || v.startsWith("NEXT_PUBLIC_"));
  const testEnv = input.envContract?.test?.length
    ? [...new Set([...input.envContract.test, ...input.envContract.runtime])]
    : (input.envVars ?? []);

  return {
    nodeVersion: input.pkg.nodeVersion,
    pnpmVersion,
    framework: input.framework,
    packageManager: input.packageManager,
    steps,
    buildEnvVars: buildEnv,
    testEnvVars: testEnv,
    isStaticSpa: input.isStaticSpa,
    hasPlaywright: input.hasPlaywright,
    productionBaseline: baseline,
    summary:
      steps.length > 0
        ? `Production CI: ${steps.join(" → ")} + security (${reasons.join(", ")})`
        : "No CI steps detected",
  };
}

/** Optionally bundle lint + test with CI — only when explicitly requested (not silent). */
export function expandFixIdsForProductionCi(
  fixIds: string[],
  opts: {
    isNodeProject: boolean;
    scripts: Record<string, string>;
    eslintConfigured?: boolean;
    bundlePrerequisites?: boolean;
  },
): { fixIds: string[]; bundled: string[] } {
  const hasCi = fixIds.some((id) => id === "github-actions" || id === "ci-ai");
  const shouldBundle = opts.bundlePrerequisites !== false;
  if (!hasCi || !opts.isNodeProject || !shouldBundle) {
    return { fixIds, bundled: [] };
  }

  const expanded = new Set(fixIds);
  const bundled: string[] = [];

  // A script is not sufficient proof of a runnable non-interactive linter. `next lint`, for
  // example, opens a setup prompt and exits in CI when no config exists. Callers with repository
  // context pass eslintConfigured; older callers retain the script-only behavior.
  const hasRunnableLint = Boolean(opts.scripts.lint?.trim()) && opts.eslintConfigured !== false;
  if (!hasRunnableLint && !fixIds.includes("eslint")) {
    expanded.add("eslint");
    bundled.push("eslint");
  }
  if (
    !isRealTestScript(opts.scripts.test) &&
    !fixIds.some((id) => id === "vitest" || id === "vitest-ai" || id === "api-tests")
  ) {
    expanded.add("vitest-ai");
    bundled.push("vitest-ai");
  }

  return { fixIds: sortFixIdsForProduction([...expanded]), bundled };
}

const PREREQ_FIXES = ["eslint", "prettier", "vitest", "vitest-ai", "env-example", "env-example-ai"];
const CI_FIXES = new Set(["github-actions", "ci-ai"]);

export function sortFixIdsForProduction(fixIds: string[]): string[] {
  const prereq = fixIds.filter((id) => PREREQ_FIXES.includes(id));
  const ci = fixIds.filter((id) => CI_FIXES.has(id));
  const rest = fixIds.filter((id) => !PREREQ_FIXES.includes(id) && !CI_FIXES.has(id));
  return [...new Set([...prereq, ...rest, ...ci])];
}

export function pendingScriptsFromFixIds(fixIds: string[]): Partial<Record<CiStep, boolean>> {
  const pending: Partial<Record<CiStep, boolean>> = {};
  if (fixIds.some((id) => id === "eslint")) pending.lint = true;
  if (fixIds.some((id) => id === "vitest" || id === "vitest-ai" || id === "api-tests"))
    pending.test = true;
  if (fixIds.some((id) => id === "github-actions" || id === "ci-ai")) {
    pending.typecheck = true;
    pending.lint = true;
    pending.test = true;
  }
  return pending;
}

export function ciDummyEnvValue(name: string): string {
  if (name === "NODE_ENV") return "test";
  if (name === "CI") return "true";
  if (/STRIPE.*WEBHOOK/i.test(name)) return "whsec_dummy_ci";
  if (/STRIPE/i.test(name)) return "sk_test_dummy";
  if (/FIREBASE.*BUCKET/i.test(name)) return "dummy.appspot.com";
  if (/FIREBASE.*DOMAIN/i.test(name)) return "dummy.firebaseapp.com";
  if (/FIREBASE.*APP_ID/i.test(name)) return "1:000:web:000";
  if (/FIREBASE.*API/i.test(name)) return "dummy-ci-firebase-key";
  if (/FIREBASE.*PROJECT/i.test(name)) return "dummy-project";
  if (/^(?:VITE_|NEXT_PUBLIC_).*(?:URL|HOST|DOMAIN)/i.test(name)) return "http://localhost:8080";
  if (/^VITE_/i.test(name)) return "dummy-ci-value";
  if (/^NEXT_PUBLIC_/i.test(name)) return "dummy-ci-value";
  if (/SECRET|KEY|TOKEN|PASSWORD/i.test(name)) return "ci-test-secret-32chars-minimum!!";
  if (/URL|HOST|DOMAIN/i.test(name)) return "http://localhost:8080";
  if (/PORT/i.test(name)) return "3000";
  return "dummy-ci-value";
}

/**
 * A job-level `env:` block. Both call sites (testJob, buildJob) splice this in between
 * `timeout-minutes:` and `steps:`, which sit at 4 spaces — so `env:` belongs at 4 and its
 * variables at 6.
 *
 * This previously defaulted to 8 spaces *and* emitted each variable at that same 8, producing:
 *
 *     timeout-minutes: 20
 *         env:
 *         NODE_ENV: test
 *     steps:
 *
 * which is not valid YAML ("mapping values are not allowed here"). GitHub rejected the whole
 * workflow at startup — 0 jobs, no logs, just a failed run — so every generated CI fix for a
 * repo whose test or build step needs env vars shipped a file Actions could not load at all.
 * Repos with no test/build env vars produced an empty string here, which is why this survived.
 * Caught by opening a real PR against a real repo and reading the Actions result.
 */
function yamlEnvBlock(vars: string[], indent = "    "): string {
  const unique = [...new Set(vars)];
  if (!unique.length) return "";
  const lines = unique.map((v) => `${indent}  ${v}: ${ciDummyEnvValue(v)}`);
  return `${indent}env:\n${lines.join("\n")}\n`;
}

const PM_DETECT_SHELL = `          if [ -f pnpm-lock.yaml ]; then
            echo "name=pnpm"                              >> $GITHUB_OUTPUT
            echo "install=pnpm install"                         >> $GITHUB_OUTPUT
            echo "run=pnpm run"                           >> $GITHUB_OUTPUT
            echo "audit=pnpm audit --audit-level high"    >> $GITHUB_OUTPUT
            echo "cache=pnpm"                             >> $GITHUB_OUTPUT
            echo "berry=false"                            >> $GITHUB_OUTPUT
          elif [ -f yarn.lock ]; then
            echo "name=yarn"                              >> $GITHUB_OUTPUT
            echo "run=yarn"                               >> $GITHUB_OUTPUT
            echo "audit=yarn npm audit --severity high"   >> $GITHUB_OUTPUT
            echo "cache=yarn"                             >> $GITHUB_OUTPUT
            if [ -f .yarnrc.yml ]; then
              echo "install=yarn install"     >> $GITHUB_OUTPUT
              echo "berry=true"                           >> $GITHUB_OUTPUT
            else
              echo "install=yarn install" >> $GITHUB_OUTPUT
              echo "berry=false"                          >> $GITHUB_OUTPUT
            fi
          elif [ -f bun.lockb ] || [ -f bun.lock ]; then
            echo "name=bun"                               >> $GITHUB_OUTPUT
            echo "install=bun install"  >> $GITHUB_OUTPUT
            echo "run=bun run"                            >> $GITHUB_OUTPUT
            echo "audit="                                 >> $GITHUB_OUTPUT
            echo "cache="                                 >> $GITHUB_OUTPUT
            echo "berry=false"                            >> $GITHUB_OUTPUT
          elif [ -f package-lock.json ]; then
            echo "name=npm"                               >> $GITHUB_OUTPUT
            echo "install=npm install"                    >> $GITHUB_OUTPUT
            echo "run=npm run"                            >> $GITHUB_OUTPUT
            echo "audit=npm audit --audit-level=critical" >> $GITHUB_OUTPUT
            echo "cache=npm"                              >> $GITHUB_OUTPUT
            echo "berry=false"                            >> $GITHUB_OUTPUT
          else
            echo "name=npm"                               >> $GITHUB_OUTPUT
            echo "install=npm install"                    >> $GITHUB_OUTPUT
            echo "run=npm run"                            >> $GITHUB_OUTPUT
            echo "audit=npm audit --audit-level=critical" >> $GITHUB_OUTPUT
            echo "cache="                                 >> $GITHUB_OUTPUT
            echo "berry=false"                            >> $GITHUB_OUTPUT
          fi`;

function pmSetupSteps(profile: ProjectCiProfile, jobId = "pm"): string {
  // pnpm/action-setup otherwise follows the newest pnpm release when a repository has no
  // packageManager field. pnpm 10's strict dependency-build policy can reject older, otherwise
  // valid lockfiles with ERR_PNPM_IGNORED_BUILDS. Match the Docker generator's stable default;
  // an explicit packageManager (for example pnpm@10.17.1) still wins.
  const pnpmLine = `\n          version: ${profile.pnpmVersion ?? "9"}`;
  return `      - id: ${jobId}
        name: Detect package manager
        run: |
${PM_DETECT_SHELL}

      - if: steps.${jobId}.outputs.name == 'pnpm'
        uses: pnpm/action-setup@v4
        with:
          run_install: false${pnpmLine}

      - if: steps.${jobId}.outputs.name == 'bun'
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - if: steps.${jobId}.outputs.berry == 'true'
        name: Enable Corepack
        run: corepack enable

      - if: steps.${jobId}.outputs.name != 'bun'
        uses: actions/setup-node@v4
        with:
          node-version: "${profile.nodeVersion}"
          cache: \${{ steps.${jobId}.outputs.cache }}

      - name: Install dependencies
        run: \${{ steps.${jobId}.outputs.install }}
`;
}

const SECRET_SCAN_STEPS = `      - uses: actions/checkout@v4

      - name: Scan for committed secrets
        run: |
          echo "Scanning for accidentally committed secrets..."
          FAIL=0

          if find . -name "serviceAccountKey.json" -not -path "*/node_modules/*" | grep -q .; then
            echo "FOUND: serviceAccountKey.json committed to repo!"
            FAIL=1
          fi

          if find . -name ".env" -not -name ".env.example" -not -path "*/node_modules/*" | grep -q .; then
            echo "WARNING: .env file found (ensure it contains no real secrets)"
          fi

          if grep -rE "sk_live_[0-9a-zA-Z]+" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --exclude-dir=node_modules --exclude-dir=dist . 2>/dev/null | grep -qv ".env.example"; then
            echo "FOUND: Hardcoded Stripe LIVE key in source!"
            FAIL=1
          fi

          if grep -rE "AIza[0-9A-Za-z_-]{35}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --exclude-dir=node_modules --exclude-dir=dist . 2>/dev/null | grep -qv ".env.example"; then
            echo "WARNING: Possible hardcoded Firebase API key in source"
          fi

          if [ $FAIL -eq 1 ]; then
            echo "Secret scan FAILED — remove secrets before merge."
            exit 1
          fi
          echo "Secret scan passed."
`;

function qualityJob(profile: ProjectCiProfile): string | null {
  const steps = profile.steps.filter((s) => s === "lint" || s === "typecheck");
  if (!steps.length) return null;

  const stepLines = steps
    .map((s) => {
      const label = s.charAt(0).toUpperCase() + s.slice(1);
      return `      - name: ${label}\n        run: \${{ steps.pm.outputs.run }} ${s}`;
    })
    .join("\n\n");

  return `  quality:
    name: Quality (${steps.join(" · ")})
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

${pmSetupSteps(profile)}
${stepLines}
`;
}

function testJob(profile: ProjectCiProfile): string | null {
  if (!profile.steps.includes("test")) return null;
  const envBlock = yamlEnvBlock(profile.testEnvVars ?? []);

  return `  test:
    name: Tests
    runs-on: ubuntu-latest
    timeout-minutes: 20
${envBlock}    steps:
      - uses: actions/checkout@v4

${pmSetupSteps(profile, "pm-test")}
      - name: Run tests
        run: \${{ steps.pm-test.outputs.run }} test
`;
}

function buildJob(profile: ProjectCiProfile): string | null {
  if (!profile.steps.includes("build")) return null;
  const needsQuality = profile.steps.some((s) => s === "lint" || s === "typecheck");
  const envBlock = yamlEnvBlock(profile.buildEnvVars ?? []);
  const verifyStep = profile.isStaticSpa
    ? `
      - name: Verify static build output
        run: test -d dist && ls dist/`
    : profile.framework === "Next.js"
      ? `
      - name: Verify Next.js build
        run: test -d .next`
      : "";

  return `  build:
    name: Build
    runs-on: ubuntu-latest
    timeout-minutes: 20
${needsQuality ? "    needs: [quality]\n" : ""}${envBlock}    steps:
      - uses: actions/checkout@v4

${pmSetupSteps(profile, "pm-build")}
      - name: Build
        run: \${{ steps.pm-build.outputs.run }} build${verifyStep}
`;
}

function securityAuditJob(profile: ProjectCiProfile): string {
  return `  security-audit:
    name: Security (dependency audit)
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

${pmSetupSteps(profile, "pm-audit")}
      - name: Audit dependencies
        if: steps.pm-audit.outputs.audit != ''
        run: \${{ steps.pm-audit.outputs.audit }}
`;
}

function secretScanJob(): string {
  return `  secret-scan:
    name: Security (secret scan)
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
${SECRET_SCAN_STEPS}`;
}

function e2eJob(profile: ProjectCiProfile): string | null {
  if (!profile.hasPlaywright) return null;
  return `  e2e:
    name: E2E (Playwright)
    runs-on: ubuntu-latest
    timeout-minutes: 25
    needs: [build]
    steps:
      - uses: actions/checkout@v4

${pmSetupSteps(profile, "pm-e2e")}
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run E2E tests
        run: \${{ steps.pm-e2e.outputs.run }} test:e2e
        env:
          CI: true
`;
}

/** Production-grade multi-job CI — parallel security, quality gates, env-aware build/test. */
/**
 * Public entry. Normalises the trailing newline on every return path.
 *
 * Repos whose lint script is `prettier --check .` (very common) fail CI on any file that is not
 * Prettier-clean — including the workflow this generator just added. A stray blank line at EOF
 * was enough to make the fix PR break the very check it installs. Verified against a real repo:
 * the only remaining Prettier complaints were this and single-vs-double quotes, both fixed here.
 */
export function buildProjectCiWorkflow(
  profile: ProjectCiProfile,
  intelligence?: ProjectIntelligence,
): string {
  return `${buildProjectCiWorkflowInner(profile, intelligence).replace(/\s+$/, "")}\n`;
}

function buildProjectCiWorkflowInner(
  profile: ProjectCiProfile,
  intelligence?: ProjectIntelligence,
): string {
  const matrixPkgs = intelligence ? ciMatrixPackages(intelligence.packages) : [];
  if (matrixPkgs.length > 1) {
    return buildMonorepoCiWorkflow(profile, matrixPkgs, intelligence!);
  }

  if (profile.steps.length === 0 && !profile.productionBaseline) {
    return `name: CI

on:
  push:
    branches: [main, master, develop]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "Add package.json scripts or apply the CI/CD pack"
`;
  }

  const jobs = [
    qualityJob(profile),
    testJob(profile),
    buildJob(profile),
    securityAuditJob(profile),
    secretScanJob(),
    e2eJob(profile),
  ].filter(Boolean);

  return `name: CI

on:
  push:
    branches: [main, master, develop]
  pull_request:

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
${jobs.join("\n")}
`;
}

function monorepoPackageJob(
  profile: ProjectCiProfile,
  pkg: WorkspacePackage,
  intelligence: ProjectIntelligence,
): string {
  const jobId = pkg.dir.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-|-$/g, "") || "root";
  const lockPath =
    pkg.lockfile && pkg.dir !== "." ? "package-lock.json" : pkg.lockfile ? pkg.lockfile : undefined;
  const cachePath = lockPath ? `\n          cache-dependency-path: ${lockPath}` : "";

  const buildEnv = yamlEnvBlock(intelligence.envContract.build);
  const testEnv = yamlEnvBlock([
    ...new Set([...intelligence.envContract.test, ...intelligence.envContract.runtime]),
  ]);

  const steps: string[] = [];
  if (pkg.hasLint) {
    steps.push(`      - name: Lint\n        run: npm run lint`);
  }
  if (pkg.hasTest) {
    steps.push(`      - name: Test\n        run: npm run test`);
  }
  if (pkg.hasBuild) {
    steps.push(`      - name: Build\n        run: npm run build`);
    if (pkg.kind === "frontend") {
      steps.push(`      - name: Verify build output\n        run: test -d dist || test -d build`);
    }
  }

  const envForJob =
    pkg.kind === "frontend" && intelligence.envContract.build.length
      ? buildEnv
      : pkg.kind === "backend"
        ? testEnv
        : "";

  return `  pkg-${jobId}:
    name: "${pkg.name} (${pkg.kind})"
    runs-on: ubuntu-latest
    timeout-minutes: 25
${envForJob}    defaults:
      run:
        working-directory: ${pkg.dir === "." ? "." : pkg.dir}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "${profile.nodeVersion}"
          cache: 'npm'${cachePath}

      - name: Install dependencies (workspace root)
        if: ${pkg.dir !== "." ? "true" : "false"}
        working-directory: .
        run: npm ci || npm install

      - name: Install dependencies
        run: npm ci || npm install

      - name: Audit dependencies
        run: npm audit --audit-level=critical
        continue-on-error: false

${steps.join("\n\n")}
`;
}

function buildMonorepoCiWorkflow(
  profile: ProjectCiProfile,
  packages: WorkspacePackage[],
  intelligence: ProjectIntelligence,
): string {
  const pkgJobs = packages.map((p) => monorepoPackageJob(profile, p, intelligence)).join("\n");

  return `name: CI

on:
  push:
    branches: [main, master, develop]
  pull_request:

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
${pkgJobs}
${secretScanJob()}
`;
}
