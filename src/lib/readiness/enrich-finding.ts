import type { IssueInput } from "../scanner-rules";
import { AI_FIX_IDS } from "../fix-meta";
import { RISK_FROM_SEVERITY, toReadinessCategory } from "./categories";
import type {
  AffectedAudience,
  FixDifficulty,
  ReadinessFinding,
  ReadinessCategory,
  RiskLevel,
} from "./types";

interface FindingMeta {
  businessImpact: string;
  productionScenario: string;
  affectedAudience: AffectedAudience;
  fixDifficulty: FixDifficulty;
  priority: number;
  readinessCategory?: ReadinessCategory;
}

const FIX_META: Record<string, FindingMeta> = {
  "github-actions": {
    businessImpact: "Broken code ships to production without automated gates.",
    productionScenario: "A bad deploy merges silently; users hit regressions before you notice.",
    affectedAudience: "customers",
    fixDifficulty: "easy",
    priority: 2,
  },
  "ci-ai": {
    businessImpact: "No automated quality gate tailored to your stack.",
    productionScenario: "Regressions reach main because nothing runs on push.",
    affectedAudience: "customers",
    fixDifficulty: "easy",
    priority: 2,
  },
  // Priority 6 on all three, matching the default for a medium finding. `partitionFindings`
  // treats medium findings with priority <= 5 as "fix before launch", and these are hardening
  // that should happen without being a reason to hold the launch. Offering a one-click fix for a
  // finding must not change how the finding is graded — the first version of these entries copied
  // `priority: 2` from their neighbours and re-scored nine real repositories by up to 18 points.
  "workflow-permissions": {
    businessImpact: "Any compromised step in CI can push code or publish a release as you.",
    productionScenario:
      "A third-party action you never audited runs with a token that can commit to main.",
    affectedAudience: "business",
    fixDifficulty: "trivial",
    priority: 6,
  },
  "workflow-unpinned-action": {
    businessImpact: "Code you never reviewed can start running in your pipeline at any time.",
    productionScenario:
      "The action's owner repoints the tag; your next build runs different code with your secrets.",
    affectedAudience: "business",
    fixDifficulty: "trivial",
    priority: 6,
  },
  "docker-root-user": {
    businessImpact:
      "A break-in starts with root inside the container rather than having to earn it.",
    productionScenario:
      "A dependency bug gives an attacker code execution, and root in the container is the usual first step towards the host.",
    affectedAudience: "business",
    fixDifficulty: "easy",
    priority: 6,
  },
  "dependency-audit-ci": {
    businessImpact: "Known vulnerable packages can ship into production undetected.",
    productionScenario:
      "A CVE in a dependency sits unpatched for months because nothing ever checks for it.",
    affectedAudience: "business",
    fixDifficulty: "easy",
    priority: 2,
  },
  "env-example": {
    businessImpact: "Teammates and deploy pipelines cannot configure the app safely.",
    productionScenario: "Production starts with missing env vars and crashes on first request.",
    affectedAudience: "team",
    fixDifficulty: "trivial",
    priority: 3,
    readinessCategory: "Environment setup",
  },
  "env-example-ai": {
    businessImpact: "Undocumented secrets force guesswork during deploy.",
    productionScenario: "Stripe or DB keys missing in prod → checkout or auth fails for all users.",
    affectedAudience: "customers",
    fixDifficulty: "easy",
    priority: 3,
    readinessCategory: "Environment setup",
  },
  "gitignore-env": {
    businessImpact: "Live credentials may already be exposed in git history.",
    productionScenario: "Attackers scrape repo history and reuse API keys or database passwords.",
    affectedAudience: "business",
    fixDifficulty: "hard",
    priority: 1,
  },
  readme: {
    businessImpact: "Investors, clients, and hires cannot run or evaluate the product.",
    productionScenario: "Handoff demos fail because nobody can boot the app locally.",
    affectedAudience: "business",
    fixDifficulty: "easy",
    priority: 5,
  },
  "readme-ai": {
    businessImpact: "Missing onboarding docs block launches and client handoffs.",
    productionScenario: "New engineer spends days reverse-engineering setup instead of shipping.",
    affectedAudience: "team",
    fixDifficulty: "easy",
    priority: 5,
  },
  vitest: {
    businessImpact: "No automated proof that features still work after changes.",
    productionScenario: "A refactor breaks checkout; you find out from angry users.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 4,
  },
  "vitest-ai": {
    businessImpact: "No regression safety net for AI-generated code.",
    productionScenario: "Each prompt silently breaks existing flows until manual QA catches it.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 4,
  },
  "playwright-ai": {
    businessImpact: "Critical user journeys are untested end-to-end.",
    productionScenario: "Signup or payment flow breaks in production with no test catching it.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 4,
  },
  "api-tests": {
    businessImpact: "API contracts can drift without detection.",
    productionScenario: "Mobile or frontend clients break when an endpoint changes silently.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 4,
    readinessCategory: "API reliability",
  },
  "pytest-ai": {
    businessImpact: "No regression safety net for Python business logic.",
    productionScenario: "A refactor breaks core flows; you find out from production errors.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 4,
  },
  "go-test-ai": {
    businessImpact: "No automated verification for Go packages.",
    productionScenario: "Handler regressions ship because CI only runs vet, not real tests.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 4,
  },
  "rspec-ai": {
    businessImpact: "Ruby app logic is untested.",
    productionScenario: "Controller changes break production without CI catching them.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 4,
  },
  "phpunit-ai": {
    businessImpact: "PHP application logic lacks automated tests.",
    productionScenario: "Route or service changes break silently on deploy.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 4,
  },
  "junit-ai": {
    businessImpact: "Java services lack automated regression tests.",
    productionScenario: "Controller or service changes break production without CI catching them.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 4,
  },
  "cargo-test-ai": {
    businessImpact: "Rust crates lack automated tests beyond clippy.",
    productionScenario: "Logic regressions ship because only cargo clippy runs in CI.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 4,
  },
  "xunit-ai": {
    businessImpact: ".NET services lack automated regression tests.",
    productionScenario: "API or service changes break production without dotnet test in CI.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 4,
  },
  "exunit-ai": {
    businessImpact: "Elixir/Phoenix apps lack automated regression tests.",
    productionScenario: "Context or controller changes break production without mix test in CI.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 4,
  },
  eslint: {
    businessImpact: "Common bugs and inconsistent patterns accumulate in the codebase.",
    productionScenario: "Subtle logic errors slip through review and cause production incidents.",
    affectedAudience: "team",
    fixDifficulty: "easy",
    priority: 8,
  },
  prettier: {
    businessImpact: "Noisy diffs slow reviews and hide real bugs.",
    productionScenario: "Review fatigue lets a critical change merge unnoticed.",
    affectedAudience: "team",
    fixDifficulty: "trivial",
    priority: 9,
  },
  dockerfile: {
    businessImpact: "Deploy environments differ from local — 'works on my machine'.",
    productionScenario: "Production build fails on launch day because Node version or deps differ.",
    affectedAudience: "business",
    fixDifficulty: "medium",
    priority: 5,
    readinessCategory: "Deployment readiness",
  },
  monitoring: {
    businessImpact: "Production crashes are invisible until users complain.",
    productionScenario: "Revenue-impacting errors run for hours with zero alert.",
    affectedAudience: "customers",
    fixDifficulty: "easy",
    priority: 3,
    readinessCategory: "Error handling",
  },
  "error-boundary": {
    businessImpact: "Uncaught UI errors show a broken white screen to users.",
    productionScenario:
      "One bad component takes down the entire page instead of a graceful fallback.",
    affectedAudience: "users",
    fixDifficulty: "easy",
    priority: 4,
    readinessCategory: "Frontend UX basics",
  },
  helmet: {
    businessImpact: "Missing security headers expose users to XSS and clickjacking.",
    productionScenario: "Browser-based attacks succeed because HTTP headers are not hardened.",
    affectedAudience: "users",
    fixDifficulty: "easy",
    priority: 2,
  },
  "rate-limit": {
    businessImpact: "API is open to brute-force and denial-of-service abuse.",
    productionScenario: "Auth endpoints hammered; legitimate users locked out or bills spike.",
    affectedAudience: "business",
    fixDifficulty: "easy",
    priority: 2,
  },
  logger: {
    businessImpact: "Production incidents are impossible to debug without request logs.",
    productionScenario: "Outage lasts hours because you cannot trace which request failed.",
    affectedAudience: "team",
    fixDifficulty: "easy",
    priority: 5,
    readinessCategory: "API reliability",
  },
  "security-cookie-flags": {
    businessImpact:
      "Session and auth cookies can be stolen over unencrypted connections or read by injected scripts.",
    productionScenario:
      "A cookie missing Secure/HttpOnly/SameSite gets exfiltrated via XSS or a man-in-the-middle on public wifi.",
    affectedAudience: "users",
    fixDifficulty: "easy",
    priority: 2,
  },
  "https-redirect": {
    businessImpact: "Traffic served over plain HTTP can be intercepted or downgraded.",
    productionScenario:
      "A user on public wifi hits the HTTP URL and their session, credentials, or data travel unencrypted.",
    affectedAudience: "users",
    fixDifficulty: "easy",
    priority: 2,
  },
};

