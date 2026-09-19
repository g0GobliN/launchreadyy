export type Severity = "critical" | "high" | "medium" | "low";
export type FixRequestStatus =
  | "pending"
  | "running"
  | "awaiting_review"
  | "pr_open"
  | "completed"
  | "failed"
  | "cancelled";

export interface FixRequest {
  id: string;
  repoId: string;
  scanId: string;
  fixes: string[];
  status: FixRequestStatus;
  branchName: string;
  prNumber: number | null;
  prUrl: string | null;
  errorMessage: string | null;
  estFilesAdded: number;
  estFilesChanged: number;
  estDeps: number;
  effortScore: number;
  createdAt: string;
}

export interface Issue {
  id: string;
  category: string;
  title: string;
  severity: Severity;
  why: string;
  timeSaved: string;
  fixId: string;
  riskLevel?: "blocker" | "high" | "medium" | "low";
  businessImpact?: string;
  productionScenario?: string;
  affectedAudience?: "users" | "customers" | "team" | "business";
  fixDifficulty?: "trivial" | "easy" | "medium" | "hard";
  priority?: number;
  autoFixable?: boolean;
  source?: "rule" | "auditor" | "arch" | "sandbox";
  readinessCategory?: string;
  fixPackId?: string;
  checkedFor?: string[];
  foundEvidence?: string;
  confidence?: "high" | "medium" | "low";
  recommendedFix?: string;
  aiEffort?: number;
  detection?: Array<"rule-based" | "framework-aware" | "ai-assisted" | "sandbox-verified">;
  /** When a sandbox-verified finding was actually confirmed — powers "Verified X ago" copy. */
  verifiedAt?: string;
}

export type LaunchTarget = "mvp" | "startup" | "enterprise" | "oss" | "product_hunt" | "investors";
export type LaunchTimeline = "today" | "this_week" | "this_month" | "exploring";

export type RiskReasonType = "temporary" | "wont_fix" | "false_positive" | "not_applicable";

export interface RiskAcceptance {
  id: string;
  repoId: string;
  fixId: string;
  userId: string;
  reasonType: RiskReasonType;
  note?: string;
  acceptedAt: string;
}

export interface CategoryScore {
  category: string;
  score: number;
  issueCount: number;
  blockerCount: number;
}

export interface LaunchChecklistItem {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn" | "na";
  findingId?: string;
  stackSpecific: boolean;
}

export interface DetectedStack {
  frameworks: string[];
  services: string[];
  deployTargets: string[];
  profile: string;
}

export interface Repo {
  id: string;
  name: string;
  full_name: string;
  description: string;
  language: string;
  stars: number;
  updated: string;
  private: boolean;
  framework:
    | "Next.js"
    | "React Vite"
    | "Vite"
    | "React"
    | "Express"
    | "Python"
    | "Ruby"
    | "Go"
    | "Java"
    | "PHP"
    | "Rust"
    | "unknown";
}

export interface Scan {
  id: string;
  repoId: string;
  score: number;
  /** Human phrasing, e.g. "about 1 hour ago". */
  createdAt: string;
  /** Raw ISO timestamp — needed to compare the scan against its sandbox verification. */
  createdAtIso?: string;
  issues: Issue[];
  warnings: string[];
  categoryScores?: CategoryScore[];
  checklist?: LaunchChecklistItem[];
  stackDetected?: DetectedStack;
  launchTarget?: LaunchTarget | null;
  launchTimeline?: LaunchTimeline | null;
  /** Latest sandbox_verify_runs row linked to this scan, if any — powers the static-only banner. */
  sandboxVerify?: {
    status: "queued" | "running" | "passed" | "failed" | "skipped";
    finishedAt: string | null;
  } | null;
}

export const MOCK_REPOS: Repo[] = [
  {
    id: "r1",
    name: "nextjs-payments-app",
    full_name: "demo/nextjs-payments-app",
    description: "Next.js payments app — auth, checkout, dashboard",
    language: "TypeScript",
    stars: 42,
    updated: "2 hours ago",
    private: false,
    framework: "Next.js",
  },
  {
    id: "r2",
    name: "react-vite-dashboard",
    full_name: "demo/react-vite-dashboard",
    description: "React Vite Dashboard — analytics & charts",
    language: "TypeScript",
    stars: 18,
    updated: "yesterday",
    private: true,
    framework: "React Vite",
  },
  {
    id: "r3",
    name: "express-api-server",
    full_name: "demo/express-api-server",
    description: "Express API Server — REST endpoints + Postgres",
    language: "JavaScript",
    stars: 7,
    updated: "3 days ago",
    private: true,
    framework: "Express",
  },
  {
    id: "r4",
    name: "go-rest-api",
    full_name: "demo/go-rest-api",
    description: "Go REST API — Gin + Postgres + JWT auth",
    language: "Go",
    stars: 23,
    updated: "1 day ago",
    private: false,
    framework: "Go",
  },
  {
    id: "r5",
    name: "fastapi-backend",
    full_name: "demo/fastapi-backend",
    description: "FastAPI backend — async Python + SQLAlchemy",
    language: "Python",
    stars: 11,
    updated: "5 days ago",
    private: true,
    framework: "Python",
  },
];

const COMMON_ISSUES = (framework: Repo["framework"]): Issue[] => [
  {
    id: "i-vitest",
    fixId: "vitest",
    category: "Testing",
    title: "No unit test framework configured",
    severity: "high",
    why: "Without tests, regressions slip into production. Vitest gives instant feedback.",
    timeSaved: "3h",
  },
  {
    id: "i-playwright",
    fixId: "playwright",
    category: "Testing",
    title: "Missing end-to-end tests",
    severity: "medium",
    why: "E2E tests catch broken user flows before users do.",
    timeSaved: "4h",
  },
  {
    id: "i-ci",
    fixId: "github-actions",
    category: "CI/CD",
    title: "No GitHub Actions workflow",
    severity: "critical",
    why: "Every push should run lint, typecheck, and tests automatically.",
    timeSaved: "2h",
  },
  {
    id: "i-eslint",
    fixId: "eslint",
    category: "Code Quality",
    title: "ESLint not configured",
    severity: "high",
    why: "Catches bugs and enforces consistent style across contributors.",
    timeSaved: "1h",
  },
  {
    id: "i-prettier",
    fixId: "prettier",
    category: "Code Quality",
    title: "Prettier not configured",
    severity: "low",
    why: "Removes formatting debates and makes diffs clean.",
    timeSaved: "30m",
  },
  {
    id: "i-env",
    fixId: "env-example",
    category: "Security",
    title: "Missing .env.example",
    severity: "high",
    why: "Contributors can't run your app without knowing required env vars.",
    timeSaved: "1h",
  },
  {
    id: "i-docker",
    fixId: "dockerfile",
    category: "Deployment",
    title: framework === "Express" ? "No Dockerfile for backend" : "No Dockerfile",
    severity: "medium",
    why: "Reproducible builds for any deployment target.",
    timeSaved: "2h",
  },
  {
    id: "i-readme",
    fixId: "readme-ai",
    category: "Documentation",
    title: "Missing setup instructions",
    severity: "medium",
    why: "Onboarding new devs (or your future self) takes hours without it.",
    timeSaved: "1h",
  },
  {
    id: "i-monitor",
    fixId: "monitoring",
    category: "Monitoring",
    title: "No error monitoring (Sentry)",
    severity: "high",
    why: "You won't know production crashes happened until users complain.",
    timeSaved: "2h",
  },
];

