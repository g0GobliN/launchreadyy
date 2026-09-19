import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals } from "./signals";
import type { SecurityScanProfileCtx, StackProfile } from "./stack-profiles/types";

/**
 * Framework-aware auth guard absence check.
 * Deep route analysis still lives in readiness/auditor.ts; this catches obvious stack gaps.
 */
export function checkAuthGuardsWithProfile(
  profile: StackProfile | null,
  ctx: SecurityScanProfileCtx,
  issues: IssueInput[],
) {
  if (!profile?.authDetector) return;
  // Express/Next auth depth lives in the code auditor — avoid duplicate noise here.
  if (profile.id === "express" || profile.id === "next" || profile.id === "vite") return;

  const signals = profile.authDetector(ctx);
  if (signals.length > 0) return;

  const corpus = Object.values(ctx.fileContents).join("\n") + (ctx.sourceContent ?? "");
  const hasRoutes =
    /\b(?:Route::|@app\.(?:get|post)|path\(|urlpatterns|resources\s*:|before_action|router\.)/i.test(
      corpus,
    );
  if (!hasRoutes) return;

  issues.push({
    category: "Security",
    title: `No ${profile.label} auth guard detected`,
    severity: "high",
    why: "Routes that mutate or expose user data without an auth guard are a common pre-launch gap.",
    timeSaved: "2h",
    fixId: "security-auth-guard",
    checkedFor: [`${profile.label} auth middleware / before_action / login_required / Depends`],
    foundEvidence: `Sampled ${profile.label} sources; no auth guard patterns matched.`,
    confidence: confidenceFromSignals([
      { kind: "heuristic", detail: `${profile.id} auth absence` },
    ]),
    detection: ["framework-aware", "rule-based"],
    recommendedFix: `Add ${profile.label} authentication middleware on sensitive routes (auditor may flag specific handlers too).`,
  });
}
