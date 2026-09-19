import { describe, expect, it } from "vitest";
import {
  buildRecoveryFileSet,
  classifyTier,
  contentSimilarity,
  driftFromSimilarity,
  extractFailingPath,
  hashFileContent,
  isLockfileCiError,
  isDeterministicCiPatch,
  needsCiInstallRelax,
  matchErrorPattern,
  relaxCiInstallCommand,
  resolveOffer,
  type GeneratedFileRecord,
} from "./fix-recovery.server";

const CI_RECORD: GeneratedFileRecord = {
  path: ".github/workflows/ci.yml",
  hash: "abc",
  content: `name: CI
jobs:
  ci:
    steps:
      - uses: actions/checkout@v4
      - name: Install dependencies
        run: npm ci
`,
};

const PM_DETECT_CI: GeneratedFileRecord = {
  path: ".github/workflows/ci.yml",
  hash: "def",
  content: `name: CI
jobs:
  ci:
    steps:
      - id: pm
        run: |
          echo "install=npm ci" >> $GITHUB_OUTPUT
      - run: \${{ steps.pm.outputs.install }}
`,
};

describe("needsCiInstallRelax", () => {
  it("is true when deps change, repo has lockfile, PR does not", () => {
    expect(
      needsCiInstallRelax(
        ["package.json", "package-lock.json", ".github/workflows/ci.yml"],
        ["package.json", "playwright.config.ts"],
      ),
    ).toBe(true);
  });

  it("is false when lockfile is included in the PR", () => {
    expect(needsCiInstallRelax(["package-lock.json"], ["package.json", "package-lock.json"])).toBe(
      false,
    );
  });

  it("applies for yarn.lock repos without lockfile in PR", () => {
    expect(
      needsCiInstallRelax(
        ["package.json", "yarn.lock", ".github/workflows/ci.yml"],
        ["package.json"],
      ),
    ).toBe(true);
  });

  it("applies for Gemfile changes without Gemfile.lock in PR", () => {
    expect(
      needsCiInstallRelax(
        ["Gemfile", "Gemfile.lock", ".github/workflows/ci.yml"],
        ["Gemfile", "config/initializers/sentry.rb"],
      ),
    ).toBe(true);
  });

  it("applies for go.mod changes without go.sum in PR", () => {
    expect(
      needsCiInstallRelax(["go.mod", "go.sum"], ["go.mod", "internal/middleware/middleware.go"]),
    ).toBe(true);
  });
});

describe("buildRecoveryFileSet", () => {
  it("merges patch and relaxes all workflow install commands", () => {
    const files = buildRecoveryFileSet(
      [
        { path: "e2e/foo.spec.ts", hash: "a", content: "test" },
        { path: ".github/workflows/ci.yml", hash: "b", content: "run: npm ci\n" },
      ],
      { path: ".github/workflows/ci.yml", content: "run: npm install\n" },
    );
    expect(files.find((f) => f.path === "e2e/foo.spec.ts")?.content).toBe("test");
    expect(files.find((f) => f.path === ".github/workflows/ci.yml")?.content).toContain(
      "npm install",
    );
  });
});

describe("classifyTier", () => {
  it("classifies CI workflow as tier 1", () => {
    expect(classifyTier(".github/workflows/ci.yml")).toBe(1);
  });

  it("classifies .env.example as tier 2", () => {
    expect(classifyTier(".env.example")).toBe(2);
  });

  it("classifies src files as tier 3", () => {
    expect(classifyTier("src/middleware.ts")).toBe(3);
  });
});

