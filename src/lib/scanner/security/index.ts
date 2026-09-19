import type { IssueInput } from "../../scanner-rules";
import { checkCommittedSecrets, checkEnvExample } from "./env-hygiene";
import { checkExpressSecurityPackages } from "./express-middleware";
import { checkDependencyAudit } from "./dependency-audit";
import { checkHardcodedSecrets } from "./secrets";
import { checkUnsafeApis } from "./unsafe-apis";
import { runStackProfileChecks } from "./stack-profiles";
import { runPatternSecurityChecks } from "./pattern-checks";
import { runCodePatternChecks } from "./code-patterns";
import { checkWebhookPatterns } from "./webhooks";
import { checkPermissiveCors } from "./cors-permissive";
import { checkWorkflowSecurity } from "./workflow-security";
import { checkContainerSecurity } from "./container-security";
import { checkOsvDependencies } from "./osv-deps";
import type { Dependency } from "./dependency-inventory";
import { checkDependabotAlerts } from "./dependabot";
import { checkNonJsSecurityMiddleware } from "./non-js-middleware";

export { checkCommittedSecrets, checkEnvExample } from "./env-hygiene";
export { checkHardcodedSecrets } from "./secrets";
export { checkUnsafeApis } from "./unsafe-apis";
export { checkExpressSecurityPackages } from "./express-middleware";
export { checkDependencyAudit } from "./dependency-audit";
export { confidenceFromSignals, type Signal, type SignalKind } from "./signals";
export { runStackProfileChecks } from "./stack-profiles";
export { runPatternSecurityChecks } from "./pattern-checks";
export { runCodePatternChecks } from "./code-patterns";
export { checkNonJsSecurityMiddleware } from "./non-js-middleware";
export { checkOsvDependencies } from "./osv-deps";
export { collectDependencies, parseLockfile, type Dependency } from "./dependency-inventory";
export { checkDependabotAlerts } from "./dependabot";
export { checkPermissiveCors } from "./cors-permissive";
export { checkWorkflowSecurity, isWorkflowPath } from "./workflow-security";
export {
  checkContainerSecurity,
  isDockerfilePath,
  instructions as dockerInstructions,
  finalStage as dockerFinalStage,
  type Line as DockerInstruction,
} from "./container-security";

export interface SecurityScanContext {
  files: string[];
  fileContents: Record<string, string>;
  envExampleExists: boolean;
  automatedFixSupported: boolean;
  envExampleFixId?: string;
  /** `package.json` dependency ranges — framework detection, not vulnerability matching. */
  deps?: Record<string, string>;
  /**
   * Exact installed versions read from lockfiles, every ecosystem — see
   * `dependency-inventory.ts`. Separate from `deps` because the two answer different questions:
   * `deps` says what the project asked for, this says what it got.
   */
  lockedDependencies?: Dependency[];
  sourceContent?: string;
  githubToken?: string;
  repoOwner?: string;
  repoName?: string;
  /** Phase 1 — files already handled by the AST unsafe-call pass; the regex rule skips them. */
  unsafeApiSkipFiles?: ReadonlySet<string>;
  /** Phase 1 — AST-confirmed unsafe hits, folded into the single `security-unsafe-api` finding. */
  unsafeApiAstHits?: { file: string; line: number; label: string }[];
  /**
   * Whole-repository sample for credential scanning only.
   *
   * Every other content check is deliberately scoped to the resolved app directory. Secrets are
   * not: they are language-agnostic and the highest-consequence thing we report, so scoping them
   * to one app let a monorepo hide a key in a sibling package and still score clean. Unioned
   * with `fileContents` for `checkHardcodedSecrets` and nothing else.
   */
  secretSweepContents?: Record<string, string>;
}

/**
 * Production Security repo checks (sync portion).
 * Call `runSecurityIntegrations` afterward for OSV / Dependabot (async).
 */
export function runSecurityChecks(ctx: SecurityScanContext, issues: IssueInput[]) {
  checkCommittedSecrets(ctx.files, issues);
  checkHardcodedSecrets(
    ctx.secretSweepContents
      ? { ...ctx.fileContents, ...ctx.secretSweepContents }
      : ctx.fileContents,
    issues,
  );

  checkUnsafeApis(ctx.fileContents, issues, {
    skipFiles: ctx.unsafeApiSkipFiles,
    extraHits: ctx.unsafeApiAstHits,
  });
  checkWebhookPatterns(ctx.fileContents, issues);
  // Distinct from the stack-profile CORS check, which only asks whether CORS exists — a badly
  // configured policy passes that one, so the user hears nothing about it.
  checkPermissiveCors(ctx.fileContents, issues);
  // Workflow files are already in `fileContents` (the scan fetches up to 8), so this is free.
  checkWorkflowSecurity(ctx.fileContents, issues);
  checkContainerSecurity(ctx.fileContents, issues);
  checkDependencyAudit(ctx.files, ctx.fileContents, issues);
  if (ctx.deps) {
    // express-rate-limit is Express-specific tooling with no cross-framework
    // equivalent detector (unlike cors/headers below, which run per-framework via
    // stack profiles) — only worth checking for repos that actually run Express.
    if (ctx.deps["express"]) {
      checkExpressSecurityPackages(ctx.deps, issues);
    }
    runStackProfileChecks(
      {
        files: ctx.files,
        fileContents: ctx.fileContents,
        deps: ctx.deps,
        sourceContent: ctx.sourceContent,
      },
      issues,
    );
  } else {
    // Non-JS stacks still get profile matching via empty deps + file contents
    runStackProfileChecks(
      {
        files: ctx.files,
        fileContents: ctx.fileContents,
        deps: {},
        sourceContent: ctx.sourceContent,
      },
      issues,
    );
  }
  runPatternSecurityChecks(ctx.fileContents, issues);
  runCodePatternChecks(ctx.fileContents, issues);
  if (ctx.automatedFixSupported) {
    checkEnvExample(ctx.envExampleExists, issues, ctx.envExampleFixId);
  }

  for (const issue of issues) {
    if (issue.category === "Security" && !issue.detection) {
      issue.detection = ["rule-based"];
    }
  }
}

/** Async integrations — OSV + Dependabot. */
export async function runSecurityIntegrations(
  ctx: SecurityScanContext,
  issues: IssueInput[],
): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (ctx.lockedDependencies && ctx.lockedDependencies.length > 0) {
    tasks.push(checkOsvDependencies(ctx.lockedDependencies, issues));
  }
  if (ctx.githubToken && ctx.repoOwner && ctx.repoName) {
    tasks.push(
      checkDependabotAlerts(
        { token: ctx.githubToken, owner: ctx.repoOwner, repo: ctx.repoName },
        issues,
      ),
    );
  }
  await Promise.all(tasks);
}

export { checkNonJsSecurityMiddleware as checkNonJsSecurityMiddlewareFromSecurity };
