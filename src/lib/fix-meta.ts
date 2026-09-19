import type { RiskLevel } from "./readiness/types";

/**
 * Fix metadata shared by the fix UI and the job runner.
 *
 * This is product knowledge about how risky/expensive each remediation is — it has
 * "Cost" here means an estimate of AI generation effort
 * so the UI can warn before a long-running multi-file fix.
 */
export type FixEffortTier = "trivial" | "low" | "medium" | "high" | "ai";

/** Always free — polish fixes with negligible generation cost. */
export const TRIVIAL_FIX_IDS = new Set([
  "prettier",
  "rubocop",
  "ruff",
  "golangci-lint",
  "phpcs",
  "checkstyle",
  "credo",
]);

/** Default launch risk when scan metadata is unavailable. */
export const FIX_DEFAULT_RISK: Record<string, RiskLevel> = {
  "github-actions": "blocker",
  "gitignore-env": "blocker",
  "dependency-audit-ci": "medium",
  // Deterministic edits to files the repo already has — no AI call, but each one still needs a
  // sandbox build to prove it did not break the image or the pipeline.
  "workflow-permissions": "medium",
  "workflow-unpinned-action": "medium",
  "docker-root-user": "medium",
  "env-example": "high",
  "env-example-ai": "high",
  vitest: "high",
  monitoring: "high",
  "health-check": "medium",
  helmet: "high",
  "rate-limit": "high",
  cors: "high",
  "security-cookie-flags": "high",
  "https-redirect": "high",
  "db-pool": "high",
  "api-tests": "high",
  pytest: "high",
  rspec: "high",
  phpunit: "high",
  readme: "medium",
  eslint: "medium",
  dockerfile: "medium",
  "error-boundary": "medium",
  logger: "medium",
  "ts-strict": "medium",
  prettier: "low",
  "auditor-stripe-webhook": "blocker",
  "auditor-env-undocumented": "medium",
  "auditor-env-gap": "medium",
  "auditor-api-validation": "high",
  "auditor-auth-routes": "high",
  "auditor-prisma-migrations": "medium",
  "auditor-localhost-api": "medium",
};

const SEVERITY_TO_RISK: Record<string, RiskLevel> = {
  critical: "blocker",
  high: "high",
  medium: "medium",
  low: "low",
};

/** Fixes that require an AI provider to be configured. */
export const AI_FIX_IDS = new Set([
  "auditor-todo-markers",
  "auditor-api-validation",
  "auditor-auth-routes",
  "auditor-prisma-migrations",
  "auditor-localhost-api",
  "ci-ai",
  "readme-ai",
  "env-example-ai",
  "vitest-ai",
  "playwright-ai",
  "api-tests",
  "pytest-ai",
  "go-test-ai",
  "rspec-ai",
  "phpunit-ai",
  "junit-ai",
  "cargo-test-ai",
  "xunit-ai",
  "exunit-ai",
  "dart-test-ai",
  "swift-test-ai",
  "kotlin-test-ai",
]);

/**
 * Relative AI generation effort per AI fix. Used to estimate how long a batch of
 * fixes will take and to warn about heavy selections.
 */
export const AI_FIX_EFFORT: Record<string, number> = {
  "auditor-todo-markers": 3,
  "auditor-api-validation": 3,
  "auditor-auth-routes": 3,
  "auditor-prisma-migrations": 2,
  "auditor-localhost-api": 2,
  "ci-ai": 2,
  "readme-ai": 2,
  "env-example-ai": 1,
  "vitest-ai": 3,
  "playwright-ai": 4,
  "api-tests": 4,
  "pytest-ai": 3,
  "go-test-ai": 3,
  "rspec-ai": 3,
  "phpunit-ai": 3,
  "junit-ai": 3,
  "cargo-test-ai": 3,
  "xunit-ai": 3,
  "exunit-ai": 3,
  "dart-test-ai": 3,
  "swift-test-ai": 3,
  "kotlin-test-ai": 3,
};

/** Deterministic fixes — no AI placeholders, no mock diffs on the client. */
export const DETERMINISTIC_AUDITOR_FIX_IDS = new Set(["auditor-stripe-webhook"]);

/** Relative AI effort for the architecture analysis pass. */
export const ARCH_SCAN_COST = 3;

/** Largest wall-clock budget a sandbox verification may use (ms). */
export const SANDBOX_TIMEOUT_MS = 210_000;

/** Wall-clock budget for a sandbox run (Community: single generous ceiling). */
export function sandboxTimeoutMs(): number {
  return SANDBOX_TIMEOUT_MS;
}

export function getFixEffortTier(fixId: string, riskLevel?: RiskLevel): FixEffortTier {
  if (TRIVIAL_FIX_IDS.has(fixId)) return "trivial";
  if (DETERMINISTIC_AUDITOR_FIX_IDS.has(fixId)) return "trivial";
  if (AI_FIX_IDS.has(fixId)) return "ai";
  const risk = riskLevel ?? FIX_DEFAULT_RISK[fixId] ?? "medium";
  if (risk === "low") return "low";
  if (risk === "medium") return "medium";
  return "high";
}

export function buildFixRiskMap(
  issues: Array<{ fixId: string; riskLevel?: RiskLevel; severity?: string }>,
): Record<string, RiskLevel> {
  const map: Record<string, RiskLevel> = {};
  for (const issue of issues) {
    if (!issue.fixId) continue;
    map[issue.fixId] =
      issue.riskLevel ??
      (issue.severity ? SEVERITY_TO_RISK[issue.severity] : undefined) ??
      FIX_DEFAULT_RISK[issue.fixId] ??
      "medium";
  }
  return map;
}

/** True when any selected fix needs an AI provider. */
export function selectionNeedsAi(fixIds: string[]): boolean {
  return fixIds.some((id) => AI_FIX_IDS.has(id));
}

/** UI label for a fix's effort tier. */
export function formatFixEffort(
  fixId: string,
  riskLevel?: import("./readiness/types").RiskLevel,
): string {
  const tier = getFixEffortTier(fixId, riskLevel);
  switch (tier) {
    case "trivial":
      return "One-click fix";
    case "low":
      return "Quick fix";
    case "medium":
      return "Fix";
    case "high":
      return "Heavier fix";
    case "ai":
      return "AI fix";
  }
}

/** Convenience wrappers used by list UIs. */
export const getFixEffortLabel = formatFixEffort;
export const formatFixEffortLabel = formatFixEffort;