describe("matchErrorPattern", () => {
  it("matches npm ci lockfile errors with CI patch", () => {
    const result = matchErrorPattern("npm ci\nnpm ERR! lockfile", [CI_RECORD]);
    expect(result?.errorSignature).toBe("npm-ci-lockfile");
    expect(result?.resolutionType).toBe("patch");
    expect(result?.patch?.content).toContain("npm install");
  });

  it("matches lockfile sync errors with CI patch", () => {
    const result = matchErrorPattern(
      "npm ci\nnpm ERR! `npm ci` can only install packages when your package.json and package-lock.json are in sync. Missing: @playwright/test@1.61.1 from lock file",
      [CI_RECORD],
    );
    expect(result?.errorSignature).toBe("npm-ci-lockfile-sync");
    expect(result?.resolutionType).toBe("patch");
    expect(result?.patch?.content).toContain("npm install");
  });

  it("matches playwright lockfile summary text with CI patch", () => {
    const result = matchErrorPattern(
      "package.json references playwright as a devDependency or script, but the lockfile is out of sync (missing or outdated entries), causing CI to fail.",
      [CI_RECORD],
    );
    expect(result?.errorSignature).toBe("npm-ci-lockfile-sync");
    expect(result?.patch?.content).toContain("npm install");
  });

  it("relaxes pm-detect echo install=npm ci", () => {
    const result = matchErrorPattern("lockfile is out of sync with package.json", [PM_DETECT_CI]);
    expect(result?.patch?.content).toContain('echo "install=npm install"');
  });

  it("matches corepack yarn errors with CI patch", () => {
    const result = matchErrorPattern("Error: corepack must be enabled for yarn@4", [CI_RECORD]);
    expect(result?.errorSignature).toBe("corepack-yarn");
    expect(result?.patch?.path).toBe(".github/workflows/ci.yml");
    expect(result?.patch?.content).toContain("corepack enable");
  });

  it("matches npm test placeholder", () => {
    const result = matchErrorPattern("npm test\nError: no test specified\nexit code 1", [
      CI_RECORD,
    ]);
    expect(result?.errorSignature).toBe("npm-test-placeholder");
  });
});

describe("drift detection", () => {
  it("returns pristine for identical content", () => {
    expect(contentSimilarity("a\nb\nc", "a\nb\nc")).toBe(1);
    expect(driftFromSimilarity(1)).toBe("pristine");
  });

  it("returns heavy for very different content", () => {
    expect(driftFromSimilarity(0.2)).toBe("heavy");
  });

  it("hashes content deterministically", () => {
    expect(hashFileContent("hello")).toBe(hashFileContent("hello"));
    expect(hashFileContent("hello")).not.toBe(hashFileContent("world"));
  });
});

describe("resolveOffer", () => {
  it("offers auto patch for tier 1 pristine", () => {
    const offer = resolveOffer(1, "pristine", true, false);
    expect(offer.patchOffer).toBe("auto");
  });

  it("still offers lockfile patch on heavy drift", () => {
    const offer = resolveOffer(1, "heavy", true, false, "npm-ci-lockfile-sync");
    expect(offer.patchOffer).toBe("auto");
    expect(offer.resolutionType).toBe("suggested");
  });

  it("never escalates deterministic CI patches", () => {
    const offer = resolveOffer(1, "pristine", true, true, "npm-ci-lockfile-sync");
    expect(offer.patchOffer).toBe("auto");
    expect(offer.resolutionType).toBe("suggested");
  });

  it("diagnoses only for tier 1 heavy drift without lockfile signature", () => {
    const offer = resolveOffer(1, "heavy", true, false);
    expect(offer.patchOffer).toBeNull();
    expect(offer.resolutionType).toBe("diagnosis");
  });

  it("escalates after max attempts for non-deterministic fixes", () => {
    const offer = resolveOffer(1, "pristine", true, true);
    expect(offer.resolutionType).toBe("escalated");
  });
});

describe("isDeterministicCiPatch", () => {
  it("includes lockfile signatures", () => {
    expect(isDeterministicCiPatch("npm-ci-lockfile-sync")).toBe(true);
    expect(isDeterministicCiPatch("ai")).toBe(false);
  });
});

describe("isLockfileCiError", () => {
  it("detects playwright lockfile summaries", () => {
    expect(
      isLockfileCiError(
        "package.json references playwright as a devDependency but the lockfile is out of sync",
      ),
    ).toBe(true);
  });
});

describe("relaxCiInstallCommand", () => {
  it("rewrites echo install=npm ci", () => {
    expect(relaxCiInstallCommand('echo "install=npm ci" >> $GITHUB_OUTPUT')).toContain(
      "install=npm install",
    );
  });

  it("relaxes composer install for PHP", () => {
    expect(relaxCiInstallCommand("run: composer install --no-interaction")).toContain(
      "composer update",
    );
  });

  it("relaxes bundler-cache for Ruby", () => {
    expect(relaxCiInstallCommand("bundler-cache: true")).toContain("bundler-cache: false");
  });

  it("prepends go mod tidy for Go test steps", () => {
    expect(relaxCiInstallCommand("run: go test ./...")).toContain("go mod tidy");
  });
});

describe("extractFailingPath", () => {
  it("finds workflow path in error log", () => {
    expect(
      extractFailingPath("Error in .github/workflows/ci.yml line 10", [
        ".github/workflows/ci.yml",
        "README.md",
      ]),
    ).toBe(".github/workflows/ci.yml");
  });
});
