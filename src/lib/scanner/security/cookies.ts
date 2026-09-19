import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals } from "./signals";
import type { SecurityScanProfileCtx, StackProfile } from "./stack-profiles/types";

/** Insecure cookie config via stack profile detectors. */
export function checkCookiesWithProfile(
  profile: StackProfile | null,
  ctx: SecurityScanProfileCtx,
  issues: IssueInput[],
) {
  if (!profile?.cookieDetector) return;
  const signals = profile.cookieDetector(ctx);
  const weak = signals.some((s) => s.kind === "heuristic");
  const strong = signals.some((s) => s.kind === "framework_profile");
  if (!(weak && !strong)) return;

  issues.push({
    category: "Security",
    title: "Insecure cookie configuration",
    severity: "medium",
    why: "Cookies without Secure, HttpOnly, and SameSite flags are easier to steal or send cross-site.",
    timeSaved: "1h",
    fixId: "security-cookie-flags",
    checkedFor: ["Secure", "HttpOnly", "SameSite=Strict|Lax", `${profile.label} cookie APIs`],
    foundEvidence:
      signals
        .map((s) => s.detail)
        .filter(Boolean)
        .join("; ") || undefined,
    confidence: confidenceFromSignals(signals),
    detection: ["framework-aware", "rule-based"],
    recommendedFix:
      "Set Secure, HttpOnly, and SameSite (Strict or Lax) on every session/auth cookie in production.",
  });
}
