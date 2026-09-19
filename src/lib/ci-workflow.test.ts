import { describe, expect, it } from "vitest";
import { ciWorkflow, parsePackageManagerVersion } from "./fix-executor.server";

describe("parsePackageManagerVersion", () => {
  it("extracts pnpm version from packageManager field", () => {
    expect(parsePackageManagerVersion("pnpm@9.1.0", "pnpm")).toBe("9.1.0");
  });

  it("returns undefined when packageManager is missing or mismatched", () => {
    expect(parsePackageManagerVersion(undefined, "pnpm")).toBeUndefined();
    expect(parsePackageManagerVersion("yarn@4.0.0", "pnpm")).toBeUndefined();
  });
});

describe("ciWorkflow", () => {
  const workflow = ciWorkflow("20");

  it("includes corepack enable for Yarn Berry detection", () => {
    expect(workflow).toContain('echo "berry=true"');
    expect(workflow).toContain("if: steps.pm.outputs.berry == 'true'");
    expect(workflow).toContain("name: Enable Corepack");
    expect(workflow).toContain("run: corepack enable");
    expect(workflow).toContain("yarn install");
  });

  it("uses yarn install for Yarn Classic", () => {
    expect(workflow).toContain("yarn install");
    expect(workflow).toContain('echo "berry=false"');
  });

  it("uses commonjs mode for script detection on node projects", () => {
    expect(workflow).toContain('echo "detect=node --input-type=commonjs"');
  });

  it("uses bun for script detection on bun projects", () => {
    expect(workflow).toContain('echo "detect=bun"');
    expect(workflow).toContain("${{ steps.pm.outputs.detect }} -e");
    expect(workflow).not.toContain("--if-present");
  });

  it("uses uniform script detection for lint", () => {
    expect(workflow).toContain(
      "${{ steps.pm.outputs.detect }} -e \"process.exit(require('./package.json').scripts?.lint ? 0 : 1)\"",
    );
    expect(workflow).toContain("${{ steps.pm.outputs.run }} lint");
  });

  it("skips npm default placeholder test script", () => {
    expect(workflow).toContain("/no test specified/i.test(t)");
  });

  it("pins pnpm version when provided", () => {
    const withPnpm = ciWorkflow("18", "8.15.0");
    expect(withPnpm).toContain("version: 8.15.0");
  });

  it("uses a stable pnpm major when the repo does not provide one", () => {
    const pnpmBlock =
      workflow.match(/pnpm\/action-setup@v4[\s\S]*?(?=\n\n|\n {6}- if:)/)?.[0] ?? "";
    expect(pnpmBlock).toContain("version: 9");
  });

  it("injects the requested node version", () => {
    expect(ciWorkflow("22")).toContain("node-version: '22'");
  });

  it("detects all supported lockfiles", () => {
    expect(workflow).toContain("pnpm-lock.yaml");
    expect(workflow).toContain("yarn.lock");
    expect(workflow).toContain("bun.lockb");
    expect(workflow).toContain("bun.lock");
    expect(workflow).toContain("package-lock.json");
  });
});
