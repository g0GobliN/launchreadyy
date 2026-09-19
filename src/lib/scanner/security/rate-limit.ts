import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals } from "./signals";

/** Express rate-limit package check. */
export function checkRateLimitPackage(deps: Record<string, string>, issues: IssueInput[]) {
  if (deps["express-rate-limit"]) return;

  issues.push({
    category: "Security",
    title: "Missing rate limiting",
    severity: "high",
    why: "Without rate limiting, your API is open to brute-force and denial-of-service attacks.",
    timeSaved: "1h",
    fixId: "rate-limit",
    checkedFor: ["express-rate-limit"],
    foundEvidence: "express-rate-limit not found in package.json dependencies.",
    confidence: confidenceFromSignals([{ kind: "exact_absence", detail: "express-rate-limit" }]),
    recommendedFix: "Add express-rate-limit (or equivalent) on public auth and API routes.",
    detection: ["rule-based"],
  });
}
