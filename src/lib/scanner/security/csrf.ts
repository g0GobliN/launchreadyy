import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals } from "./signals";
import type { SecurityScanProfileCtx, StackProfile } from "./stack-profiles/types";

/** CSRF check using stack profile when available. */
export function checkCsrfWithProfile(
  profile: StackProfile | null,
  ctx: SecurityScanProfileCtx,
  issues: IssueInput[],
) {
  if (!profile?.csrfDetector) return;
  const signals = profile.csrfDetector(ctx);
  if (signals.length > 0) return;

  if (profile.id === "express") {
    const corpus = Object.values(ctx.fileContents).join("\n");
    if (!/express-session|cookie-session|passport/i.test(corpus)) return;
    issues.push({
      category: "Security",
      title: "Missing CSRF protection",
      severity: "medium",
      why: "Session-cookie apps without CSRF protection are vulnerable to cross-site form posts that act as the signed-in user.",
      timeSaved: "1h",
      fixId: "security-csrf",
      checkedFor: ["csurf", "csrf-csrf", "double-submit cookie patterns"],
      foundEvidence: "Session middleware present; no CSRF middleware matched.",
      confidence: confidenceFromSignals([{ kind: "heuristic", detail: "session without csrf" }]),
      detection: ["framework-aware", "rule-based"],
      recommendedFix:
        "Add CSRF middleware (csurf or csrf-csrf) on state-changing cookie-authenticated routes.",
    });
    return;
  }

  if (profile.id === "django" || profile.id === "rails" || profile.id === "laravel") {
    issues.push({
      category: "Security",
      title: "Missing CSRF protection",
      severity: "medium",
      why: "Cookie-session frameworks expect CSRF tokens on state-changing requests.",
      timeSaved: "1h",
      fixId: "security-csrf",
      checkedFor: [`${profile.label} CSRF middleware / tokens`],
      foundEvidence: `No CSRF protection matched for ${profile.label}.`,
      confidence: confidenceFromSignals([{ kind: "heuristic", detail: `${profile.id} csrf` }]),
      detection: ["framework-aware", "rule-based"],
      recommendedFix: `Enable ${profile.label} CSRF protection on cookie-authenticated form/API mutations.`,
    });
  }
}
