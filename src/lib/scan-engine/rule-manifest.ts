/**
 * Rule → input globs for incremental scanning (v2 Phase 3).
 * `fixId` on findings is used as `ruleId` for carry-forward.
 */

import type { RuleInputSpec } from "./incremental";

/** Default manifest — content-scoped rules vs repo-wide heuristics. */
export const DEFAULT_SCAN_RULE_MANIFEST: RuleInputSpec[] = [
  { ruleId: "security-hardcoded-secret", inputs: ["**/*.{ts,tsx,js,jsx,py,go,rb,php,rs,java,kt}"] },
  { ruleId: "security-secret-heuristic", inputs: ["**/*.{ts,tsx,js,jsx,py,go,rb,php,rs,java,kt}"] },
  { ruleId: "security-unsafe-api", inputs: ["**/*.{ts,tsx,js,jsx,py,rb,php}"] },
  { ruleId: "security-tls-verification", inputs: ["**/*.{ts,tsx,js,jsx,py,go,rb,php}"] },
  { ruleId: "security-weak-random", inputs: ["**/*.{ts,tsx,js,jsx,py,go,php}"] },
  { ruleId: "security-weak-crypto", inputs: ["**/*.{ts,tsx,js,jsx,py,rb,php}"] },
  { ruleId: "security-path-traversal", inputs: ["**/*.{ts,tsx,js,jsx,py,rb,php}"] },
  { ruleId: "security-open-redirect", inputs: ["**/*.{ts,tsx,js,jsx,py,rb}"] },
  { ruleId: "security-nosql-injection", inputs: ["**/*.{ts,tsx,js,jsx}"] },
  { ruleId: "security-auth-guard", inputs: ["**/*.{ts,tsx,js,jsx,py,go,rb,php}"] },
  { ruleId: "helmet", inputs: ["**/package.json", "**/*.{ts,js}"] },
  { ruleId: "cors", inputs: ["**/package.json", "**/*.{ts,js,py,go}"] },
  { ruleId: "rate-limit", inputs: ["**/package.json", "**/*.{ts,js}"] },
  { ruleId: "env-example", inputs: ["**/.env*", "**/package.json"] },
  { ruleId: "env-example-ai", inputs: ["**/.env*", "**/package.json"] },
  { ruleId: "gitignore-env", inputs: ["**/.gitignore", "**/.env*"] },
  { ruleId: "ci-ai", inputs: "repo-wide" },
  { ruleId: "github-actions", inputs: [".github/workflows/**"] },
  { ruleId: "workflow-script-injection", inputs: [".github/workflows/**"] },
  { ruleId: "workflow-pr-target-checkout", inputs: [".github/workflows/**"] },
  { ruleId: "workflow-permissions", inputs: [".github/workflows/**"] },
  { ruleId: "workflow-unpinned-action", inputs: [".github/workflows/**"] },
  { ruleId: "dockerfile", inputs: ["**/Dockerfile*", "**/package.json", "**/go.mod"] },
  { ruleId: "docker-root-user", inputs: ["**/Dockerfile*"] },
  { ruleId: "docker-baked-secret", inputs: ["**/Dockerfile*"] },
  { ruleId: "docker-piped-install", inputs: ["**/Dockerfile*"] },
  { ruleId: "vitest", inputs: ["**/package.json", "**/*.{test,spec}.{ts,tsx,js}"] },
  { ruleId: "vitest-ai", inputs: ["**/package.json", "src/**"] },
  { ruleId: "eslint", inputs: ["**/package.json", "**/.eslintrc*", "**/eslint.config.*"] },
  { ruleId: "ruff", inputs: ["**/pyproject.toml", "**/requirements.txt", "**/*.py"] },
  { ruleId: "golangci-lint", inputs: ["**/go.mod", "**/.golangci.*", "**/*.go"] },
  { ruleId: "rubocop", inputs: ["**/Gemfile", "**/.rubocop*", "**/*.rb"] },
  { ruleId: "phpcs", inputs: ["**/composer.json", "**/*.php"] },
  { ruleId: "checkstyle", inputs: ["**/pom.xml", "**/build.gradle*", "**/*.java"] },
  { ruleId: "credo", inputs: ["**/mix.exs", "**/*.ex", "**/*.exs"] },
  { ruleId: "readme", inputs: ["**/README*"] },
  { ruleId: "readme-ai", inputs: ["**/README*", "**/package.json"] },
  { ruleId: "monitoring", inputs: "repo-wide" },
  { ruleId: "graph-cross-file-auth", inputs: ["**/*.{ts,tsx,js,jsx}"] },
  {
    ruleId: "osv-vuln",
    inputs: ["**/package.json", "**/package-lock.json", "**/go.mod", "**/Cargo.toml"],
  },
  { ruleId: "dependabot-alert", inputs: "repo-wide" },
];

/** Map a finding's fixId to a manifest ruleId (unknown ids treated as repo-wide). */
export function ruleIdForFixId(fixId: string): string {
  return fixId || "unknown";
}
