import { describe, expect, it } from "vitest";
import { detectRepoSurface, isPlaywrightAiApplicable, resolveE2eFixId } from "./platform-testing";

describe("platform-testing", () => {
  it("routes API-only Python to api-tests", () => {
    const input = {
      language: "python" as const,
      resolvedFramework: "Python",
      isNodeProject: false,
      isStaticSpa: false,
      usesReact: false,
      filePaths: ["pyproject.toml", "app/main.py"],
    };
    expect(detectRepoSurface(input)).toBe("api");
    expect(resolveE2eFixId(input)).toBe("api-tests");
    expect(isPlaywrightAiApplicable(input)).toBe(false);
  });

  it("routes Django to playwright-ai", () => {
    const input = {
      language: "python" as const,
      resolvedFramework: "Django",
      isNodeProject: false,
      isStaticSpa: false,
      usesReact: false,
      filePaths: ["manage.py", "app/templates/index.html"],
    };
    expect(resolveE2eFixId(input)).toBe("playwright-ai");
    expect(isPlaywrightAiApplicable(input)).toBe(true);
  });

  it("routes Flutter to dart-test-ai", () => {
    const input = {
      language: "dart" as const,
      resolvedFramework: "Flutter",
      isNodeProject: false,
      isStaticSpa: false,
      usesReact: false,
      filePaths: ["lib/main.dart", "pubspec.yaml"],
    };
    expect(resolveE2eFixId(input)).toBe("dart-test-ai");
    expect(isPlaywrightAiApplicable(input)).toBe(false);
  });

  it("routes Electron to playwright-ai", () => {
    const input = {
      language: "node" as const,
      resolvedFramework: "Electron",
      isNodeProject: true,
      isStaticSpa: false,
      usesReact: true,
      filePaths: ["package.json", "electron/main.ts"],
    };
    expect(detectRepoSurface(input)).toBe("desktop");
    expect(resolveE2eFixId(input)).toBe("playwright-ai");
  });

  it("routes Expo to playwright-ai", () => {
    const input = {
      language: "node" as const,
      resolvedFramework: "Expo",
      isNodeProject: true,
      isStaticSpa: false,
      usesReact: true,
      filePaths: ["package.json", "app.json"],
    };
    expect(resolveE2eFixId(input)).toBe("playwright-ai");
  });
});