const GO_ISSUES: Issue[] = [
  {
    id: "g-ci",
    fixId: "github-actions",
    category: "CI/CD",
    title: "No GitHub Actions CI workflow",
    severity: "critical",
    why: "Every push to main is untested. A single bad merge can break production silently.",
    timeSaved: "2h",
    checkedFor: [".github/workflows", "CircleCI", "GitLab CI"],
  },
  {
    id: "g-test",
    fixId: "go-test-ai",
    category: "Testing",
    title: "No Go tests found",
    severity: "high",
    why: "Without tests, regressions go undetected. Go's built-in testing package is the standard.",
    timeSaved: "2h",
    checkedFor: ["*_test.go"],
    businessImpact: "Handler regressions ship because CI only runs vet, not real tests.",
  },
  {
    id: "g-lint",
    fixId: "golangci-lint",
    category: "Code Quality",
    title: "No golangci-lint config",
    severity: "medium",
    why: "golangci-lint runs errcheck, staticcheck, and govet — catches bugs go vet alone misses.",
    timeSaved: "1h",
    checkedFor: [".golangci.yml", ".golangci.yaml"],
  },
  {
    id: "g-env",
    fixId: "env-example",
    category: "Security",
    title: "Missing .env.example",
    severity: "high",
    why: "Without a documented env contract, onboarding and incident response slow down immediately.",
    timeSaved: "30m",
    checkedFor: [".env.example", ".env.sample"],
  },
  {
    id: "g-docker",
    fixId: "dockerfile",
    category: "Deployment",
    title: "No Dockerfile or docker-compose",
    severity: "medium",
    why: "A Dockerfile makes builds reproducible across local, CI, and production hosts.",
    timeSaved: "2h",
    checkedFor: ["Dockerfile", "docker-compose.yml"],
  },
  {
    id: "g-monitor",
    fixId: "monitoring",
    category: "Monitoring",
    title: "No error monitoring",
    severity: "high",
    why: "Without monitoring, production errors are invisible.",
    timeSaved: "2h",
    checkedFor: ["Sentry", "Datadog", "OpenTelemetry", "sentry-go in go.mod"],
  },
];

const PYTHON_ISSUES: Issue[] = [
  {
    id: "p-ci",
    fixId: "ci-ai",
    category: "CI/CD",
    title: "No CI workflow (AI-tailored fix available)",
    severity: "critical",
    why: "Every push should run lint, typecheck, and tests. AI generates a workflow tailored to your framework and scripts.",
    timeSaved: "2h",
    checkedFor: [".github/workflows", "CircleCI", "GitLab CI"],
  },
  {
    id: "p-test",
    fixId: "pytest-ai",
    category: "Testing",
    title: "No pytest tests found",
    severity: "high",
    why: "Without tests, regressions go undetected and CI can't verify correctness.",
    timeSaved: "2h",
    checkedFor: ["tests/test_*.py", "test_*.py", "pytest in requirements"],
    businessImpact: "FastAPI route changes break silently with no automated coverage.",
  },
  {
    id: "p-lint",
    fixId: "ruff",
    category: "Code Quality",
    title: "No Python linter configured",
    severity: "medium",
    why: "Ruff catches unused imports, undefined names, and style issues in milliseconds.",
    timeSaved: "1h",
    checkedFor: ["ruff.toml", ".flake8", "setup.cfg", "ruff in requirements"],
  },
  {
    id: "p-env",
    fixId: "env-example-ai",
    category: "Security",
    title: "Missing .env.example (AI-scanned fix available)",
    severity: "high",
    why: "AI scans your codebase for env vars and writes a documented .env.example with descriptions.",
    timeSaved: "30m",
    checkedFor: [".env.example", ".env.sample"],
  },
  {
    id: "p-cors",
    fixId: "cors",
    category: "Security",
    title: "No CORS configuration",
    severity: "medium",
    why: "Browser clients need explicit CORS rules. Without them, frontends on another origin cannot call your API.",
    timeSaved: "20m",
    checkedFor: ["CORSMiddleware", "flask-cors", "Access-Control-Allow-Origin"],
  },
  {
    id: "p-monitor",
    fixId: "monitoring",
    category: "Monitoring",
    title: "No error monitoring",
    severity: "high",
    why: "Without monitoring, production errors are invisible.",
    timeSaved: "2h",
    checkedFor: ["Sentry", "Datadog", "sentry-sdk in requirements"],
  },
];

export const MOCK_SCANS: Record<string, Scan> = Object.fromEntries(
  MOCK_REPOS.map((r) => {
    const issues =
      r.framework === "Go"
        ? GO_ISSUES
        : r.framework === "Python"
          ? PYTHON_ISSUES
          : COMMON_ISSUES(r.framework);
    // score: 100 minus weighted issues
    const weights: Record<Severity, number> = { critical: 12, high: 7, medium: 4, low: 2 };
    const score = Math.max(20, 100 - issues.reduce((s, i) => s + weights[i.severity], 0));
    return [
      r.id,
      { id: `s-${r.id}`, repoId: r.id, score, createdAt: "just now", issues, warnings: [] },
    ];
  }),
);

export const RECENT_SCANS = [
  { repo: "demo/nextjs-payments-app", score: 62, when: "2h ago" },
  { repo: "demo/react-vite-dashboard", score: 48, when: "yesterday" },
  { repo: "demo/express-api-server", score: 55, when: "3 days ago" },
];

export type DiffLine = {
  type: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
};
export type FileDiff = {
  path: string;
  status: "added" | "modified";
  lines: DiffLine[];
  validation?: import("./fix-validation").FileValidationResult;
};

export interface FixPreview {
  files_added: string[];
  files_changed: string[];
  deps: string[];
  diffs: FileDiff[];
  effortScore?: number; // 0 for template fixes; AI fixes will set a positive value
  isAi?: boolean; // true = content generated by AI at job time, diffs are illustrative
  ai_output_file?: string; // the single file AI writes at job time (other files_added are templates)
}

const add = (text: string, newNo: number): DiffLine => ({ type: "add", text, newNo });
const ctx = (text: string, oldNo: number, newNo: number): DiffLine => ({
  type: "ctx",
  text,
  oldNo,
  newNo,
});
const del = (text: string, oldNo: number): DiffLine => ({ type: "del", text, oldNo });
const hunk = (text: string): DiffLine => ({ type: "hunk", text });

