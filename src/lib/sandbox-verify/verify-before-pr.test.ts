import { describe, expect, it } from "vitest";
import { buildOverlayTree } from "./verify-before-pr";
import { detectSandboxCommands } from "../sandbox/commands";

/** Reads from a fake repo so the tree builder can be exercised without GitHub. */
function providerOf(repo: Record<string, string>) {
  return { readFile: async (p: string) => repo[p] ?? null };
}

describe("buildOverlayTree", () => {
  it("prefers overlay content over what is committed", async () => {
    const files = await buildOverlayTree(
      providerOf({ "package.json": '{"name":"old"}' }),
      ["package.json"],
      [{ path: "package.json", content: '{"name":"new"}' }],
    );
    expect(files["package.json"]).toBe('{"name":"new"}');
  });

  it("always pulls the root manifests even when untouched", async () => {
    const files = await buildOverlayTree(
      providerOf({ "package.json": "{}", "package-lock.json": "{}", "tsconfig.json": "{}" }),
      ["package.json", "package-lock.json", "tsconfig.json"],
      [{ path: "src/new.ts", content: "export {};" }],
    );
    expect(Object.keys(files).sort()).toContain("package-lock.json");
    expect(Object.keys(files).sort()).toContain("tsconfig.json");
  });

  /**
   * Not a regression — the previous version happened to pick these up through its generic
   * "any .json under 150 files" sweep. That was incidental: a large repo that exhausted the cap
   * first, or a manifest without a .json extension, would have lost them. Requesting the app's
   * manifests explicitly makes the guarantee real rather than a side effect, and pins it.
   */
  it("pulls the app manifest too when the repo has a rootDir", async () => {
    const repo = {
      "package.json": '{"private":true,"workspaces":["apps/*"]}',
      "package-lock.json": "{}",
      "apps/web/package.json": '{"scripts":{"build":"next build"}}',
      "apps/web/tsconfig.json": "{}",
    };
    const files = await buildOverlayTree(providerOf(repo), Object.keys(repo), [], "apps/web");
    expect(files["apps/web/package.json"]).toContain("next build");
    expect(files["apps/web/tsconfig.json"]).toBe("{}");
    // The root lockfile still comes along — install follows the lockfile, not the app.
    expect(files["package-lock.json"]).toBe("{}");
  });

  it("skips paths the repo does not have", async () => {
    const files = await buildOverlayTree(
      providerOf({ "package.json": "{}" }),
      ["package.json"],
      [],
    );
    expect(files["pnpm-lock.yaml"]).toBeUndefined();
  });
});

/**
 * verify-before-pr previously built its commands without the repo's saved build settings, so a
 * monorepo ran install and build at the repo root. That fails, and a failure blocks the PR
 * entirely — so a correct fix never shipped for exactly the repos whose owner had already told
 * the product where the app lives.
 */
describe("command construction honours build settings", () => {
  const filePaths = ["package.json", "package-lock.json", "apps/web/package.json"];

  it("runs build in the app directory when rootDir is set", () => {
    const { commands } = detectSandboxCommands({
      filePaths,
      scripts: { build: "next build" },
      rootDir: "apps/web",
    });
    expect(commands.find((c) => c.step === "build")!.cwd).toBe("apps/web");
  });

  it("keeps install where the lockfile is", () => {
    const { commands } = detectSandboxCommands({
      filePaths,
      scripts: { build: "next build" },
      rootDir: "apps/web",
    });
    // Root lockfile, so install must not be forced into the app directory.
    expect(commands.find((c) => c.step === "install")!.cwd).toBeUndefined();
  });

  it("uses a custom build command when the repo configured one", () => {
    const { commands } = detectSandboxCommands({
      filePaths,
      scripts: { build: "next build" },
      buildCommand: "turbo run build --filter=web",
    });
    expect(commands.find((c) => c.step === "build")!.command).toBe("turbo run build --filter=web");
  });

  it("includes tests when the repo opted in, not only when the run asks", () => {
    // verifyBeforePr computes `input.includeTest === true || buildSettings.includeTest`; this is
    // the case where the run did not ask but the repo has tests switched on.
    const runAsked = false;
    const repoOptedIn = true;
    const { commands } = detectSandboxCommands({
      filePaths,
      scripts: { build: "x", test: "vitest run" },
      includeTest: runAsked || repoOptedIn,
    });
    expect(commands.some((c) => c.step === "test")).toBe(true);
  });
});
