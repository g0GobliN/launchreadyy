import type { Confidence } from "../../scanner-rules";

/**
 * Structured signals emitted by security checks. Confidence is computed here — checks never
 * self-assign it — so 30 future checks stay calibrated the same way.
 *
 * Taxonomy extracted from the first three MVP checks (secrets, committed .env, .env.example):
 * - exact_match / provider_prefix / exact_absence → hard evidence → high
 * - heuristic → can false-positive → medium
 * - partial / pattern_only → inference → low
 * - framework_profile → stack understood → high (generic fallback stays heuristic/medium)
 */
export type SignalKind =
  | "exact_match"
  | "exact_absence"
  | "provider_prefix"
  | "heuristic"
  | "framework_profile"
  | "partial"
  | "pattern_only";

export interface Signal {
  kind: SignalKind;
  /** Short label for evidence / debugging, e.g. "AWS access key in src/config.ts:12". */
  detail?: string;
}

const HIGH: SignalKind[] = ["exact_match", "exact_absence", "provider_prefix", "framework_profile"];
const MEDIUM: SignalKind[] = ["heuristic"];

/** Map emitted signals → confidence. Empty signals → low (caller should not emit a finding). */
export function confidenceFromSignals(signals: Signal[]): Confidence {
  if (signals.length === 0) return "low";
  if (signals.some((s) => HIGH.includes(s.kind))) return "high";
  if (signals.some((s) => MEDIUM.includes(s.kind))) return "medium";
  return "low";
}
