import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals } from "./signals";
import { collect, pushAggregated } from "./pattern-helpers";

/**
 * Webhook signature verification heuristics.
 * Detailed Stripe constructEvent analysis remains in readiness/auditor.ts.
 */
export function checkWebhookPatterns(fileContents: Record<string, string>, issues: IssueInput[]) {
  const stripeHits = collect(fileContents, [
    { label: "stripe webhook route", re: /stripe.*webhook|webhook.*stripe|\/webhooks\/stripe/i },
  ]);
  if (stripeHits.length === 0) return;

  const verified = collect(fileContents, [
    {
      label: "constructEvent",
      re: /constructEvent|stripe\.webhooks\.constructEvent|Webhook\.construct_event/i,
    },
  ]);
  if (verified.length > 0) return;

  pushAggregated(issues, stripeHits, {
    title: "Stripe webhook without signature verification",
    severity: "high",
    why: "Unsigned webhooks can be forged — payment state and entitlements can be spoofed.",
    fixId: "stripe-webhook-verify",
    checkedFor: ["stripe webhook route", "constructEvent / Webhook.construct_event"],
    recommendedFix: "Verify Stripe signatures with constructEvent before trusting event payloads.",
    signalKind: "heuristic",
  });

  // Cap confidence: webhook checks can false-positive on incomplete samples
  const last = issues[issues.length - 1];
  if (last?.title.startsWith("Stripe webhook")) {
    last.confidence = confidenceFromSignals([
      { kind: "heuristic", detail: "webhook without constructEvent in sample" },
    ]);
    if (last.severity === "critical") last.severity = "high";
  }
}