const AUDITOR_META: Record<string, FindingMeta & { autoFixable?: boolean }> = {
  "auditor-todo-markers": {
    businessImpact: "Shipped code may contain unfinished logic users will hit.",
    productionScenario: "Users trigger a TODO branch and get errors or empty states.",
    affectedAudience: "users",
    fixDifficulty: "medium",
    priority: 5,
    readinessCategory: "Maintainability",
  },
  "auditor-env-undocumented": {
    businessImpact: "Deploy fails or runs with wrong configuration.",
    productionScenario: "Missing STRIPE_SECRET_KEY in prod → all payments fail at launch.",
    affectedAudience: "business",
    fixDifficulty: "easy",
    priority: 2,
    readinessCategory: "Environment setup",
  },
  "auditor-env-gap": {
    businessImpact: "Partial env documentation causes config mistakes.",
    productionScenario:
      "New env var added in code but not documented — staging works, prod breaks.",
    affectedAudience: "team",
    fixDifficulty: "easy",
    priority: 4,
    readinessCategory: "Environment setup",
  },
  "auditor-stripe-webhook": {
    businessImpact: "Payment fraud — fake events could grant access without payment.",
    productionScenario: "Attacker POSTs to your webhook URL and activates premium plans for free.",
    affectedAudience: "business",
    fixDifficulty: "medium",
    priority: 1,
  },
  "auditor-api-validation": {
    businessImpact: "Malformed requests crash APIs or corrupt data.",
    productionScenario: "Bad JSON payload causes 500 errors for all clients.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 3,
    readinessCategory: "API reliability",
  },
  "auditor-auth-routes": {
    businessImpact: "Private dashboards may be publicly accessible.",
    productionScenario: "Unauthenticated visitor opens /dashboard and sees another user's data.",
    affectedAudience: "users",
    fixDifficulty: "medium",
    priority: 1,
  },
  "auditor-prisma-migrations": {
    businessImpact: "Database schema out of sync with application code.",
    productionScenario: "Deploy succeeds but queries fail because prod DB never migrated.",
    affectedAudience: "customers",
    fixDifficulty: "medium",
    priority: 2,
    readinessCategory: "Database/migration safety",
  },
  "auditor-localhost-api": {
    businessImpact: "Production frontend cannot reach the API.",
    productionScenario: "Every user sees network errors because the app calls localhost:3000.",
    affectedAudience: "users",
    fixDifficulty: "easy",
    priority: 2,
    readinessCategory: "Frontend UX basics",
  },
};

