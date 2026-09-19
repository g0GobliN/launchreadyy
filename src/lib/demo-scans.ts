/**
 * Pre-scanned demo repos for /demo — shaped like live scan + sandbox + verdict UI.
 */

export interface DemoScanIssue {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  businessImpact: string;
  productionScenario: string;
  fixId: string;
  timeSaved: string;
  riskLevel?: "blocker" | "high" | "medium" | "low";
  effortScore: number;
  confidence: "high" | "medium" | "low";
  autoFixable?: boolean;
  /** Evidence line shown on blockers / verdict. */
  evidence?: string;
  /** Short diff preview for Fix tab. */
  diffPreview?: string[];
}

export interface DemoSandbox {
  status: "passed" | "failed" | "skipped";
  ecosystem: string;
  steps: string[];
  plannedSteps: { id: string; label: string }[];
  note?: string;
  durationSec?: number;
}

export interface DemoScan {
  id: string;
  repoFullName: string;
  description: string;
  framework: string;
  stars: number;
  score: number;
  deployTarget: string;
  verdict: "not_ready" | "conditional" | "ready";
  verdictHeadline: string;
  verdictSummary: string;
  sandbox: DemoSandbox;
  categoryScores: { category: string; score: number }[];
  checklist: { label: string; ok: boolean }[];
  issues: DemoScanIssue[];
  scannedAt: string;
}