export const FIX_DETAILS: Record<string, FixPreview & { label: string }> = {
  // The three hardening fixes below edit files the repository already has, so which files change
  // is only known at job time. These diffs are representative of the edit, in the same way the
  // ts-strict preview is — the real change is shown in the pull request.
  "workflow-permissions": {
    label: "Restrict the GitHub Actions token",
    files_added: [],
    files_changed: [".github/workflows/*.yml"],
    deps: [],
    diffs: [
      {
        path: ".github/workflows/ci.yml",
        status: "modified",
        lines: [
          hunk("@@ -1,6 +1,9 @@"),
          ctx("name: CI", 1, 1),
          ctx("", 2, 2),
          ctx("on:", 3, 3),
          ctx("  push:", 4, 4),
          ctx("", 5, 5),
          add("permissions:", 6),
          add("  contents: read", 7),
          add("", 8),
          ctx("jobs:", 6, 9),
        ],
      },
    ],
  },
  "workflow-unpinned-action": {
    label: "Pin third-party Actions to a commit",
    files_added: [],
    files_changed: [".github/workflows/*.yml"],
    deps: [],
    diffs: [
      {
        path: ".github/workflows/ci.yml",
        status: "modified",
        lines: [
          hunk("@@ -8,7 +8,7 @@"),
          ctx("    steps:", 8, 8),
          ctx("      - uses: actions/checkout@v4", 9, 9),
          del("      - uses: docker/build-push-action@v5", 10),
          add(
            "      - uses: docker/build-push-action@263435318d21b8e681c14492fe198d362a7d2c83  # v5",
            10,
          ),
          ctx("", 11, 11),
        ],
      },
    ],
  },
  "docker-root-user": {
    label: "Run the container as a non-root user",
    files_added: [],
    files_changed: ["Dockerfile"],
    deps: [],
    diffs: [
      {
        path: "Dockerfile",
        status: "modified",
        lines: [
          hunk("@@ -4,4 +4,8 @@"),
          ctx("WORKDIR /app", 4, 4),
          ctx("COPY . .", 5, 5),
          ctx("", 6, 6),
          add("RUN groupadd --system app && useradd --system --gid app --no-create-home app \\", 7),
          add(" && chown -R app:app /app", 8),
          add("USER app", 9),
          add("", 10),
          ctx('CMD ["python", "main.py"]', 7, 11),
        ],
      },
    ],
  },
  vitest: {
    label: "Add Vitest test scaffold",
    files_added: ["vitest.config.ts", "tests/smoke.test.ts"],
    files_changed: ["package.json"],
    deps: ["vitest", "@vitejs/plugin-react", "vite-tsconfig-paths"],
    diffs: [
      {
        path: "vitest.config.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,14 @@"),
          add(`import { defineConfig } from "vitest/config";`, 1),
          add(`import react from "@vitejs/plugin-react";`, 2),
          add(`import tsconfigPaths from "vite-tsconfig-paths";`, 3),
          add(``, 4),
          add(`export default defineConfig({`, 5),
          add(`  plugins: [react(), tsconfigPaths()],`, 6),
          add(`  test: {`, 7),
          add(`    environment: "jsdom",`, 8),
          add(`    coverage: {`, 9),
          add(`      provider: "v8",`, 10),
          add(`      reporter: ["text", "lcov"],`, 11),
          add(`      exclude: ["node_modules", "dist", "e2e", "**/*.config.*", "**/*.d.ts"],`, 12),
          add(`    },`, 13),
          add(`  },`, 14),
          add(`});`, 15),
        ],
      },
      {
        path: "tests/smoke.test.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,7 @@"),
          add(`import { describe, it, expect } from "vitest";`, 1),
          add(``, 2),
          add(`describe("smoke", () => {`, 3),
          add(`  it("runs without error", () => {`, 4),
          add(`    expect(true).toBe(true);`, 5),
          add(`  });`, 6),
          add(`});`, 7),
        ],
      },
      {
        path: "package.json",
        status: "modified",
        lines: [
          hunk("@@ -8,4 +8,7 @@"),
          ctx(`  "scripts": {`, 8, 8),
          ctx(`    "dev": "vite",`, 9, 9),
          ctx(`    "build": "vite build",`, 10, 10),
          add(`    "test": "vitest",`, 11),
          add(`    "test:ui": "vitest --ui",`, 12),
          add(`    "test:coverage": "vitest run --coverage",`, 13),
          ctx(`  },`, 11, 14),
        ],
      },
    ],
  },
  playwright: {
    label: "Add Playwright",
    files_added: ["playwright.config.ts", "e2e/home.spec.ts"],
    files_changed: ["package.json", ".gitignore"],
    deps: ["@playwright/test"],
    diffs: [
      {
        path: "e2e/home.spec.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,6 @@"),
          add(`import { test, expect } from "@playwright/test";`, 1),
          add(``, 2),
          add(`test("home loads", async ({ page }) => {`, 3),
          add(`  await page.goto("/");`, 4),
          add(`  await expect(page).toHaveTitle(/./);`, 5),
          add(`});`, 6),
        ],
      },
      {
        path: ".gitignore",
        status: "modified",
        lines: [
          hunk("@@ -10,2 +10,5 @@"),
          ctx(`node_modules`, 10, 10),
          ctx(`dist`, 11, 11),
          add(`/test-results/`, 12),
          add(`/playwright-report/`, 13),
          add(`/playwright/.cache/`, 14),
        ],
      },
    ],
  },
  "github-actions": {
    label: "Add GitHub Actions CI",
    files_added: [".github/workflows/ci.yml"],
    files_changed: [],
    deps: [],
    diffs: [
      {
        path: ".github/workflows/ci.yml",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,62 @@"),
          add(`name: CI`, 1),
          add(``, 2),
          add(`on:`, 3),
          add(`  push:`, 4),
          add(`  pull_request:`, 5),
          add(``, 6),
          add(`jobs:`, 7),
          add(`  ci:`, 8),
          add(`    runs-on: ubuntu-latest`, 9),
          add(`    steps:`, 10),
          add(`      - uses: actions/checkout@v4`, 11),
          add(``, 12),
          add(`      - name: Detect package manager`, 13),
          add(`        id: pm`, 14),
          add(`        run: |`, 15),
          add(`          if [ -f pnpm-lock.yaml ]; then`, 16),
          add(`            echo "name=pnpm"                              >> $GITHUB_OUTPUT`, 17),
          add(`            echo "install=pnpm install --frozen-lockfile" >> $GITHUB_OUTPUT`, 18),
          add(`            echo "run=pnpm run"                           >> $GITHUB_OUTPUT`, 19),
          add(`          elif [ -f yarn.lock ]; then`, 20),
          add(`            echo "name=yarn"                              >> $GITHUB_OUTPUT`, 21),
          add(`            echo "install=yarn install --frozen-lockfile" >> $GITHUB_OUTPUT`, 22),
          add(`            echo "run=yarn"                               >> $GITHUB_OUTPUT`, 23),
          add(`          else`, 24),
          add(`            echo "name=npm"                               >> $GITHUB_OUTPUT`, 25),
          add(`            echo "install=npm ci"                         >> $GITHUB_OUTPUT`, 26),
          add(`            echo "run=npm run"                            >> $GITHUB_OUTPUT`, 27),
          add(`          fi`, 28),
          add(``, 29),
          add(`      - name: Setup pnpm`, 30),
          add(`        if: steps.pm.outputs.name == 'pnpm'`, 31),
          add(`        uses: pnpm/action-setup@v4`, 32),
          add(`        with:`, 33),
          add(`          run_install: false`, 34),
          add(``, 35),
          add(`      - uses: actions/setup-node@v4`, 36),
          add(`        with:`, 37),
          add(`          node-version: 20`, 38),
          add(`          cache: \${{ steps.pm.outputs.name }}`, 39),
          add(``, 40),
          add(`      - name: Install dependencies`, 41),
          add(`        run: \${{ steps.pm.outputs.install }}`, 42),
          add(``, 43),
          add(`      - name: Check scripts`, 44),
          add(`        id: scripts`, 45),
          add(`        run: |`, 46),
          add(
            `          has() { node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)"; }`,
            47,
          ),
          add(
            `          has lint  && echo "lint=true"  >> $GITHUB_OUTPUT || echo "lint=false"  >> $GITHUB_OUTPUT`,
            48,
          ),
          add(
            `          has test  && echo "test=true"  >> $GITHUB_OUTPUT || echo "test=false"  >> $GITHUB_OUTPUT`,
            49,
          ),
          add(
            `          has build && echo "build=true" >> $GITHUB_OUTPUT || echo "build=false" >> $GITHUB_OUTPUT`,
            50,
          ),
          add(``, 51),
          add(`      - name: Lint`, 52),
          add(`        if: steps.scripts.outputs.lint == 'true'`, 53),
          add(`        run: \${{ steps.pm.outputs.run }} lint`, 54),
          add(``, 55),
          add(`      - name: Test`, 56),
          add(`        if: steps.scripts.outputs.test == 'true'`, 57),
          add(`        run: \${{ steps.pm.outputs.run }} test`, 58),
          add(``, 59),
          add(`      - name: Build`, 60),
          add(`        if: steps.scripts.outputs.build == 'true'`, 61),
          add(`        run: \${{ steps.pm.outputs.run }} build`, 62),
        ],
      },
    ],
  },
  eslint: {
    label: "Add ESLint config",
    files_added: ["eslint.config.js"],
    files_changed: ["package.json"],
    deps: ["eslint", "@typescript-eslint/parser", "@typescript-eslint/eslint-plugin"],
    diffs: [
      {
        path: "eslint.config.js",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,8 @@"),
          add(`import tseslint from "@typescript-eslint/eslint-plugin";`, 1),
          add(`import parser from "@typescript-eslint/parser";`, 2),
          add(``, 3),
          add(`export default [{`, 4),
          add(`  files: ["**/*.{ts,tsx}"],`, 5),
          add(`  languageOptions: { parser },`, 6),
          add(`  plugins: { "@typescript-eslint": tseslint },`, 7),
          add(`}];`, 8),
        ],
      },
    ],
  },
  prettier: {
    label: "Add Prettier",
    files_added: [".prettierrc", ".prettierignore"],
    files_changed: ["package.json"],
    deps: ["prettier"],
    diffs: [
      {
        path: ".prettierrc",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,6 @@"),
          add(`{`, 1),
          add(`  "semi": true,`, 2),
          add(`  "singleQuote": false,`, 3),
          add(`  "trailingComma": "all",`, 4),
          add(`  "printWidth": 100`, 5),
          add(`}`, 6),
        ],
      },
    ],
  },
  dockerfile: {
    label: "Add Dockerfile",
    files_added: ["Dockerfile", ".dockerignore", "nginx.conf"],
    files_changed: [],
    deps: [],
    diffs: [
      {
        path: "Dockerfile",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,13 @@"),
          add(`FROM node:20-alpine AS build`, 1),
          add(`WORKDIR /app`, 2),
          add(`COPY package*.json ./`, 3),
          add(`RUN npm ci`, 4),
          add(`COPY . .`, 5),
          add(`RUN npm run build`, 6),
          add(``, 7),
          add(`FROM nginx:alpine`, 8),
          add(`COPY --from=build /app/dist /usr/share/nginx/html`, 9),
          add(`COPY nginx.conf /etc/nginx/conf.d/default.conf`, 10),
          add(`EXPOSE 80`, 11),
          add(
            `HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ || exit 1`,
            12,
          ),
          add(`CMD ["nginx", "-g", "daemon off;"]`, 13),
        ],
      },
      {
        path: "nginx.conf",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,24 @@"),
          add(`server {`, 1),
          add(`  listen 80;`, 2),
          add(`  root /usr/share/nginx/html;`, 3),
          add(`  index index.html;`, 4),
          add(``, 5),
          add(`  add_header X-Frame-Options "SAMEORIGIN";`, 6),
          add(`  add_header X-Content-Type-Options "nosniff";`, 7),
          add(`  add_header Referrer-Policy "strict-origin-when-cross-origin";`, 8),
          add(`  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()";`, 9),
          add(``, 10),
          add(`  gzip on;`, 11),
          add(
            `  gzip_types text/plain text/css application/javascript application/json image/svg+xml;`,
            12,
          ),
          add(``, 13),
          add(`  location ~* \\.(js|css|png|jpg|svg|ico|woff2)$ {`, 14),
          add(`    expires 1y;`, 15),
          add(`    add_header Cache-Control "public, immutable";`, 16),
          add(`  }`, 17),
          add(``, 18),
          add(`  location / {`, 19),
          add(`    try_files $uri $uri/ /index.html;`, 20),
          add(`  }`, 21),
          add(`}`, 22),
        ],
      },
    ],
  },
  "env-example": {
    label: "Add .env.example",
    files_added: [".env.example"],
    files_changed: ["README.md"],
    deps: [],
    diffs: [
      {
        path: ".env.example",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,5 @@"),
          add(`# Copy to .env and fill in`, 1),
          add(`DATABASE_URL=`, 2),
          add(`NEXTAUTH_SECRET=`, 3),
          add(`STRIPE_SECRET_KEY=`, 4),
          add(`SENTRY_DSN=`, 5),
        ],
      },
      {
        path: "README.md",
        status: "modified",
        lines: [
          hunk("@@ -1,1 +1,7 @@"),
          ctx(`# project-name`, 1, 1),
          add(``, 2),
          add(`## Environment variables`, 3),
          add(``, 4),
          add(`Copy \`.env.example\` to \`.env\` and fill in the required values:`, 5),
          add(``, 6),
          add(`\`\`\`bash`, 7),
          add(`cp .env.example .env`, 8),
          add(`\`\`\``, 9),
        ],
      },
    ],
  },
  "gitignore-env": {
    label: "Stop committing secrets (.gitignore)",
    files_added: [],
    files_changed: [".gitignore"],
    deps: [],
    diffs: [
      {
        path: ".gitignore",
        status: "modified",
        lines: [
          hunk("@@ -1,3 +1,6 @@"),
          ctx(`node_modules/`, 1, 1),
          ctx(`dist/`, 2, 2),
          add(`.env`, 3),
          add(`.env.local`, 4),
          add(`.env.*.local`, 5),
        ],
      },
    ],
  },
  readme: {
    label: "Add setup instructions",
    files_added: [],
    files_changed: ["README.md"],
    deps: [],
    diffs: [
      {
        path: "README.md",
        status: "modified",
        lines: [
          hunk("@@ -1,1 +1,46 @@"),
          ctx(`# project-name`, 1, 1),
          add(``, 2),
          add(`## Getting started`, 3),
          add(``, 4),
          add(`**1. Clone and install**`, 5),
          add(``, 6),
          add(`\`\`\`bash`, 7),
          add(`git clone https://github.com/<you>/project-name.git`, 8),
          add(`cd project-name`, 9),
          add(`npm install`, 10),
          add(`\`\`\``, 11),
          add(``, 12),
          add(`**2. Configure environment**`, 13),
          add(``, 14),
          add(`\`\`\`bash`, 15),
          add(`cp .env.example .env`, 16),
          add(`\`\`\``, 17),
          add(``, 18),
          add(`Fill in \`.env\` with required variables. See \`.env.example\` for details.`, 19),
          add(``, 20),
          add(`**3. Run in development**`, 21),
          add(``, 22),
          add(`\`\`\`bash`, 23),
          add(`npm run dev`, 24),
          add(`\`\`\``, 25),
          add(``, 26),
          add(`## Build`, 27),
          add(``, 28),
          add(`\`\`\`bash`, 29),
          add(`npm run build`, 30),
          add(`npm start`, 31),
          add(`\`\`\``, 32),
          add(``, 33),
          add(`## Test`, 34),
          add(``, 35),
          add(`\`\`\`bash`, 36),
          add(`npm test`, 37),
          add(`\`\`\``, 38),
          add(``, 39),
          add(`## Deployment`, 40),
          add(``, 41),
          add(`Set the environment variables from \`.env.example\` on your host,`, 42),
          add(`then run the build and start commands above.`, 43),
        ],
      },
    ],
  },
  "error-boundary": {
    label: "Add error boundary (error.tsx)",
    files_added: ["app/error.tsx"],
    files_changed: [],
    deps: [],
    diffs: [
      {
        path: "app/error.tsx",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,24 @@"),
          add(`'use client'`, 1),
          add(``, 2),
          add(`import { useEffect } from "react"`, 3),
          add(``, 4),
          add(`export default function Error({ error, reset }) {`, 5),
          add(`  useEffect(() => { console.error(error) }, [error])`, 6),
          add(`  return (`, 7),
          add(`    <div>`, 8),
          add(`      <h2>Something went wrong</h2>`, 9),
          add(`      <button type="button" onClick={() => reset()}>Try again</button>`, 10),
          add(`    </div>`, 11),
          add(`  )`, 12),
          add(`}`, 13),
        ],
      },
    ],
  },
  monitoring: {
    label: "Add error monitoring (Sentry — requires DSN)",
    files_added: ["src/lib/sentry.ts", "src/lib/sentry-error-boundary.tsx"],
    files_changed: ["src/main.tsx", "package.json"],
    deps: ["@sentry/react"],
    diffs: [
      {
        path: "src/lib/sentry.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,8 @@"),
          add(`import * as Sentry from "@sentry/react";`, 1),
          add(``, 2),
          add(`Sentry.init({`, 3),
          add(`  dsn: import.meta.env.VITE_SENTRY_DSN,`, 4),
          add(`  environment: import.meta.env.MODE,`, 5),
          add(`  release: import.meta.env.VITE_APP_VERSION,`, 6),
          add(`  tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,`, 7),
          add(`});`, 8),
        ],
      },
      {
        path: "src/lib/sentry-error-boundary.tsx",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,27 @@"),
          add(`import * as Sentry from "@sentry/react";`, 1),
          add(`import type { ReactNode } from "react";`, 2),
          add(``, 3),
          add(`export function SentryErrorBoundary({ children }: { children: ReactNode }) {`, 4),
          add(`  return (`, 5),
          add(`    <Sentry.ErrorBoundary`, 6),
          add(`      fallback={({ error, resetError }) => (`, 7),
          add(`        <div className="flex min-h-screen items-center justify-center">`, 8),
          add(`          <div className="text-center">`, 9),
          add(`            <h2 className="text-lg font-semibold">Something went wrong</h2>`, 10),
          add(`            <button onClick={resetError}>Try again</button>`, 11),
          add(`          </div>`, 12),
          add(`        </div>`, 13),
          add(`      )}`, 14),
          add(`    >`, 15),
          add(`      {children}`, 16),
          add(`    </Sentry.ErrorBoundary>`, 17),
          add(`  );`, 18),
          add(`}`, 19),
        ],
      },
      {
        path: "src/main.tsx",
        status: "modified",
        lines: [
          hunk("@@ -1,3 +1,4 @@"),
          ctx(`import React from "react";`, 1, 1),
          ctx(`import ReactDOM from "react-dom/client";`, 2, 2),
          add(`import "./lib/sentry";`, 3),
          ctx(`import App from "./App";`, 3, 4),
        ],
      },
    ],
  },
  helmet: {
    label: "Add Helmet (security headers)",
    files_added: ["src/middleware/security.ts"],
    files_changed: ["src/index.ts"],
    deps: ["helmet"],
    diffs: [
      {
        path: "src/middleware/security.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,6 @@"),
          add(`import helmet from "helmet";`, 1),
          add(`import type { Express } from "express";`, 2),
          add(``, 3),
          add(`export function applyHelmet(app: Express): void {`, 4),
          add(`  app.use(helmet());`, 5),
          add(`}`, 6),
        ],
      },
      {
        path: "src/index.ts",
        status: "modified",
        lines: [
          hunk("@@ -1,3 +1,5 @@"),
          ctx(`import express from "express";`, 1, 1),
          add(`import { applyHelmet } from "./middleware/security";`, 2),
          ctx(``, 2, 3),
          ctx(`const app = express();`, 3, 4),
          add(`applyHelmet(app);`, 5),
        ],
      },
    ],
  },
  "rate-limit": {
    label: "Add rate limiting",
    files_added: ["src/middleware/rate-limit.ts"],
    files_changed: ["src/index.ts"],
    deps: ["express-rate-limit"],
    diffs: [
      {
        path: "src/middleware/rate-limit.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,20 @@"),
          add(`import rateLimit from "express-rate-limit";`, 1),
          add(`import type { Express } from "express";`, 2),
          add(``, 3),
          add(`// Adjust max/windowMs per route type:`, 4),
          add(`//   Auth routes → max: 10, windowMs: 15 * 60 * 1000`, 5),
          add(`//   Public API → max: 200, windowMs: 60 * 1000`, 6),
          add(`//   Webhooks   → skip rate limit entirely`, 7),
          add(`const defaultLimiter = rateLimit({`, 8),
          add(`  windowMs: 15 * 60 * 1000,`, 9),
          add(`  max: 100,`, 10),
          add(`  standardHeaders: true,`, 11),
          add(`  legacyHeaders: false,`, 12),
          add(`  message: { error: "Too many requests, please try again later." },`, 13),
          add(`});`, 14),
          add(``, 15),
          add(
            `export const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });`,
            16,
          ),
          add(``, 17),
          add(`export function applyRateLimit(app: Express): void {`, 18),
          add(`  app.use(defaultLimiter);`, 19),
          add(`}`, 20),
        ],
      },
      {
        path: "src/index.ts",
        status: "modified",
        lines: [
          hunk("@@ -1,3 +1,5 @@"),
          ctx(`import express from "express";`, 1, 1),
          add(`import { applyRateLimit } from "./middleware/rate-limit";`, 2),
          ctx(``, 2, 3),
          ctx(`const app = express();`, 3, 4),
          add(`applyRateLimit(app);`, 5),
        ],
      },
    ],
  },
  "ci-ai": {
    label: "GitHub Actions CI — AI-tailored",
    files_added: [".github/workflows/ci.yml"],
    files_changed: ["package.json"],
    deps: [],
    effortScore: 2,
    isAi: true,
    ai_output_file: ".github/workflows/ci.yml",
    diffs: [
      {
        path: ".github/workflows/ci.yml",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,5 @@"),
          add(`# AI-generated — tailored to your framework, package manager, and scripts`, 1),
          add(`# Detects pnpm/yarn/npm from lockfiles`, 2),
          add(`# Runs lint, test, build only when scripts exist`, 3),
          add(`# Full workflow generated when you confirm the PR`, 4),
          add(`name: CI`, 5),
        ],
      },
    ],
  },
  "readme-ai": {
    label: "Setup docs — AI-written",
    files_added: [],
    files_changed: ["README.md"],
    deps: [],
    effortScore: 2,
    isAi: true,
    ai_output_file: "README.md",
    diffs: [
      {
        path: "README.md",
        status: "modified",
        lines: [
          hunk("@@ -0,0 +1,5 @@"),
          add(`# AI-generated setup section`, 1),
          add(`# Uses your repo name, framework, and npm scripts`, 2),
          add(`# Includes install, dev, and test commands`, 3),
          add(`# Full README generated when you confirm the PR`, 4),
          add(`## Getting Started`, 5),
        ],
      },
    ],
  },
  "env-example-ai": {
    label: ".env.example — AI-scanned",
    files_added: [".env.example"],
    files_changed: [],
    deps: [],
    effortScore: 1,
    isAi: true,
    ai_output_file: ".env.example",
    diffs: [
      {
        path: ".env.example",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,5 @@"),
          add(`# AI-scanned from process.env.* and import.meta.env.* in your codebase`, 1),
          add(`# Each variable includes a description comment`, 2),
          add(`# Placeholder values only — no real secrets`, 3),
          add(`# Full file generated when you confirm the PR`, 4),
          add(`DATABASE_URL=postgres://localhost:5432/mydb`, 5),
        ],
      },
    ],
  },
  "vitest-ai": {
    label: "Vitest — AI-generated tests",
    files_added: ["vitest.config.ts", "tests/unit.test.ts"],
    files_changed: ["package.json"],
    deps: ["vitest", "@vitejs/plugin-react", "vite-tsconfig-paths"],
    effortScore: 3,
    isAi: true,
    ai_output_file: "tests/unit.test.ts",
    diffs: [
      {
        path: "tests/unit.test.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,6 @@"),
          add(`// AI-generated — content depends on your actual repo`, 1),
          add(`// Typical output includes:`, 2),
          add(`//   • describe/it blocks for your real components and utilities`, 3),
          add(`//   • render() + screen.getBy*() assertions`, 4),
          add(`//   • edge case and error state coverage`, 5),
          add(`//   • Full file generated when you confirm the PR`, 6),
        ],
      },
    ],
  },
  "playwright-ai": {
    label: "Playwright — AI-generated E2E tests",
    files_added: ["playwright.config.ts", "e2e/main.spec.ts"],
    files_changed: [],
    deps: ["@playwright/test"],
    effortScore: 4,
    isAi: true,
    ai_output_file: "e2e/main.spec.ts",
    diffs: [
      {
        path: "e2e/main.spec.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,6 @@"),
          add(`// AI-generated — content depends on your actual repo`, 1),
          add(`// Typical output includes:`, 2),
          add(`//   • page.goto() navigation tests for your real routes`, 3),
          add(`//   • expect(page).toHaveTitle() / toHaveURL() assertions`, 4),
          add(`//   • form submission and button click flows`, 5),
          add(`//   • Full file generated when you confirm the PR`, 6),
        ],
      },
    ],
  },
  "api-tests": {
    label: "API tests — AI-generated (Supertest)",
    files_added: ["tests/api.test.ts"],
    files_changed: [],
    deps: ["supertest", "@types/supertest"],
    effortScore: 4,
    isAi: true,
    ai_output_file: "tests/api.test.ts",
    diffs: [
      {
        path: "tests/api.test.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,6 @@"),
          add(`// AI-generated — content depends on your actual repo`, 1),
          add(`// Typical output includes:`, 2),
          add(`//   • describe blocks per route (GET /api/users, POST /api/login, etc.)`, 3),
          add(`//   • supertest request + status code + response body assertions`, 4),
          add(`//   • error handling and edge case coverage`, 5),
          add(`//   • Full file generated when you confirm the PR`, 6),
        ],
      },
    ],
  },
  "pytest-ai": {
    label: "Pytest — AI-generated tests",
    files_added: ["tests/test_app.py"],
    files_changed: ["pyproject.toml"],
    deps: [],
    effortScore: 3,
    isAi: true,
    ai_output_file: "tests/test_app.py",
    diffs: [],
  },
  "go-test-ai": {
    label: "Go tests — AI-generated",
    files_added: ["app_test.go"],
    files_changed: [],
    deps: [],
    effortScore: 3,
    isAi: true,
    ai_output_file: "app_test.go",
    diffs: [],
  },
  "rspec-ai": {
    label: "RSpec — AI-generated tests",
    files_added: ["spec/app_spec.rb"],
    files_changed: [],
    deps: [],
    effortScore: 3,
    isAi: true,
    ai_output_file: "spec/app_spec.rb",
    diffs: [],
  },
  "phpunit-ai": {
    label: "PHPUnit — AI-generated tests",
    files_added: ["tests/AppTest.php"],
    files_changed: [],
    deps: [],
    effortScore: 3,
    isAi: true,
    ai_output_file: "tests/AppTest.php",
    diffs: [],
  },
  "junit-ai": {
    label: "JUnit — AI-generated tests",
    files_added: ["src/test/java/AppTest.java"],
    files_changed: [],
    deps: [],
    effortScore: 3,
    isAi: true,
    ai_output_file: "src/test/java/AppTest.java",
    diffs: [],
  },
  "cargo-test-ai": {
    label: "Rust tests — AI-generated (cargo test)",
    files_added: ["tests/integration_test.rs"],
    files_changed: [],
    deps: [],
    effortScore: 3,
    isAi: true,
    ai_output_file: "tests/integration_test.rs",
    diffs: [],
  },
  "xunit-ai": {
    label: "xUnit — AI-generated tests",
    files_added: ["tests/AppTests.cs"],
    files_changed: [],
    deps: [],
    effortScore: 3,
    isAi: true,
    ai_output_file: "tests/AppTests.cs",
    diffs: [],
  },
  "exunit-ai": {
    label: "ExUnit — AI-generated tests",
    files_added: ["test/app_test.exs"],
    files_changed: [],
    deps: [],
    effortScore: 3,
    isAi: true,
    ai_output_file: "test/app_test.exs",
    diffs: [],
  },
  logger: {
    label: "Add request logger (Winston)",
    files_added: ["src/lib/logger.ts", "src/middleware/logging.ts"],
    files_changed: ["src/index.ts"],
    deps: ["winston"],
    diffs: [
      {
        path: "src/lib/logger.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,10 @@"),
          add(`import winston from "winston";`, 1),
          add(``, 2),
          add(`export const logger = winston.createLogger({`, 3),
          add(`  level: process.env.LOG_LEVEL ?? "info",`, 4),
          add(`  format: winston.format.combine(`, 5),
          add(`    winston.format.timestamp(),`, 6),
          add(`    winston.format.json(),`, 7),
          add(`  ),`, 8),
          add(`  transports: [new winston.transports.Console()],`, 9),
          add(`});`, 10),
        ],
      },
      {
        path: "src/middleware/logging.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,15 @@"),
          add(`import type { Request, Response, NextFunction } from "express";`, 1),
          add(`import { logger } from "../lib/logger";`, 2),
          add(``, 3),
          add(
            `export function requestLogger(req: Request, res: Response, next: NextFunction) {`,
            4,
          ),
          add(`  const start = Date.now();`, 5),
          add(`  res.on("finish", () => {`, 6),
          add(`    logger.info("request", {`, 7),
          add(`      method: req.method,`, 8),
          add(`      url: req.url,`, 9),
          add(`      status: res.statusCode,`, 10),
          add(`      ms: Date.now() - start,`, 11),
          add(`    });`, 12),
          add(`  });`, 13),
          add(`  next();`, 14),
          add(`}`, 15),
        ],
      },
      {
        path: "src/index.ts",
        status: "modified",
        lines: [
          hunk("@@ -1,3 +1,5 @@"),
          ctx(`import express from "express";`, 1, 1),
          add(`import { requestLogger } from "./middleware/logging";`, 2),
          ctx(``, 2, 3),
          ctx(`const app = express();`, 3, 4),
          add(`app.use(requestLogger);`, 5),
        ],
      },
    ],
  },
  "health-check": {
    label: "Add health check endpoint (GET /health)",
    files_added: [],
    files_changed: ["src/index.ts"],
    deps: [],
    diffs: [
      {
        path: "src/index.ts",
        status: "modified",
        lines: [
          hunk("@@ -3,5 +3,9 @@"),
          ctx(`const app = express();`, 3, 3),
          ctx(``, 4, 4),
          add(`app.get("/health", (_req, res) => {`, 5),
          add(`  res.json({ status: "ok", uptime: process.uptime() });`, 6),
          add(`});`, 7),
          add(``, 8),
          ctx(`app.listen(process.env.PORT ?? 3000);`, 5, 9),
        ],
      },
    ],
  },
  cors: {
    label: "Add CORS policy",
    files_added: ["src/middleware/cors.ts"],
    files_changed: ["src/index.ts"],
    deps: ["cors", "@types/cors"],
    diffs: [
      {
        path: "src/middleware/cors.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,16 @@"),
          add(`import cors from "cors";`, 1),
          add(`import type { Express } from "express";`, 2),
          add(``, 3),
          add(`// Replace with your actual frontend origin(s).`, 4),
          add(`// Never use "*" in production — it allows any site to call your API.`, 5),
          add(`const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? "http://localhost:3000")`, 6),
          add(`  .split(",")`, 7),
          add(`  .map((o) => o.trim());`, 8),
          add(``, 9),
          add(`export function applyCors(app: Express): void {`, 10),
          add(`  app.use(cors({`, 11),
          add(
            `    origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)),`,
            12,
          ),
          add(`    credentials: true,`, 13),
          add(`  }));`, 14),
          add(`}`, 15),
        ],
      },
      {
        path: "src/index.ts",
        status: "modified",
        lines: [
          hunk("@@ -1,3 +1,5 @@"),
          ctx(`import express from "express";`, 1, 1),
          add(`import { applyCors } from "./middleware/cors";`, 2),
          ctx(``, 2, 3),
          ctx(`const app = express();`, 3, 4),
          add(`applyCors(app); // must come before other middleware`, 5),
        ],
      },
    ],
  },
  "ts-strict": {
    label: "TypeScript null safety (strictNullChecks)",
    files_added: [],
    files_changed: ["tsconfig.json"],
    deps: [],
    diffs: [
      {
        path: "tsconfig.json",
        status: "modified",
        lines: [
          hunk(`@@ -1,6 +1,7 @@`),
          ctx(`{`, 1, 1),
          ctx(`  "compilerOptions": {`, 2, 2),
          add(`    "strictNullChecks": true,`, 3),
          ctx(`    "target": "ES2020",`, 3, 4),
          ctx(`    "module": "ESNext",`, 4, 5),
          ctx(`    "moduleResolution": "bundler"`, 5, 6),
          ctx(`  }`, 6, 7),
          ctx(`}`, 7, 8),
        ],
      },
    ],
  },
  "db-pool": {
    label: "Add database connection pool (pg-pool)",
    files_added: ["src/lib/db.ts"],
    files_changed: [],
    deps: ["pg-pool", "@types/pg"],
    diffs: [
      {
        path: "src/lib/db.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,20 @@"),
          add(`import Pool from "pg-pool";`, 1),
          add(``, 2),
          add(`// A single shared pool — do not create a new Pool per request.`, 3),
          add(`// Pool size defaults to 10; tune with DATABASE_POOL_SIZE env var.`, 4),
          add(`const pool = new Pool({`, 5),
          add(`  connectionString: process.env.DATABASE_URL,`, 6),
          add(`  max: Number(process.env.DATABASE_POOL_SIZE ?? 10),`, 7),
          add(`  idleTimeoutMillis: 30_000,`, 8),
          add(`  connectionTimeoutMillis: 2_000,`, 9),
          add(
            `  // rejectUnauthorized: true validates the server cert (recommended for managed DBs like RDS, Neon, Supabase).`,
            10,
          ),
          add(
            `  // Set to false only if your DB uses a self-signed cert — and never in production without rotating secrets first.`,
            11,
          ),
          add(
            `  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : false,`,
            12,
          ),
          add(`});`, 13),
          add(``, 14),
          add(`pool.on("error", (err) => {`, 15),
          add(`  console.error("Unexpected pool error", err);`, 16),
          add(`});`, 17),
          add(``, 18),
          add(`export const db = pool;`, 19),
          add(`export const query = pool.query.bind(pool);`, 20),
        ],
      },
    ],
  },
  "auditor-stripe-webhook": {
    label: "Stripe webhook signature verification",
    files_added: [],
    files_changed: [],
    deps: [],
    effortScore: 0,
    isAi: false,
    diffs: [],
  },
  "auditor-env-undocumented": {
    label: ".env.example — scan undocumented vars",
    files_added: [".env.example"],
    files_changed: [],
    deps: [],
    effortScore: 0,
    diffs: [
      {
        path: ".env.example",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,3 @@"),
          add(`# Vars used in code but missing from .env.example`, 1),
          add(`STRIPE_SECRET_KEY=`, 2),
          add(`DATABASE_URL=`, 3),
        ],
      },
    ],
  },
  "auditor-env-gap": {
    label: ".env.example — fill env gaps",
    files_added: [],
    files_changed: [".env.example"],
    deps: [],
    effortScore: 0,
    diffs: [
      {
        path: ".env.example",
        status: "modified",
        lines: [
          hunk("@@ -0,0 +1,2 @@"),
          add(`# Adds undocumented vars found in active code paths`, 1),
          add(`NEW_VAR=`, 2),
        ],
      },
    ],
  },
  "auditor-api-validation": {
    label: "API request validation",
    files_added: [],
    files_changed: ["(API route)"],
    deps: [],
    effortScore: 3,
    isAi: true,
    diffs: [
      {
        path: "(API route)",
        status: "modified",
        lines: [
          hunk("@@ -0,0 +1,3 @@"),
          add(`// AI adds Zod/schema validation to unvalidated routes`, 1),
          add(`// Returns 400 on malformed payloads`, 2),
          add(`// Full patch generated when you confirm the PR`, 3),
        ],
      },
    ],
  },
  "auditor-auth-routes": {
    label: "Protect authenticated routes",
    files_added: [],
    files_changed: ["(protected route)"],
    deps: [],
    effortScore: 3,
    isAi: true,
    diffs: [
      {
        path: "(protected route)",
        status: "modified",
        lines: [
          hunk("@@ -0,0 +1,3 @@"),
          add(`// AI adds auth guard using your project's session pattern`, 1),
          add(`// Blocks unauthenticated access to dashboard/admin routes`, 2),
          add(`// Full patch generated when you confirm the PR`, 3),
        ],
      },
    ],
  },
  "auditor-prisma-migrations": {
    label: "Prisma migrate deploy script",
    files_added: [],
    files_changed: ["package.json"],
    deps: [],
    effortScore: 2,
    isAi: true,
    ai_output_file: "package.json",
    diffs: [
      {
        path: "package.json",
        status: "modified",
        lines: [
          hunk("@@ -8,4 +8,5 @@"),
          ctx(`  "scripts": {`, 8, 8),
          add(`    "db:migrate:deploy": "prisma migrate deploy",`, 9),
          ctx(`  },`, 10, 11),
        ],
      },
    ],
  },
  "auditor-localhost-api": {
    label: "Replace localhost API URLs",
    files_added: [],
    files_changed: ["(config)"],
    deps: [],
    effortScore: 2,
    isAi: true,
    diffs: [
      {
        path: "(config)",
        status: "modified",
        lines: [
          hunk("@@ -0,0 +1,3 @@"),
          add(`// AI replaces hardcoded localhost API URLs with env vars`, 1),
          add(`// Uses VITE_/NEXT_PUBLIC_ prefixes as appropriate`, 2),
          add(`// Full patch generated when you confirm the PR`, 3),
        ],
      },
    ],
  },
  "auditor-todo-markers": {
    label: "Generate TODO audit report",
    files_added: ["TODO_REPORT.md"],
    files_changed: [],
    deps: [],
    effortScore: 3,
    isAi: true,
    ai_output_file: "TODO_REPORT.md",
    diffs: [
      {
        path: "TODO_REPORT.md",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,3 @@"),
          add(`# TODO Audit Report`, 1),
          add(`AI-consolidated list of every TODO/FIXME/HACK marker with recommendations`, 2),
          add(`Full report generated when you confirm the PR`, 3),
        ],
      },
    ],
  },
  "security-cookie-flags": {
    label: "Add secure cookie attributes",
    files_added: ["src/middleware/secure-cookies.ts"],
    files_changed: ["src/index.ts"],
    deps: [],
    diffs: [
      {
        path: "src/middleware/secure-cookies.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,8 @@"),
          add(`function fixCookieAttributes(cookie: string): string {`, 1),
          add(`  const attrs = cookie.split(";").slice(1).map((p) => p.trim().toLowerCase());`, 2),
          add(`  let result = cookie;`, 3),
          add(`  if (!attrs.includes("httponly")) result += "; HttpOnly";`, 4),
          add(`  if (!attrs.includes("secure")) result += "; Secure";`, 5),
          add(`  if (!attrs.some((a) => a.startsWith("samesite"))) result += "; SameSite=Lax";`, 6),
          add(`  return result;`, 7),
          add(`}`, 8),
        ],
      },
      {
        path: "src/index.ts",
        status: "modified",
        lines: [
          hunk("@@ -1,3 +1,5 @@"),
          ctx(`import express from "express";`, 1, 1),
          add(`import { applySecureCookies } from "./middleware/secure-cookies";`, 2),
          ctx(``, 2, 3),
          ctx(`const app = express();`, 3, 4),
          add(`applySecureCookies(app);`, 5),
        ],
      },
    ],
  },
  "https-redirect": {
    label: "Add HTTPS redirect",
    files_added: ["src/middleware/https-redirect.ts"],
    files_changed: ["src/index.ts"],
    deps: [],
    diffs: [
      {
        path: "src/middleware/https-redirect.ts",
        status: "added",
        lines: [
          hunk("@@ -0,0 +1,4 @@"),
          add(`export function httpsRedirect(req, res, next) {`, 1),
          add(`  if (isHttps(req)) return next();`, 2),
          add(`  res.redirect(301, "https://" + req.headers.host + req.originalUrl);`, 3),
          add(`}`, 4),
        ],
      },
      {
        path: "src/index.ts",
        status: "modified",
        lines: [
          hunk("@@ -1,3 +1,5 @@"),
          ctx(`import express from "express";`, 1, 1),
          add(`import { applyHttpsRedirect } from "./middleware/https-redirect";`, 2),
          ctx(``, 2, 3),
          ctx(`const app = express();`, 3, 4),
          add(`applyHttpsRedirect(app);`, 5),
        ],
      },
    ],
  },
};