const AUTO_FIXABLE = new Set([
  "github-actions",
  "workflow-permissions",
  "workflow-unpinned-action",
  "docker-root-user",
  "ci-ai",
  "env-example",
  "env-example-ai",
  "readme",
  "readme-ai",
  "vitest-ai",
  "playwright-ai",
  "api-tests",
  "eslint",
  "prettier",
  "dockerfile",
  "monitoring",
  "error-boundary",
  "helmet",
  "rate-limit",
  "logger",
  "security-cookie-flags",
  "https-redirect",
  "gitignore-env",
  "ts-strict",
  "health-check",
  "cors",
  "db-pool",
  "dependency-audit-ci",
  "pytest",
  "ruff",
  "rspec",
  "rubocop",
  "golangci-lint",
  "phpunit",
  "phpcs",
  "checkstyle",
  "credo",
]);

/** Current fix eligibility — ignores stale auto_fixable values stored on old scans. */
export function isAutoFixableFixId(fixId: string): boolean {
  if (!fixId) return false;
  if (fixId.startsWith("auditor-")) return true;
  // Template vitest only — use *-ai fixes for real generated tests.
  if (fixId === "vitest") return false;
  return AUTO_FIXABLE.has(fixId) || AI_FIX_IDS.has(fixId);
}

/**
 * Severity calibration: no Critical without High confidence. Critical blocks launches via the
 * verdict, so a finding that might be wrong (confidence < high) is capped at High severity here,
 * centrally — checks cannot inflate past it. Findings without a confidence value are legacy
 * checks whose evidence is direct (file present/absent), so they keep their declared severity.
 */
