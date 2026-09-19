import type { ProjectLanguage } from "./project-context.server";

/** AI unit-test fix per backend language. */
export const LANGUAGE_UNIT_TEST_AI: Partial<Record<ProjectLanguage, string>> = {
  python: "pytest-ai",
  go: "go-test-ai",
  ruby: "rspec-ai",
  php: "phpunit-ai",
  java: "junit-ai",
  rust: "cargo-test-ai",
  csharp: "xunit-ai",
  elixir: "exunit-ai",
  dart: "dart-test-ai",
  swift: "swift-test-ai",
  kotlin: "kotlin-test-ai",
};

export const LANGUAGE_AI_TEST_IDS = new Set([
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

export function languageUnitTestAiFix(language: ProjectLanguage): string | null {
  return LANGUAGE_UNIT_TEST_AI[language] ?? null;
}

export function isLanguageAiTestFix(fixId: string): boolean {
  return LANGUAGE_AI_TEST_IDS.has(fixId);
}

/**
 * Fixes whose whole output is a test suite — Node's included, not just the per-language ones.
 *
 * These are the fixes where "the project still builds" proves nothing about what we generated.
 * `verifyBeforePr` skips the test step by default (it is a repo-level opt-in, because running a
 * stranger's test suite is slow and can need services), which meant a generated test file could
 * reach a pull request having never been executed once. When a job produces tests, running them
 * is the only verification that means anything,
 * so the test step is forced on for that job regardless of the repo setting.
 */
const TEST_PRODUCING_FIX_IDS = new Set([
  ...LANGUAGE_AI_TEST_IDS,
  "vitest-ai",
  "playwright-ai",
  "api-tests",
  "vitest",
  "playwright",
  "pytest",
  "rspec",
  "phpunit",
]);

export function producesTests(fixIds: readonly string[]): boolean {
  return fixIds.some((id) => TEST_PRODUCING_FIX_IDS.has(id));
}
