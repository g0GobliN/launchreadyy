import { describe, expect, it } from "vitest";
import { githubContentsPath, githubHeadRefPath } from "./github.server";

describe("githubContentsPath", () => {
  it("keeps slashes as URL path segments", () => {
    expect(githubContentsPath(".github/workflows/ci.yml")).toBe(".github/workflows/ci.yml");
  });

  it("encodes special characters per segment", () => {
    expect(githubContentsPath("src/foo bar/baz.txt")).toBe("src/foo%20bar/baz.txt");
  });

  it("strips leading slashes", () => {
    expect(githubContentsPath("/README.md")).toBe("README.md");
  });
});

describe("githubHeadRefPath", () => {
  it("encodes slashes in branch names", () => {
    expect(githubHeadRefPath("o/r", "launchreadyy/fix-abc12345")).toBe(
      "/repos/o/r/git/refs/heads%2Flaunchreadyy%2Ffix-abc12345",
    );
  });

  it("handles hyphenated branch names", () => {
    expect(githubHeadRefPath("o/r", "launchreadyy-fix-abc12345")).toBe(
      "/repos/o/r/git/refs/heads%2Flaunchreadyy-fix-abc12345",
    );
  });
});
