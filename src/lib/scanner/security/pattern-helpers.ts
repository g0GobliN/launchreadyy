import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals, type Signal } from "./signals";

const SKIP = /\.(md|mdx|lock|min\.js|map|svg|test|spec)\.|__(tests|mocks)__|\.d\.ts$/i;

export interface Hit {
  file: string;
  label: string;
}

export function collect(
  fileContents: Record<string, string>,
  patterns: { label: string; re: RegExp; ext?: RegExp }[],
): Hit[] {
  const hits: Hit[] = [];
  for (const [file, content] of Object.entries(fileContents)) {
    if (SKIP.test(file) || !content) continue;
    for (const { label, re, ext } of patterns) {
      if (ext && !ext.test(file)) continue;
      re.lastIndex = 0;
      if (re.test(content)) hits.push({ file, label });
    }
  }
  return hits;
}

export function pushAggregated(
  issues: IssueInput[],
  hits: Hit[],
  opts: {
    title: string;
    severity: IssueInput["severity"];
    why: string;
    fixId: string;
    checkedFor: string[];
    recommendedFix: string;
    signalKind?: Signal["kind"];
  },
) {
  if (hits.length === 0) return;
  const shown = hits
    .slice(0, 5)
    .map((h) => `${h.label} in ${h.file}`)
    .join("; ");
  const more = hits.length > 5 ? ` +${hits.length - 5} more.` : "";
  const signals: Signal[] = hits.map((h) => ({
    kind: opts.signalKind ?? "heuristic",
    detail: `${h.label} in ${h.file}`,
  }));
  issues.push({
    category: "Security",
    title: `${opts.title} (${hits.length} found)`,
    severity: opts.severity,
    why: opts.why,
    timeSaved: "1h",
    fixId: opts.fixId,
    checkedFor: [...opts.checkedFor, "up to ~40 sampled source files (not the full repo tree)"],
    foundEvidence: `Found: ${shown}.${more}`,
    confidence: confidenceFromSignals(signals),
    detection: ["rule-based"],
    recommendedFix: opts.recommendedFix,
  });
}