const NON_NODE_FRAMEWORKS = new Set([
  "Python",
  "Java",
  "Go",
  "Ruby",
  "PHP",
  "Rust",
  "C#",
  "Elixir",
  "Kotlin",
]);

const PYTHON_FIX_PREVIEWS: Partial<Record<string, Partial<FixPreview>>> = {
  helmet: {
    files_added: ["middleware/security_headers.py"],
    files_changed: ["app.py"],
    deps: [],
  },
  cors: {
    files_added: ["middleware/cors.py"],
    files_changed: ["app.py"],
    deps: ["flask-cors"],
  },
  "rate-limit": {
    files_added: ["middleware/rate_limit.py"],
    files_changed: ["app.py"],
    deps: [],
  },
  logger: {
    files_added: ["middleware/logger.py"],
    files_changed: ["app.py"],
    deps: [],
  },
  "health-check": {
    files_added: ["health.py"],
    files_changed: ["app.py"],
    deps: [],
  },
  "security-cookie-flags": {
    files_added: ["middleware/cookie_flags.py"],
    files_changed: ["app.py"],
    deps: [],
  },
  "https-redirect": {
    files_added: ["middleware/https_redirect.py"],
    files_changed: ["app.py"],
    deps: [],
  },
};

const JAVA_FIX_PREVIEWS: Partial<Record<string, Partial<FixPreview>>> = {
  helmet: {
    files_added: ["src/main/java/.../security/SecurityHeadersFilter.java"],
    files_changed: [],
    deps: [],
  },
  cors: {
    files_added: ["src/main/java/.../security/CorsConfig.java"],
    files_changed: [],
    deps: [],
  },
  "rate-limit": {
    files_added: ["src/main/java/.../security/RateLimitFilter.java"],
    files_changed: [],
    deps: [],
  },
  logger: {
    files_added: ["src/main/java/.../logging/AppLogger.java"],
    files_changed: [],
    deps: [],
  },
  "health-check": {
    files_added: ["src/main/java/.../health/HealthController.java"],
    files_changed: [],
    deps: [],
  },
};

