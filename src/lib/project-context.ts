export type ProjectLanguage =
  | "node"
  | "go"
  | "python"
  | "ruby"
  | "java"
  | "kotlin"
  | "php"
  | "rust"
  | "csharp"
  | "elixir"
  | "dart"
  | "swift"
  | "unknown";

export const FRAMEWORK_TO_LANGUAGE: Record<string, ProjectLanguage> = {
  Go: "go",
  Python: "python",
  Ruby: "ruby",
  Java: "java",
  Kotlin: "kotlin",
  PHP: "php",
  Rust: "rust",
  "C#": "csharp",
  Elixir: "elixir",
  Flutter: "dart",
  Swift: "swift",
  Expo: "node",
  "React Native": "node",
  Electron: "node",
  Tauri: "node",
};

export const NON_NODE_FRAMEWORKS = new Set(Object.keys(FRAMEWORK_TO_LANGUAGE));

export function isNonNodeFramework(framework: string): boolean {
  return NON_NODE_FRAMEWORKS.has(framework);
}

export const ARCH_SCAN_UNSUPPORTED_MESSAGE =
  "Architecture analysis needs recognizable source files (JS/TS, Python, Go, Java, Kotlin, Rust, Ruby, PHP, Elixir, Dart, Swift, or C#).";

/** Static HTML-only repos — basic CI/env checks still apply. */
export function isStaticWebRepo(filePaths: string[]): boolean {
  if (filePaths.includes("package.json")) return false;
  const backendMarkers = [
    "go.mod",
    "Gemfile",
    "requirements.txt",
    "pyproject.toml",
    "setup.py",
    "composer.json",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "mix.exs",
    "pubspec.yaml",
    "Package.swift",
  ];
  if (backendMarkers.some((m) => filePaths.includes(m))) return false;
  if (filePaths.some((f) => f.endsWith(".xcodeproj") || /^android\//.test(f))) return false;
  return filePaths.some((p) => /\.html?$/i.test(p));
}

/** Automated fixes apply to any repo with recognizable source or config files. */
export function isAutomatedFixSupported(filePaths: string[]): boolean {
  if (isStaticWebRepo(filePaths)) return true;
  return filePaths.some(
    (p) =>
      /\.(tsx?|jsx?|py|go|rb|php|rs|java|kt|kts|cs|exs?|dart|swift|m|mm|html?)$/i.test(p) ||
      /^(package\.json|go\.mod|pubspec\.yaml|Cargo\.toml|composer\.json|Gemfile|pom\.xml|build\.gradle)/.test(
        p.split("/").pop() ?? p,
      ),
  );
}

/** @deprecated use isAutomatedFixSupported */
export function isLaunchFixSupported(opts: {
  framework: string;
  hasPackageJson: boolean;
  filePaths: string[];
}): boolean {
  return isAutomatedFixSupported(opts.filePaths);
}

/**
 * Architecture scan supports every language with a per-language import-graph profile
 * (see arch-lang-profiles.ts). The scan itself rejects repos with no recognizable source.
 */
export function isArchScanSupported(_framework: string | null | undefined): boolean {
  return true;
}

/** @deprecated static sites now receive basic launch checks */
export const UNSUPPORTED_STATIC_WEB_SCAN_PREFIX = "UNSUPPORTED_REPO:";
export const UNSUPPORTED_STATIC_WEB_SCAN_MESSAGE =
  "Limited analysis — static HTML/CSS/JS only. Connect a full application repo for framework-specific fixes.";

/**
 * A repo with nothing to assess must not be scored.
 *
 * The score is `100 − penalties`, so a repository containing only a README produced a perfect
 * 100 with every launch-checklist item simultaneously unchecked — the product's most confident
 * possible claim, made about a repo it had found no application in. "No findings" and "nothing
 * to find" are different answers and only one of them is 100.
 */
export const NO_APPLICATION_DETECTED_MESSAGE =
  "No application detected — this repository has no recognizable manifest or source files, so there is nothing to score yet. Connect a repo containing your app, or set the app directory in settings if it lives in a subfolder.";

export function isUnsupportedStaticScan(warnings: string[] | undefined | null): boolean {
  return (warnings ?? []).some((w) => w.startsWith(UNSUPPORTED_STATIC_WEB_SCAN_PREFIX));
}

/** The reason this repo could not be scored, for display in place of the score. */
export function unsupportedScanMessage(warnings: string[] | undefined | null): string {
  const hit = (warnings ?? []).find((w) => w.startsWith(UNSUPPORTED_STATIC_WEB_SCAN_PREFIX));
  const detail = hit?.slice(UNSUPPORTED_STATIC_WEB_SCAN_PREFIX.length).trim();
  return detail || UNSUPPORTED_STATIC_WEB_SCAN_MESSAGE;
}

export function frameworkToProjectLanguage(framework: string): ProjectLanguage {
  if (framework === "C#") return "csharp";
  return FRAMEWORK_TO_LANGUAGE[framework] ?? "node";
}

/** Maps scanner framework labels to checkNonJs* language keys. */
export function normalizeScannerLanguage(framework: string): string {
  const f = framework.toLowerCase();
  if (f === "c#") return "csharp";
  if (f === "kotlin") return "kotlin";
  if (f === "flutter") return "dart";
  if (f === "swift") return "swift";
  return f;
}
