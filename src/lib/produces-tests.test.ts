/**
 * A job that generates tests must have those tests executed before the PR opens.
 *
 * `verifyBeforePr` skips the test step unless asked, so previously a generated suite could reach
 * a pull request having never run once — the sandbox proved only that the project
 * still built. "It compiles" is not verification of a test suite.
 */
import { describe, it, expect } from "vitest";

import { producesTests } from "./language-test-fixes";

describe("producesTests", () => {
  it("is true for the AI test fixes across languages", () => {
    for (const id of [
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
    ]) {
      expect(producesTests([id]), id).toBe(true);
    }
  });

  it("is true for the template test scaffolds too", () => {
    for (const id of ["vitest", "playwright", "pytest", "rspec", "phpunit"]) {
      expect(producesTests([id]), id).toBe(true);
    }
  });

  it("is false for fixes that generate no tests", () => {
    for (const id of ["dockerfile", "eslint", "readme-ai", "helmet", "ci-ai", "env-example-ai"]) {
      expect(producesTests([id]), id).toBe(false);
    }
  });

  it("is true when a mixed job contains any test fix", () => {
    expect(producesTests(["dockerfile", "readme-ai", "vitest-ai"])).toBe(true);
  });

  it("is false for an empty job", () => {
    expect(producesTests([])).toBe(false);
  });
});