const GO_FIX_PREVIEWS: Partial<Record<string, Partial<FixPreview>>> = {
  helmet: {
    files_added: ["internal/middleware/middleware.go"],
    files_changed: ["main.go"],
    deps: [],
  },
  cors: {
    files_added: ["internal/middleware/middleware.go"],
    files_changed: ["main.go"],
    deps: [],
  },
  "rate-limit": {
    files_added: ["internal/middleware/middleware.go"],
    files_changed: ["main.go"],
    deps: [],
  },
  logger: {
    files_added: ["internal/middleware/middleware.go"],
    files_changed: ["main.go"],
    deps: [],
  },
  "health-check": {
    files_added: ["internal/health/handler.go"],
    files_changed: ["main.go"],
    deps: [],
  },
  "security-cookie-flags": {
    files_added: ["internal/middleware/middleware.go"],
    files_changed: ["main.go"],
    deps: [],
  },
  "https-redirect": {
    files_added: ["internal/middleware/middleware.go"],
    files_changed: ["main.go"],
    deps: [],
  },
};

const RUBY_FIX_PREVIEWS: Partial<Record<string, Partial<FixPreview>>> = {
  helmet: {
    files_added: ["lib/middleware/security_headers.rb"],
    files_changed: ["config/application.rb"],
    deps: [],
  },
  cors: {
    files_added: ["lib/middleware/cors.rb"],
    files_changed: ["config/application.rb"],
    deps: [],
  },
  "rate-limit": {
    files_added: ["lib/middleware/rate_limit.rb"],
    files_changed: ["config/application.rb"],
    deps: [],
  },
  logger: {
    files_added: ["lib/middleware/request_logger.rb"],
    files_changed: ["config/application.rb"],
    deps: [],
  },
  "health-check": {
    files_added: ["app/controllers/health_controller.rb"],
    files_changed: ["config/routes.rb"],
    deps: [],
  },
};

