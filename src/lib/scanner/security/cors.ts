import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals } from "./signals";
import type { SecurityScanProfileCtx, StackProfile } from "./stack-profiles/types";

/**
 * CORS policy check via stack profile detectors — framework-aware, not Express-only.
 * Only fires for a repo whose detected stack actually has a corsDetector (Express, Rails,
 * FastAPI, Go, Django, Laravel); stacks without one are silently skipped rather than judged
 * against an Express-shaped default.
 *
 * Next.js and Astro deliberately have no corsDetector, so this never reports for them. Both are
 * frequently frontend-only, where "no CORS policy" is the correct configuration rather than a
 * finding — flagging every static Next.js site would be noise. A Next.js detector would need to
 * key off the presence of route handlers first.
 */
export function checkCorsWithProfile(
  profile: StackProfile | null,
  ctx: SecurityScanProfileCtx,
  issues: IssueInput[],
) {
  if (!profile?.corsDetector) return;
  const signals = profile.corsDetector(ctx);
  if (signals.length > 0) return;

  issues.push({
    category: "Security",
    title: "No CORS policy configured",
    severity: "medium",
    why: "Unrestricted cross-origin access creates avoidable account and data exposure risk. A strict CORS policy limits browser-sourced abuse paths.",
    timeSaved: "30m",
    fixId: "cors",
    checkedFor: [`${profile.label} CORS configuration`],
    foundEvidence: `No CORS configuration matched for ${profile.label}.`,
    confidence: confidenceFromSignals([{ kind: "heuristic", detail: `${profile.id} cors` }]),
    recommendedFix:
      "Configure an explicit CORS allowlist for production origins — avoid Access-Control-Allow-Origin: * on credentialed APIs.",
    detection: ["framework-aware", "rule-based"],
  });
}