export const DEMO_SCANS: DemoScan[] = [
  {
    id: "next-payments-template",
    repoFullName: "acme-labs/checkout-web",
    description: "Next.js + payments application — a common AI-generated project shape",
    framework: "Next.js",
    stars: 128,
    score: 41,
    deployTarget: "Vercel",
    verdict: "not_ready",
    verdictHeadline: "Not ready to launch",
    verdictSummary:
      "Sandbox build passed, but Production Security and CI gaps still block a confident ship.",
    scannedAt: "2 min ago",
    sandbox: {
      status: "passed",
      ecosystem: "Node",
      durationSec: 94,
      plannedSteps: [
        { id: "clone", label: "Clone" },
        { id: "install", label: "Install" },
        { id: "build", label: "Build" },
        { id: "lint", label: "Lint" },
      ],
      steps: [
        "$ git clone acme-labs/checkout-web",
        "Cloning into '/home/user/workspace'…",
        "$ npm ci",
        "added 412 packages in 18s",
        "$ npm run build",
        "✓ Compiled successfully in 12.4s",
        "$ npm run lint",
        "✓ No ESLint warnings",
        "✓ Sandbox verify passed (94s)",
      ],
    },
    categoryScores: [
      { category: "CI/CD", score: 20 },
      { category: "Testing", score: 15 },
      { category: "Production Security", score: 35 },
      { category: "Environment", score: 40 },
      { category: "Monitoring", score: 55 },
      { category: "Docs", score: 60 },
    ],
    checklist: [
      { label: "Sandbox install/build/lint", ok: true },
      { label: "CI workflow present", ok: false },
      { label: "Payment webhook verified", ok: false },
      { label: ".env.example committed", ok: false },
      { label: "Unit test runner", ok: false },
      { label: "Error monitoring hook", ok: true },
    ],
    issues: [
      {
        id: "1",
        title: "No GitHub Actions CI",
        severity: "high",
        category: "CI/CD",
        businessImpact: "Broken code ships to production without automated gates.",
        productionScenario:
          "A bad deploy merges silently; users hit regressions before you notice.",
        fixId: "ci-ai",
        timeSaved: "3h",
        riskLevel: "high",
        effortScore: 2,
        confidence: "high",
        evidence: "Checked: .github/workflows/*.yml — none found",
        diffPreview: [
          "+ name: CI",
          "+ on: [push, pull_request]",
          "+ jobs:",
          "+   build:",
          "+     runs-on: ubuntu-latest",
        ],
      },
      {
        id: "2",
        title: "Payment webhook may not verify signatures",
        severity: "critical",
        category: "Production Security",
        businessImpact: "Payment fraud — fake events could grant access without payment.",
        productionScenario:
          "Attacker POSTs to your webhook URL and activates premium plans for free.",
        fixId: "auditor-stripe-webhook",
        timeSaved: "3h",
        riskLevel: "blocker",
        effortScore: 0,
        confidence: "high",
        evidence: "src/app/api/webhooks/route.ts — no stripe-signature check matched",
        diffPreview: [
          "+ const sig = headers.get('stripe-signature')",
          "+ const event = stripe.webhooks.constructEvent(body, sig, secret)",
        ],
      },
      {
        id: "3",
        title: "Env vars used in code but not documented",
        severity: "high",
        category: "Environment setup",
        businessImpact: "Deploy fails or runs with wrong configuration.",
        productionScenario: "Missing payment secret in prod → all checkouts fail at launch.",
        fixId: "auditor-env-undocumented",
        timeSaved: "1h",
        riskLevel: "high",
        effortScore: 1,
        confidence: "medium",
        evidence:
          "Found STRIPE_SECRET_KEY, NEXT_PUBLIC_APP_URL in source — missing from .env.example",
      },
      {
        id: "4",
        title: "Vitest unit tests missing",
        severity: "high",
        category: "Testing",
        businessImpact: "No automated proof that features still work after changes.",
        productionScenario: "A refactor breaks checkout; you find out from angry users.",
        fixId: "vitest-ai",
        timeSaved: "4h",
        riskLevel: "medium",
        effortScore: 3,
        confidence: "high",
        evidence: "No vitest.config.* / *.test.ts under src/",
        diffPreview: [
          "+ // tests/smoke.test.ts",
          "+ import { describe, it, expect } from 'vitest'",
        ],
      },
      {
        id: "5",
        title: ".env.example not committed",
        severity: "high",
        category: "Production Security",
        businessImpact: "Teammates and deploy pipelines cannot configure the app safely.",
        productionScenario: "Production starts with missing env vars and crashes on first request.",
        fixId: "env-example",
        timeSaved: "30m",
        riskLevel: "medium",
        effortScore: 1,
        confidence: "high",
        evidence: "Tree scan: .env.example — missing",
      },
    ],
  },
  {
    id: "fastapi-api",
    repoFullName: "acme-labs/payments-api",
    description: "FastAPI backend — polyglot scan + sandbox (Python)",
    framework: "FastAPI",
    stars: 86,
    score: 36,
    deployTarget: "Railway / Fly",
    verdict: "not_ready",
    verdictHeadline: "Not ready to launch",
    verdictSummary: "Python sandbox passed; CI, validation, and tests are still missing.",
    scannedAt: "14 min ago",
    sandbox: {
      status: "passed",
      ecosystem: "Python",
      durationSec: 71,
      plannedSteps: [
        { id: "clone", label: "Clone" },
        { id: "install", label: "Install" },
        { id: "compile", label: "Compile" },
        { id: "lint", label: "Lint" },
      ],
      steps: [
        "$ git clone acme-labs/payments-api",
        "Detected ecosystem: Python (requirements.txt)",
        "$ pip install -r requirements.txt",
        "Successfully installed fastapi-0.115 uvicorn pydantic",
        "$ python -m compileall .",
        "Listing '.'... done",
        "$ ruff check .",
        "All checks passed!",
        "✓ Sandbox verify passed (71s)",
      ],
    },
    categoryScores: [
      { category: "CI/CD", score: 10 },
      { category: "Testing", score: 5 },
      { category: "Production Security", score: 45 },
      { category: "API reliability", score: 30 },
      { category: "Environment", score: 40 },
      { category: "Docs", score: 50 },
    ],
    checklist: [
      { label: "Sandbox install/compile/lint", ok: true },
      { label: "CI workflow present", ok: false },
      { label: "Request validation", ok: false },
      { label: "pytest configured", ok: false },
      { label: ".env.example committed", ok: false },
    ],
    issues: [
      {
        id: "1",
        title: "No CI workflow for Python",
        severity: "high",
        category: "CI/CD",
        businessImpact: "No automated quality gate on push.",
        productionScenario: "Broken imports reach main; first deploy fails mid-launch.",
        fixId: "ci-ai",
        timeSaved: "3h",
        riskLevel: "high",
        effortScore: 2,
        confidence: "high",
        evidence: "No .github/workflows matching pytest / ruff",
      },
      {
        id: "2",
        title: "API routes without input validation",
        severity: "high",
        category: "API reliability",
        businessImpact: "Malformed requests crash APIs or corrupt data.",
        productionScenario: "Bad JSON payload causes 500 errors for all clients.",
        fixId: "auditor-api-validation",
        timeSaved: "2h",
        riskLevel: "blocker",
        effortScore: 3,
        confidence: "medium",
        evidence: "app/routes/payments.py — dict body without Pydantic model",
      },
      {
        id: "3",
        title: "No pytest scaffold",
        severity: "high",
        category: "Testing",
        businessImpact: "No automated proof that endpoints still work.",
        productionScenario:
          "A schema change breaks payment processing; you learn from failed charges.",
        fixId: "pytest-ai",
        timeSaved: "3h",
        riskLevel: "medium",
        effortScore: 3,
        confidence: "high",
        evidence: "No pytest.ini / tests/ directory",
      },
      {
        id: "4",
        title: "Missing .env.example",
        severity: "medium",
        category: "Environment setup",
        businessImpact: "Undocumented secrets force guesswork during deploy.",
        productionScenario: "DATABASE_URL missing in prod → app won't start.",
        fixId: "env-example",
        timeSaved: "30m",
        riskLevel: "medium",
        effortScore: 1,
        confidence: "high",
        evidence: ".env.example — missing",
      },
    ],
  },
  {
    id: "express-api",
    repoFullName: "acme-labs/orders-api",
    description: "Express API — vibe-coded backend with security gaps",
    framework: "Express",
    stars: 41,
    score: 38,
    deployTarget: "Railway / Render",
    verdict: "not_ready",
    verdictHeadline: "Not ready — sandbox failed",
    verdictSummary:
      "Clean-environment build failed. Fix the TypeScript error before trusting any score.",
    scannedAt: "1 hr ago",
    sandbox: {
      status: "failed",
      ecosystem: "Node",
      durationSec: 41,
      plannedSteps: [
        { id: "clone", label: "Clone" },
        { id: "install", label: "Install" },
        { id: "build", label: "Build" },
        { id: "lint", label: "Lint" },
      ],
      steps: [
        "$ git clone acme-labs/orders-api",
        "$ npm ci",
        "added 287 packages in 11s",
        "$ npm run build",
        "src/routes/orders.ts:42:5 - error TS2322: Type 'string' is not assignable to type 'number'.",
        "✗ Build failed (exit 1)",
        "→ Verdict forced to Not ready",
      ],
      note: "Sandbox failed — launch verdict stays Not ready until the build is fixed.",
    },
    categoryScores: [
      { category: "CI/CD", score: 40 },
      { category: "Testing", score: 25 },
      { category: "Production Security", score: 30 },
      { category: "API reliability", score: 35 },
      { category: "Observability", score: 20 },
      { category: "Build", score: 0 },
    ],
    checklist: [
      { label: "Sandbox install", ok: true },
      { label: "Sandbox build", ok: false },
      { label: "Rate limiting", ok: false },
      { label: "Input validation", ok: false },
      { label: "Structured logging", ok: false },
    ],
    issues: [
      {
        id: "4",
        title: "Sandbox build failed",
        severity: "critical",
        category: "Sandbox verify",
        businessImpact: "The app does not build in a clean environment — deploy will fail.",
        productionScenario: "CI or host build breaks the same way the sandbox just did.",
        fixId: "ci-ai",
        timeSaved: "2h",
        riskLevel: "blocker",
        effortScore: 2,
        confidence: "high",
        autoFixable: false,
        evidence: "npm run build → TS2322 at src/routes/orders.ts:42",
      },
      {
        id: "1",
        title: "API routes without input validation",
        severity: "high",
        category: "API reliability",
        businessImpact: "Malformed requests crash APIs or corrupt data.",
        productionScenario: "Bad JSON payload causes 500 errors for all clients.",
        fixId: "auditor-api-validation",
        timeSaved: "2h",
        riskLevel: "high",
        effortScore: 3,
        confidence: "medium",
        evidence: "router.post('/orders', (req) => …) — no schema",
      },
      {
        id: "2",
        title: "No rate limiting on API",
        severity: "high",
        category: "Production Security",
        businessImpact: "API abuse can take down your service or spike costs.",
        productionScenario: "Bot hammers /api — server OOMs during your launch demo.",
        fixId: "rate-limit",
        timeSaved: "1h",
        riskLevel: "medium",
        effortScore: 2,
        confidence: "high",
        evidence: "No express-rate-limit / similar middleware",
      },
      {
        id: "3",
        title: "No structured logging",
        severity: "medium",
        category: "Observability",
        businessImpact: "Production incidents are impossible to debug quickly.",
        productionScenario: "Users report errors; you have no request trail to investigate.",
        fixId: "logger",
        timeSaved: "45m",
        riskLevel: "medium",
        effortScore: 1,
        confidence: "high",
        evidence: "console.log only — no pino/winston request logger",
      },
    ],
  },
];

