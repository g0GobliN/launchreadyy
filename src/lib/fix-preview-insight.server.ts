import {
  analyzeProjectCi,
  expandFixIdsForProductionCi,
  pendingScriptsFromFixIds,
  type ProjectCiProfile,
} from "./project-ci.server";
import type { ProjectContext } from "./project-context.server";
import { ciMatrixPackages } from "./project-intelligence.server";
import type { VerificationNote } from "./fix-executor/types";

export interface FixPreviewInsight {
  ciRelevant: boolean;
  ciJobs: string[];
  ciSteps: string[];
  buildEnvVars: string[];
  testEnvVars: string[];
  bundledFixIds: string[];
  integrations: string[];
  monorepoPackages: string[];
  runtimeModel: string;
  ciSummary: string;
  verificationNotes: VerificationNote[];
}

function ciJobNames(profile: ProjectCiProfile, ctx: ProjectContext): string[] {
  const jobs = ["quality", "test", "build", "security-audit", "secret-scan"];
  if (profile.hasPlaywright) jobs.push("e2e");

  const matrix = ciMatrixPackages(ctx.intelligence.packages);
  if (matrix.length > 1 && ctx.intelligence.monorepo) {
    return matrix.flatMap((pkg) =>
      jobs.map((j) => `${j} (${pkg.dir === "." ? pkg.name : pkg.dir})`),
    );
  }
  return jobs;
}

export function buildFixPreviewInsight(
  ctx: ProjectContext,
  fixIds: string[],
  verificationNotes: VerificationNote[] = [],
): FixPreviewInsight {
  const { fixIds: effectiveFixIds, bundled } = expandFixIdsForProductionCi(fixIds, {
    isNodeProject: ctx.isNodeProject,
    scripts: ctx.pkg.scripts,
  });

  const hasCi = effectiveFixIds.some((id) => id === "github-actions" || id === "ci-ai");
  const profile = analyzeProjectCi({
    pkg: ctx.pkg,
    framework: ctx.resolvedFramework,
    filePaths: ctx.filePaths,
    packageManager: ctx.packageManager,
    pendingScripts: pendingScriptsFromFixIds(effectiveFixIds),
    productionBaseline: hasCi,
    envVars: ctx.envVars,
    envContract: ctx.intelligence.envContract,
    isStaticSpa: ctx.isStaticSpa,
    hasPlaywright:
      effectiveFixIds.some((id) => id === "playwright" || id === "playwright-ai") ||
      ctx.filePaths.some((p) => /playwright\.config\.(ts|js|mjs)/.test(p)),
  });

  const matrix = ciMatrixPackages(ctx.intelligence.packages);
  const monorepoPackages = matrix.length > 1 ? matrix.map((p) => `${p.dir} (${p.kind})`) : [];

  return {
    ciRelevant: hasCi,
    ciJobs: hasCi ? ciJobNames(profile, ctx) : [],
    ciSteps: profile.steps,
    buildEnvVars: profile.buildEnvVars ?? [],
    testEnvVars: profile.testEnvVars ?? [],
    bundledFixIds: bundled,
    integrations: ctx.intelligence.integrations.signals,
    monorepoPackages,
    runtimeModel: ctx.intelligence.runtimeModel,
    ciSummary: hasCi ? profile.summary : "No CI workflow in this fix selection.",
    verificationNotes,
  };
}
