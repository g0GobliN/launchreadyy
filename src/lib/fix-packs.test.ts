import { describe, expect, it } from "vitest";
import {
  FIX_PACKS,
  getAvailablePacks,
  packFixIdsAvailable,
  resolvePackFixId,
  resolvePackFixIds,
} from "./fix-packs";

describe("fix-packs language resolution", () => {
  it("maps testing to pytest-ai + playwright-ai on Python", () => {
    const pack = FIX_PACKS.find((p) => p.id === "testing")!;
    expect(resolvePackFixIds(pack, "python", false)).toEqual(["pytest-ai", "playwright-ai"]);
  });

  it("maps the testing E2E slot to dart-test-ai on Flutter/dart", () => {
    expect(resolvePackFixId("playwright-ai", "dart", false)).toBe("dart-test-ai");
    expect(resolvePackFixId("playwright-ai", "swift", false)).toBe("swift-test-ai");
    expect(resolvePackFixId("playwright-ai", "kotlin", false)).toBe("kotlin-test-ai");
  });

  it("maps cicd lint to ruff on Python", () => {
    expect(resolvePackFixId("eslint", "python", false)).toBe("ruff");
    expect(resolvePackFixId("eslint", "node", true)).toBe("eslint");
  });

  it("maps eslint to phpcs on PHP, checkstyle on Java, credo on Elixir", () => {
    expect(resolvePackFixId("eslint", "php", false)).toBe("phpcs");
    expect(resolvePackFixId("eslint", "java", false)).toBe("checkstyle");
    expect(resolvePackFixId("eslint", "elixir", false)).toBe("credo");
  });

  it("maps vitest to xunit-ai on C#", () => {
    expect(resolvePackFixId("vitest-ai", "csharp", false)).toBe("xunit-ai");
  });

  it("maps vitest to exunit-ai on Elixir", () => {
    expect(resolvePackFixId("vitest-ai", "elixir", false)).toBe("exunit-ai");
  });

  it("drops error-boundary from production-launch on Java", () => {
    const pack = FIX_PACKS.find((p) => p.id === "production-launch")!;
    const ids = resolvePackFixIds(pack, "java", false);
    expect(ids).toContain("junit-ai");
    expect(ids).not.toContain("error-boundary");
  });

  it("finds security-hardening when majority of fixes are in scan for Python", () => {
    const scanFixIds = new Set(["helmet", "rate-limit", "env-example-ai", "gitignore-env"]);
    const packs = getAvailablePacks(scanFixIds, { language: "python", isNodeProject: false });
    expect(packs.some((p) => p.id === "security-hardening")).toBe(true);
    const pack = packs.find((p) => p.id === "security-hardening")!;
    expect(
      packFixIdsAvailable(pack, scanFixIds, { language: "python", isNodeProject: false }),
    ).toEqual(["helmet", "rate-limit", "env-example-ai", "gitignore-env"]);
  });

  it("does not show security-hardening when only one fix matches", () => {
    // Only helmet matches — below the 50% threshold for a 4-fix pack
    const scanFixIds = new Set(["helmet", "monitoring", "ci-ai"]);
    const packs = getAvailablePacks(scanFixIds, { language: "node", isNodeProject: true });
    expect(packs.some((p) => p.id === "security-hardening")).toBe(false);
  });

  it("shows testing when both fixes are in scan", () => {
    const scanFixIds = new Set(["pytest-ai", "api-tests"]);
    const packs = getAvailablePacks(scanFixIds, { language: "python", isNodeProject: false });
    expect(packs.some((p) => p.id === "testing")).toBe(true);
  });

  it("shows testing when one of two fixes matches (50% threshold)", () => {
    // 2-fix pack threshold is ceil(2/2)=1, so one match is enough
    const scanFixIds = new Set(["pytest-ai"]);
    const packs = getAvailablePacks(scanFixIds, { language: "python", isNodeProject: false });
    expect(packs.some((p) => p.id === "testing")).toBe(true);
  });

  it("does not show production-launch when only one of five fixes matches", () => {
    // 5-fix pack threshold is ceil(5/2)=3, one match is not enough
    const scanFixIds = new Set(["monitoring"]);
    const packs = getAvailablePacks(scanFixIds, { language: "node", isNodeProject: true });
    expect(packs.some((p) => p.id === "production-launch")).toBe(false);
  });
});