/** List-only showcase repos — same card UI, Analyze disabled. */
export type DemoShowcaseRepo = {
  id: string;
  repoFullName: string;
  description: string;
  language: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
};

export const DEMO_SHOWCASE_REPOS: DemoShowcaseRepo[] = [
  {
    id: "showcase-marketing",
    repoFullName: "acme-labs/marketing-site",
    description: "Astro marketing site with CMS content and edge redirects",
    language: "Astro",
    private: false,
    defaultBranch: "main",
    updatedAt: "5 hours ago",
  },
  {
    id: "showcase-mobile",
    repoFullName: "acme-labs/mobile-app",
    description: "React Native client for checkout and account management",
    language: "TypeScript",
    private: true,
    defaultBranch: "develop",
    updatedAt: "1 day ago",
  },
  {
    id: "showcase-workers",
    repoFullName: "acme-labs/workers",
    description: "Background jobs — data sync, webhooks, email digests",
    language: "Go",
    private: true,
    defaultBranch: "main",
    updatedAt: "3 days ago",
  },
  {
    id: "showcase-admin",
    repoFullName: "acme-labs/admin-console",
    description: "Internal ops dashboard — support tools and feature flags",
    language: "Vue",
    private: true,
    defaultBranch: "main",
    updatedAt: "1 week ago",
  },
  {
    id: "showcase-docs",
    repoFullName: "acme-labs/docs-portal",
    description: "Developer docs + API reference, MDX + search",
    language: "MDX",
    private: false,
    defaultBranch: "main",
    updatedAt: "2 weeks ago",
  },
];

export function getDemoScan(id: string): DemoScan | undefined {
  return DEMO_SCANS.find((s) => s.id === id);
}

export function demoBlockers(scan: DemoScan) {
  return scan.issues.filter((i) => i.riskLevel === "blocker" || i.severity === "critical");
}