const PHP_FIX_PREVIEWS: Partial<Record<string, Partial<FixPreview>>> = {
  helmet: {
    files_added: [
      "app/Http/Middleware/SecurityHeaders.php",
      "src/EventSubscriber/SecurityHeadersSubscriber.php",
    ],
    files_changed: ["app/Http/Kernel.php"],
    deps: [],
  },
  cors: {
    files_added: ["app/Http/Middleware/CorsMiddleware.php"],
    files_changed: ["app/Http/Kernel.php"],
    deps: [],
  },
  "rate-limit": {
    files_added: ["app/Http/Middleware/RateLimitMiddleware.php"],
    files_changed: ["app/Http/Kernel.php"],
    deps: [],
  },
  logger: {
    files_added: ["app/Http/Middleware/RequestLogger.php"],
    files_changed: ["app/Http/Kernel.php"],
    deps: [],
  },
  "health-check": {
    files_added: ["routes/web.php"],
    files_changed: [],
    deps: [],
  },
};

const RUST_FIX_PREVIEWS: Partial<Record<string, Partial<FixPreview>>> = {
  helmet: {
    files_added: ["src/middleware.rs"],
    files_changed: ["src/main.rs"],
    deps: [],
  },
  cors: {
    files_added: ["src/middleware.rs"],
    files_changed: ["src/main.rs"],
    deps: [],
  },
  "rate-limit": {
    files_added: ["src/middleware.rs"],
    files_changed: ["src/main.rs"],
    deps: [],
  },
  logger: {
    files_added: ["src/middleware.rs"],
    files_changed: ["src/main.rs"],
    deps: [],
  },
  "health-check": {
    files_added: ["src/health.rs"],
    files_changed: ["src/main.rs"],
    deps: [],
  },
};

