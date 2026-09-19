/**
 * CVSS v3.x base-score computation.
 *
 * OSV reports severity as `{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/..." }` — the `score`
 * field holds the *vector string*, not a number. Running parseFloat over it yields NaN, which
 * silently graded every such advisory as "low" and dropped it. Anything that wants a number out
 * of a CVSS vector has to compute it.
 *
 * Implements the CVSS v3.1 base-score specification (section 7.1). v3.0 uses the same base
 * formula, so both parse here. Vectors that are malformed or missing a required metric return
 * null — the caller decides what an unknown severity means, rather than being handed a 0.
 */

const AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC: Record<string, number> = { L: 0.77, H: 0.44 };
const UI: Record<string, number> = { N: 0.85, R: 0.62 };
const CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };
// Privileges Required is the one metric whose weight depends on Scope.
const PR_UNCHANGED: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const PR_CHANGED: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };

/** CVSS rounds up to one decimal place (spec's Roundup, not Math.round). */
function roundUp1(value: number): number {
  const scaled = Math.round(value * 100000);
  return scaled % 10000 === 0 ? scaled / 100000 : (Math.floor(scaled / 10000) + 1) / 10;
}

export function parseCvssVector(vector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of vector.split("/")) {
    const [key, value] = part.split(":");
    if (key && value) out[key] = value;
  }
  return out;
}

/**
 * Base score for a CVSS v3.x vector, or null when the vector is not v3 or omits a base metric.
 * v4.0 vectors use different metrics and are rejected rather than mis-scored.
 */
export function cvssV3BaseScore(vector: string): number | null {
  const m = parseCvssVector(vector);
  if (!m.CVSS?.startsWith("3")) return null;

  const scopeChanged = m.S === "C";
  const av = AV[m.AV ?? ""];
  const ac = AC[m.AC ?? ""];
  const ui = UI[m.UI ?? ""];
  const pr = (scopeChanged ? PR_CHANGED : PR_UNCHANGED)[m.PR ?? ""];
  const c = CIA[m.C ?? ""];
  const i = CIA[m.I ?? ""];
  const a = CIA[m.A ?? ""];
  if ([av, ac, ui, pr, c, i, a].some((v) => v === undefined) || (m.S !== "U" && m.S !== "C")) {
    return null;
  }

  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  if (impact <= 0) return 0;

  const exploitability = 8.22 * av! * ac! * pr! * ui!;
  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);
  return roundUp1(raw);
}

/**
 * Numeric severity from an OSV `severity[].score`, which may be a bare number (some databases) or
 * a CVSS vector (the schema's actual convention). Null when neither.
 */
export function numericScoreFrom(score: string | undefined): number | null {
  if (!score) return null;
  const trimmed = score.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    return n >= 0 && n <= 10 ? n : null;
  }
  return cvssV3BaseScore(trimmed);
}
