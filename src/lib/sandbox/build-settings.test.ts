import { describe, expect, it } from "vitest";
import {
  normalizeBuildCommand,
  normalizeNodeVersion,
  normalizeRootDir,
  repoPath,
} from "./build-settings";

describe("normalizeRootDir", () => {
  it("treats blank, '.', and '/' as the repo root", () => {
    expect(normalizeRootDir("")).toBeNull();
    expect(normalizeRootDir("   ")).toBeNull();
    expect(normalizeRootDir(".")).toBeNull();
    expect(normalizeRootDir("/")).toBeNull();
    expect(normalizeRootDir(null)).toBeNull();
  });

  it("strips surrounding slashes and a leading ./", () => {
    expect(normalizeRootDir("apps/web")).toBe("apps/web");
    expect(normalizeRootDir("/apps/web/")).toBe("apps/web");
    expect(normalizeRootDir("./apps/web")).toBe("apps/web");
    expect(normalizeRootDir("  packages/my-app  ")).toBe("packages/my-app");
  });

  it("refuses to escape the repository", () => {
    expect(() => normalizeRootDir("../secrets")).toThrow(/\.\./);
    expect(() => normalizeRootDir("apps/../../etc")).toThrow(/\.\./);
  });

  it("refuses shell metacharacters and spaces", () => {
    expect(() => normalizeRootDir("apps; rm -rf /")).toThrow(/Invalid root directory/);
    expect(() => normalizeRootDir("apps/$(whoami)")).toThrow(/Invalid root directory/);
    expect(() => normalizeRootDir("my app")).toThrow(/Invalid root directory/);
    expect(() => normalizeRootDir("apps\\web")).toThrow(/Invalid root directory/);
  });

  it("rejects an absurdly long path", () => {
    expect(() => normalizeRootDir("a".repeat(201))).toThrow(/too long/);
  });
});

describe("normalizeBuildCommand", () => {
  it("keeps a normal command and nulls a blank one", () => {
    expect(normalizeBuildCommand("npm run build:prod")).toBe("npm run build:prod");
    expect(normalizeBuildCommand("  ")).toBeNull();
    expect(normalizeBuildCommand(null)).toBeNull();
  });

  it("rejects multi-line input so extra steps can't ride along", () => {
    expect(() => normalizeBuildCommand("npm run build\nrm -rf /")).toThrow(/single line/);
    expect(() => normalizeBuildCommand("npm run build\r\nwhoami")).toThrow(/single line/);
  });

  it("rejects an over-long command", () => {
    expect(() => normalizeBuildCommand("x".repeat(501))).toThrow(/too long/);
  });
});

describe("normalizeNodeVersion", () => {
  it("accepts bare major, major.minor, and full versions", () => {
    expect(normalizeNodeVersion("22")).toBe("22");
    expect(normalizeNodeVersion("v22")).toBe("22");
    expect(normalizeNodeVersion("22.13")).toBe("22.13");
    expect(normalizeNodeVersion(" v22.13.0 ")).toBe("22.13.0");
    expect(normalizeNodeVersion("")).toBeNull();
    expect(normalizeNodeVersion(null)).toBeNull();
  });

  it("rejects ranges and anything shell-shaped", () => {
    expect(() => normalizeNodeVersion(">=22.13.0")).toThrow(/must look like/);
    expect(() => normalizeNodeVersion("lts/hydrogen")).toThrow(/must look like/);
    expect(() => normalizeNodeVersion("22; rm -rf /")).toThrow(/must look like/);
  });
});

describe("repoPath", () => {
  it("resolves against the root directory when there is one", () => {
    expect(repoPath("apps/web", "package.json")).toBe("apps/web/package.json");
    expect(repoPath(null, "package.json")).toBe("package.json");
  });
});
