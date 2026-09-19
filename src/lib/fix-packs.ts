import type { ProjectLanguage } from "./project-context.server";
import { languageUnitTestAiFix } from "./language-test-fixes";

export interface FixPack {
  id: string;
  name: string;
  description: string;
  fixIds: string[];
  effort: number;
  riskLevel: "low" | "medium" | "high";
}

export const FIX_PACKS: FixPack[] = [
  {
    id: "security-hardening",
    name: "Security Hardening Pack",
    description:
      "Helmet, rate limiting, env safety, committed-secrets guard, and dependency audit CI.",
    fixIds: [
      "helmet",
      "rate-limit",
      "cors",
      "env-example",
      "gitignore-env",
      "dependency-audit-ci",
      "security-cookie-flags",
      "security-csrf",
    ],
    effort: 5,
    riskLevel: "high",
  },
  {
    id: "stripe-production",
    name: "Stripe Infra Pack",
    description:
      "Env docs, CI pipeline, and error monitoring for Stripe-integrated apps. Manual step required: add webhook signature verification (see PR checklist).",
    fixIds: ["env-example-ai", "ci-ai", "monitoring"],
    effort: 4,
    riskLevel: "medium",
  },
  {
    id: "env-safety",
    name: "Env Safety Pack",
    description: ".env.example + README setup in one PR.",
    fixIds: ["env-example-ai", "readme-ai"],
    effort: 2,
    riskLevel: "low",
  },
  {
    id: "cicd",
    name: "CI/CD Pack",
    description: "Production CI + ESLint + Vitest (auto-bundled). Preflight verifies before PR.",
    fixIds: ["ci-ai", "eslint"],
    effort: 2,
    riskLevel: "low",
  },
  {
    id: "readme-setup",
    name: "README + Setup Pack",
    description: "AI-written README with install, env, and deploy sections.",
    fixIds: ["readme-ai", "env-example"],
    effort: 3,
    riskLevel: "medium",
  },
  {
    id: "testing",
    name: "Testing Pack",
    description: "Vitest unit tests + Playwright E2E for your routes.",
    fixIds: ["vitest-ai", "playwright-ai"],
    effort: 6,
    riskLevel: "medium",
  },
  {
    id: "deployment",
    name: "Deployment Pack",
    description: "Dockerfile + CI pipeline for reproducible builds.",
    fixIds: ["dockerfile", "github-actions"],
    effort: 3,
    riskLevel: "medium",
  },
  {
    id: "production-launch",
    name: "Production Launch Pack",
    description: "CI, tests, monitoring, env docs, and error boundary — full launch baseline.",
    fixIds: ["ci-ai", "vitest-ai", "monitoring", "env-example-ai", "error-boundary"],
    effort: 5,
    riskLevel: "medium",
  },
];

const LINT_BY_LANGUAGE: Partial<Record<ProjectLanguage, string>> = {
  python: "ruff",
  go: "golangci-lint",
  ruby: "rubocop",
  php: "phpcs",
  java: "checkstyle",
  elixir: "credo",
};

/** Swap Node-centric pack fix ids for language-appropriate equivalents. */
export function resolvePackFixId(
  fixId: string,
  language: ProjectLanguage,
  isNodeProject: boolean,
): string | null {
  if (fixId === "vitest-ai") {
    if (isNodeProject) return "vitest-ai";
    return languageUnitTestAiFix(language);
  }
  if (fixId === "playwright-ai") {
    if (language === "dart") return "dart-test-ai";
    if (language === "swift") return "swift-test-ai";
    if (language === "kotlin") return "kotlin-test-ai";
    return "playwright-ai";
  }
  if (fixId === "eslint") {
    if (isNodeProject) return "eslint";
    return LINT_BY_LANGUAGE[language] ?? null;
  }
  if (fixId === "error-boundary") {
    return isNodeProject ? "error-boundary" : null;
  }
  if (fixId === "github-actions") {
    return isNodeProject ? "github-actions" : "ci-ai";
  }
  if (fixId === "env-example") {
    return isNodeProject ? "env-example" : "env-example-ai";
  }
  return fixId;
}

