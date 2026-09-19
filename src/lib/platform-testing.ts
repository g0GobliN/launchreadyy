/**
 * Single source: which E2E / integration test fix applies per repo surface + language.
 * Aligns with tagline: web, mobile, desktop, backend — any language.
 */

import type { ProjectLanguage } from "./project-context.server";
import { hasBrowsableWebUi } from "./web-playwright";

export type RepoSurface = "web" | "desktop" | "mobile" | "api" | "library";

export interface E2eTargetInput {
  language: ProjectLanguage;
  resolvedFramework: string;
  isNodeProject: boolean;
  isStaticSpa: boolean;
  usesReact: boolean;
  filePaths: string[];
}

const DESKTOP_FRAMEWORKS = new Set(["Electron", "Tauri"]);
const MOBILE_JS_FRAMEWORKS = new Set(["Expo", "React Native"]);

/** Native UI stacks — widget/instrumentation tests, not browser Playwright. */
const NATIVE_UI_FIX: Partial<Record<ProjectLanguage, string>> = {
  dart: "dart-test-ai",
  swift: "swift-test-ai",
  kotlin: "kotlin-test-ai",
};

export function detectRepoSurface(input: E2eTargetInput): RepoSurface {
  const fw = input.resolvedFramework;
  if (DESKTOP_FRAMEWORKS.has(fw)) return "desktop";
  if (MOBILE_JS_FRAMEWORKS.has(fw) || fw === "Flutter") return "mobile";
  if (isApiOnlyBackend(input)) return "api";
  if (
    hasBrowsableWebUi({
      language: input.language,
      isNodeProject: input.isNodeProject,
      isStaticSpa: input.isStaticSpa,
      usesReact: input.usesReact,
      filePaths: input.filePaths,
      resolvedFramework: fw,
    })
  ) {
    return "web";
  }
  if (input.language !== "node" && input.language !== "unknown") return "api";
  return input.isNodeProject ? "web" : "library";
}

function isApiOnlyBackend(input: E2eTargetInput): boolean {
  if (DESKTOP_FRAMEWORKS.has(input.resolvedFramework)) return false;
  if (MOBILE_JS_FRAMEWORKS.has(input.resolvedFramework)) return false;
  if (input.resolvedFramework === "Flutter") return false;
  if (
    hasBrowsableWebUi({
      language: input.language,
      isNodeProject: input.isNodeProject,
      isStaticSpa: input.isStaticSpa,
      usesReact: input.usesReact,
      filePaths: input.filePaths,
      resolvedFramework: input.resolvedFramework,
    })
  ) {
    return false;
  }
  const blob = input.filePaths.join("\n");
  const apiOnly =
    /(^|\/)(handlers?|controllers?|routes?|api|internal|pkg)\//i.test(blob) &&
    !/\.(html|tsx|jsx|vue|svelte|erb|blade\.php)$/i.test(blob);
  return apiOnly || (!input.isNodeProject && !input.usesReact && !input.isStaticSpa);
}

/**
 * Maps the generic E2E slot in packs/scanner (`playwright-ai`) to the right fix id.
 * Flutter → dart-test-ai, Swift → swift-test-ai, API-only → api-tests, else playwright-ai.
 */
export function resolveE2eFixId(input: E2eTargetInput): string | null {
  const native = NATIVE_UI_FIX[input.language];
  if (native && input.resolvedFramework === "Flutter") return native;
  if (native && (input.resolvedFramework === "Swift" || input.resolvedFramework === "Kotlin")) {
    return native;
  }

  const surface = detectRepoSurface(input);

  if (surface === "api") return "api-tests";
  if (surface === "library") return null;

  // web, desktop, mobile (Expo/RN/Electron/Tauri) → browser/automation Playwright
  if (surface === "desktop" || surface === "mobile" || surface === "web") {
    return "playwright-ai";
  }

  return "playwright-ai";
}

export function isPlaywrightAiApplicable(input: E2eTargetInput): boolean {
  return resolveE2eFixId(input) === "playwright-ai";
}

export function playwrightAiSkipReason(input: E2eTargetInput): string | null {
  const fix = resolveE2eFixId(input);
  if (fix === "playwright-ai") return null;
  if (!fix) return "Skipped — no testable UI or API surface detected for this repo";
  const labels: Record<string, string> = {
    "api-tests": "HTTP API tests (api-tests)",
    "dart-test-ai": "Flutter widget/integration tests (dart-test-ai)",
    "swift-test-ai": "Swift XCTest tests (swift-test-ai)",
    "kotlin-test-ai": "Kotlin instrumented tests (kotlin-test-ai)",
  };
  return `Skipped — ${input.resolvedFramework} uses ${labels[fix] ?? fix} instead of browser Playwright`;
}