const CSHARP_FIX_PREVIEWS: Partial<Record<string, Partial<FixPreview>>> = {
  helmet: {
    files_added: ["Middleware/SecurityHeadersMiddleware.cs"],
    files_changed: ["Program.cs"],
    deps: [],
  },
  cors: {
    files_added: ["Middleware/CorsMiddleware.cs"],
    files_changed: ["Program.cs"],
    deps: [],
  },
  "rate-limit": {
    files_added: ["Middleware/RateLimitMiddleware.cs"],
    files_changed: ["Program.cs"],
    deps: [],
  },
  logger: {
    files_added: ["Middleware/RequestLoggerMiddleware.cs"],
    files_changed: ["Program.cs"],
    deps: [],
  },
  "health-check": {
    files_added: [],
    files_changed: ["Program.cs"],
    deps: [],
  },
};

const ELIXIR_FIX_PREVIEWS: Partial<Record<string, Partial<FixPreview>>> = {
  helmet: {
    files_added: ["lib/app_web/plugs/security_headers.ex"],
    files_changed: ["lib/app_web/endpoint.ex"],
    deps: [],
  },
  cors: {
    files_added: ["lib/app_web/plugs/cors.ex"],
    files_changed: ["lib/app_web/endpoint.ex"],
    deps: [],
  },
  "rate-limit": {
    files_added: ["lib/app_web/plugs/rate_limit.ex"],
    files_changed: ["lib/app_web/endpoint.ex"],
    deps: [],
  },
  logger: {
    files_added: ["lib/app_web/plugs/request_logger.ex"],
    files_changed: ["lib/app_web/endpoint.ex"],
    deps: [],
  },
  "health-check": {
    files_added: ["lib/app_web/controllers/health_controller.ex"],
    files_changed: ["lib/app_web/router.ex"],
    deps: [],
  },
};

