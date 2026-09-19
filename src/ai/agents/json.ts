/**
 * Tolerant JSON extraction from model output (v2 Phase 8). Models wrap JSON in prose or ```json
 * fences; this pulls the JSON object out and parses it, returning null on failure so callers can
 * treat "unparseable" as a handled outcome rather than a crash.
 *
 * @see docs/README.md  (Phase 8)
 */

/** Extract and parse the first JSON object/array from arbitrary model text. Null on failure. */
export function parseAgentJson<T>(text: string): T | null {
  if (!text) return null;

  // Prefer a fenced ```json block when present.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fence ? fence[1] : text;

  const direct = tryParse<T>(candidate.trim());
  if (direct !== null) return direct;

  // Fall back to the substring spanning the first opening to the last closing brace/bracket.
  const start = firstIndexOf(candidate, ["{", "["]);
  const end = lastIndexOf(candidate, ["}", "]"]);
  if (start !== -1 && end > start) {
    return tryParse<T>(candidate.slice(start, end + 1));
  }
  return null;
}

function tryParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function firstIndexOf(s: string, chars: string[]): number {
  let min = -1;
  for (const c of chars) {
    const i = s.indexOf(c);
    if (i !== -1 && (min === -1 || i < min)) min = i;
  }
  return min;
}

function lastIndexOf(s: string, chars: string[]): number {
  let max = -1;
  for (const c of chars) {
    const i = s.lastIndexOf(c);
    if (i > max) max = i;
  }
  return max;
}