function calibrateSeverity(issue: IssueInput): IssueInput["severity"] {
  if (issue.severity === "critical" && issue.confidence && issue.confidence !== "high") {
    return "high";
  }
  return issue.severity;
}

export function enrichFinding(
  issue: IssueInput,
  opts?: { source?: ReadinessFinding["source"]; fixPackId?: string },
): ReadinessFinding {
  const meta = FIX_META[issue.fixId] ?? AUDITOR_META[issue.fixId];
  const isAuditor = issue.fixId.startsWith("auditor-");
  const readinessCategory = meta?.readinessCategory ?? toReadinessCategory(issue.category);
  const severity = calibrateSeverity(issue);
  const riskLevel: RiskLevel = RISK_FROM_SEVERITY[severity] ?? "medium";

  return {
    ...issue,
    severity,
    category: readinessCategory,
    readinessCategory,
    riskLevel,
    businessImpact: meta?.businessImpact ?? issue.why,
    productionScenario:
      meta?.productionScenario ??
      "This gap may cause unexpected failures when real users hit production.",
    affectedAudience: meta?.affectedAudience ?? "team",
    fixDifficulty: meta?.fixDifficulty ?? "medium",
    priority: meta?.priority ?? (severity === "critical" ? 1 : severity === "high" ? 3 : 6),
    autoFixable: isAutoFixableFixId(issue.fixId),
    source: opts?.source ?? (isAuditor ? "auditor" : "rule"),
    fixPackId: opts?.fixPackId,
  };
}

/**
 * Fixes that still work when the app is *not* at the repository root.
 *
 * The fix executor writes generated files to hardcoded repo-root paths and has no concept of an
 * app directory (`rootDir` is honoured by the sandbox only). Auditing the handlers shows this is
 * near-universal, not occasional — `Dockerfile`, `health.py`, `middleware/rate_limit.py`,
 * `internal/health/handler.go`, `playwright.config.ts`, `e2e/home.spec.ts`, `src/lib/db.ts` are
 * all constants. For an app in `backend/`, each of those lands next to nothing and the pull
 * request cannot work.
 *
 * So this is an allowlist, not a blocklist: enumerate the few outputs that are genuinely correct
 * at the repository root and withhold everything else. A blocklist has to be right about every
 * handler that exists now and every one added later; getting it wrong charges a user for a
 * broken PR. Withholding a fix costs them a manual edit, which is the cheaper mistake.
 *
 * The findings themselves stay visible — the user still learns what to fix.
 */
const ROOT_SAFE_FIX_IDS = new Set([
  // `.github/workflows/` belongs at the repository root in a monorepo too, and the CI
  // generators receive workspace-package intelligence when building their steps.
  "github-actions",
  "ci-ai",
  "dependency-audit-ci",
  // A README and a .env.example describe the repository, so the root copy is the right one.
  "readme",
  "readme-ai",
  "env-example",
  "env-example-ai",
  "auditor-env-undocumented",
  "auditor-env-gap",
  // .gitignore is honoured recursively from the root.
  "gitignore-env",
]);

/** True when this fix would write to a repo-root path that misses a subdirectory app. */
export function isPathSensitiveFixId(fixId: string): boolean {
  return !ROOT_SAFE_FIX_IDS.has(fixId);
}

export interface EnrichOptions {
  /**
   * True when the scan was rebased onto a subdirectory.
   *
   * No longer suppresses anything: the fix executor resolves the same app directory and writes
   * generated files beneath it (`collectFixFiles` → `placeGeneratedFile`), so a Dockerfile for
   * an app in `backend/` is committed to `backend/Dockerfile`. Kept on the options object
   * because the scan knows this fact and a future fix may legitimately need to gate on it.
   */
  appInSubdirectory?: boolean;
}

export function enrichFindings(
  issues: IssueInput[],
  _opts: EnrichOptions = {},
): ReadinessFinding[] {
  return issues.map((i) => enrichFinding(i));
}
