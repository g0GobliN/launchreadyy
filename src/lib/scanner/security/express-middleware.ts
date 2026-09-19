import type { IssueInput } from "../../scanner-rules";
import { checkRateLimitPackage } from "./rate-limit";

/**
 * Express-only security package checks — owned by Production Security. Helmet and CORS
 * moved to checkHeadersWithProfile / checkCorsWithProfile (framework-aware via stack
 * profiles, covers Express too); rate limiting stays here since no cross-framework
 * detector exists for it yet, so it only makes sense to check the Express-specific package.
 */
export function checkExpressSecurityPackages(deps: Record<string, string>, issues: IssueInput[]) {
  checkRateLimitPackage(deps, issues);
}