export function resolvePackFixIds(
  pack: FixPack,
  language: ProjectLanguage,
  isNodeProject: boolean,
): string[] {
  return [
    ...new Set(
      pack.fixIds
        .map((id) => resolvePackFixId(id, language, isNodeProject))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

export function getAvailablePacks(
  scanFixIds: Set<string>,
  opts?: { language?: ProjectLanguage; isNodeProject?: boolean },
): FixPack[] {
  const language = opts?.language ?? "node";
  const isNodeProject = opts?.isNodeProject ?? true;
  return FIX_PACKS.filter((pack) => {
    const resolved = resolvePackFixIds(pack, language, isNodeProject);
    const matched = resolved.filter((id) => scanFixIds.has(id)).length;
    // Require at least half the pack's fixes to be present in the scan so
    // packs don't appear when only one tangentially related fix matches.
    const threshold = Math.ceil(resolved.length / 2);
    return matched >= threshold;
  });
}

export function packFixIdsAvailable(
  pack: FixPack,
  scanFixIds: Set<string>,
  opts?: { language?: ProjectLanguage; isNodeProject?: boolean },
): string[] {
  const language = opts?.language ?? "node";
  const isNodeProject = opts?.isNodeProject ?? true;
  return resolvePackFixIds(pack, language, isNodeProject).filter((id) => scanFixIds.has(id));
}

export function computePackEffort(pack: FixPack): number {
  return pack.effort;
}

export interface FixPlanPreview {
  branchName: string;
  filesToAdd: string[];
  filesToChange: string[];
  deps: string[];
  riskLevel: "low" | "medium" | "high";
  effort: number;
  testInstructions: string[];
  rollbackNotes: string[];
  summary: string;
}

export function buildFixPlanPreview(opts: {
  fixIds: string[];
  branchName: string;
  filesAdded: string[];
  filesChanged: string[];
  deps: string[];
  effort?: number;
  packRisk?: "low" | "medium" | "high";
  language?: ProjectLanguage;
}): FixPlanPreview {
  const hasAi = opts.fixIds.some((id) => id.endsWith("-ai") || id === "api-tests");
  const riskLevel =
    opts.packRisk ??
    (opts.fixIds.some((id) => id.startsWith("auditor-")) ? "high" : hasAi ? "medium" : "low");

  const lang = opts.language ?? "node";
  const testCmd =
    lang === "python"
      ? "pytest"
      : lang === "java"
        ? "./mvnw test || ./gradlew test"
        : lang === "go"
          ? "go test ./..."
          : opts.fixIds.some((id) => id.includes("vitest") || id.includes("test"))
            ? "npm test"
            : "npm run lint";
  const installCmd =
    lang === "python"
      ? "pip install -r requirements.txt  # or: pip install -e ."
      : lang === "java"
        ? "./mvnw package -DskipTests || ./gradlew build -x test"
        : lang === "go"
          ? "go mod download"
          : "npm ci (or pnpm/yarn per lockfile)";

  return {
    branchName: opts.branchName,
    filesToAdd: opts.filesAdded,
    filesToChange: opts.filesChanged,
    deps: opts.deps,
    riskLevel,
    effort: opts.effort ?? opts.fixIds.length,
    testInstructions: [
      "Pull branch locally: git fetch && git checkout " + opts.branchName,
      `Install deps: ${installCmd}`,
      `Run tests: ${testCmd}`,
      "Verify CI passes on the PR before merge",
    ],
    rollbackNotes: [
      "Revert the PR merge commit on main if issues appear post-deploy",
      "No database migrations in this pack — rollback is safe via git revert",
      opts.fixIds.includes("monitoring")
        ? "Remove SENTRY_DSN env var to disable monitoring after rollback"
        : "Template-only changes — revert restores prior behavior",
    ],
    summary: `${opts.fixIds.length} fix${opts.fixIds.length > 1 ? "es" : ""} · ${opts.filesAdded.length} new files · ${opts.filesChanged.length} modified · ${opts.deps.length} deps`,
  };
}
