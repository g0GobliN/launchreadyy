import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals } from "./signals";
import type { SecurityScanProfileCtx, StackProfile } from "./stack-profiles/types";

/**
 * HTTP security headers check via stack profile detectors — framework-aware, not tied to
 * Express's "helmet" package. fixId stays "helmet" so existing per-language fix generation
 * (Express, Go, Python, Ruby, PHP, Rust, JVM, …) keeps resolving to the right template.
 */
export function checkHeadersWithProfile(
  profile: StackProfile | null,
  ctx: SecurityScanProfileCtx,
  issues: IssueInput[],
) {
  if (!profile?.headersDetector) return;
  const signals = profile.headersDetector(ctx);
  if (signals.length > 0) return;

  issues.push({
    category: "Security",
    title: "Missing HTTP security headers",
    severity: "medium",
    why: "Secure HTTP headers (CSP, X-Frame-Options, and similar) protect against XSS, clickjacking, and other common attacks.",
    timeSaved: "1h",
    fixId: "helmet",
    checkedFor: [`${profile.label} security headers`],
    foundEvidence: `No security-header configuration matched for ${profile.label}.`,
    confidence: confidenceFromSignals([{ kind: "heuristic", detail: `${profile.id} headers` }]),
    recommendedFix: `Enable ${profile.label}'s security-headers middleware/config so default protections apply to every response.`,
    detection: ["framework-aware", "rule-based"],
  });
}