/** Language-aware fix preview metadata for the fix UI (falls back to Node templates). */
export function getFixPreviewDetails(
  fixId: string,
  framework: string,
): (FixPreview & { label: string }) | undefined {
  const base = FIX_DETAILS[fixId];
  if (!base) return undefined;
  if (!NON_NODE_FRAMEWORKS.has(framework)) return base;
  const lang = framework.toLowerCase();
  if (lang === "python" && PYTHON_FIX_PREVIEWS[fixId]) {
    return { ...base, ...PYTHON_FIX_PREVIEWS[fixId] };
  }
  if (lang === "java" && JAVA_FIX_PREVIEWS[fixId]) {
    return { ...base, ...JAVA_FIX_PREVIEWS[fixId] };
  }
  if ((lang === "kotlin" || framework === "Kotlin") && JAVA_FIX_PREVIEWS[fixId]) {
    return { ...base, ...JAVA_FIX_PREVIEWS[fixId] };
  }
  if (lang === "go" && GO_FIX_PREVIEWS[fixId]) {
    return { ...base, ...GO_FIX_PREVIEWS[fixId] };
  }
  if (lang === "ruby" && RUBY_FIX_PREVIEWS[fixId]) {
    return { ...base, ...RUBY_FIX_PREVIEWS[fixId] };
  }
  if (lang === "php" && PHP_FIX_PREVIEWS[fixId]) {
    return { ...base, ...PHP_FIX_PREVIEWS[fixId] };
  }
  if (lang === "rust" && RUST_FIX_PREVIEWS[fixId]) {
    return { ...base, ...RUST_FIX_PREVIEWS[fixId] };
  }
  if ((lang === "c#" || framework === "C#") && CSHARP_FIX_PREVIEWS[fixId]) {
    return { ...base, ...CSHARP_FIX_PREVIEWS[fixId] };
  }
  if (lang === "elixir" && ELIXIR_FIX_PREVIEWS[fixId]) {
    return { ...base, ...ELIXIR_FIX_PREVIEWS[fixId] };
  }
  return base;
}
