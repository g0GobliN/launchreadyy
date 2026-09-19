import { describe, expect, it } from "vitest";
import { filterSafeFiles, isSafeAgentPath, isSafeRepoPath } from "./safe-paths";

describe("isSafeRepoPath", () => {
  it("accepts ordinary repo-relative paths", () => {
    for (const p of [
      "src/index.ts",
      "package.json",
      ".github/workflows/ci.yml", // templates legitimately write this
      "apps/web/src/routes/index.tsx",
      "Dockerfile",
      ".gitignore",
      "docs/a-b_c.1.md",
    ]) {
      expect(isSafeRepoPath(p), p).toBe(true);
    }
  });

  it("rejects directory traversal", () => {
    for (const p of ["../etc/passwd", "src/../../x", "a/b/../../../c", ".."]) {
      expect(isSafeRepoPath(p), p).toBe(false);
    }
  });

  it("rejects absolute, UNC and drive-letter paths", () => {
    for (const p of ["/etc/passwd", "//host/share/x", "C:/Windows/x", "c:\\temp\\x"]) {
      expect(isSafeRepoPath(p), p).toBe(false);
    }
  });

  it("rejects percent-encoded traversal", () => {
    for (const p of ["%2e%2e/x", "a/%2E%2E/b", "a%2Fb"]) {
      expect(isSafeRepoPath(p), p).toBe(false);
    }
  });

  it("rejects writes into git metadata", () => {
    for (const p of [".git/config", ".git/hooks/pre-commit", ".GIT/config"]) {
      expect(isSafeRepoPath(p), p).toBe(false);
    }
  });

  it("rejects control characters and NUL truncation tricks", () => {
    expect(isSafeRepoPath("src/a\u0000.ts")).toBe(false);
    expect(isSafeRepoPath("src/a\n.ts")).toBe(false);
    expect(isSafeRepoPath("src/a\u007f.ts")).toBe(false);
  });

  it("rejects malformed segments", () => {
    for (const p of ["", "a//b", "a/ b /c", "src/", "/src", "./x"]) {
      expect(isSafeRepoPath(p), p).toBe(false);
    }
  });

  it("rejects non-strings and over-long paths", () => {
    expect(isSafeRepoPath(undefined)).toBe(false);
    expect(isSafeRepoPath(42)).toBe(false);
    expect(isSafeRepoPath("a".repeat(1025))).toBe(false);
    expect(isSafeRepoPath(`src/${"a".repeat(256)}.ts`)).toBe(false);
  });
});

describe("isSafeAgentPath", () => {
  it("accepts ordinary source and test files", () => {
    for (const p of ["src/app.ts", "src/app.test.ts", "package.json", "README.md"]) {
      expect(isSafeAgentPath(p), p).toBe(true);
    }
  });

  it("blocks .github/ — workflows execute in CI with repository secrets", () => {
    for (const p of [
      ".github/workflows/ci.yml",
      ".github/workflows/deploy.yaml",
      ".github/actions/x/action.yml",
      ".github/CODEOWNERS",
      ".github/dependabot.yml",
    ]) {
      expect(isSafeAgentPath(p), p).toBe(false);
    }
  });

  it("blocks install-time and package-resolution config", () => {
    for (const p of [".npmrc", ".yarnrc.yml", ".pnpmfile.cjs", ".gitattributes", ".gitmodules"]) {
      expect(isSafeAgentPath(p), p).toBe(false);
    }
  });

  it("blocks a root CODEOWNERS but not a doc that merely mentions it", () => {
    expect(isSafeAgentPath("CODEOWNERS")).toBe(false);
    expect(isSafeAgentPath("docs/codeowners-guide.md")).toBe(true);
  });

  it("still applies the structural rules", () => {
    expect(isSafeAgentPath("../x")).toBe(false);
    expect(isSafeAgentPath(".git/config")).toBe(false);
  });
});

describe("filterSafeFiles", () => {
  it("keeps safe files and reports rejects", () => {
    const { safe, rejected } = filterSafeFiles(
      [
        { path: "src/a.ts", content: "a" },
        { path: "../evil", content: "b" },
        { path: "src/b.ts", content: "c" },
      ],
      "repo",
    );
    expect(safe.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(rejected).toEqual(["../evil"]);
  });

  it("agent mode drops workflow files that repo mode would keep", () => {
    const files = [{ path: ".github/workflows/ci.yml", content: "on: push" }];
    expect(filterSafeFiles(files, "repo").safe).toHaveLength(1);
    expect(filterSafeFiles(files, "agent").safe).toHaveLength(0);
  });
});
