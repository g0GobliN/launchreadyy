import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals, type Signal } from "./signals";

/**
 * Unsafe API usage — `eval`, `Function()`, `child_process` exec/spawn, `pickle.loads`, etc.
 * Max severity Medium unless the call site looks user-input-adjacent (then High).
 * Always medium confidence: pattern match without dataflow proof.
 */

interface UnsafePattern {
  label: string;
  regex: RegExp;
  /** Languages / extensions this pattern applies to. Empty = all scanned text. */
  ext?: RegExp;
}

const UNSAFE_PATTERNS: UnsafePattern[] = [
  { label: "eval()", regex: /\beval\s*\(/g, ext: /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|php)$/i },
  { label: "new Function()", regex: /\bnew\s+Function\s*\(/g, ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i },
  {
    label: "child_process exec/spawn",
    regex: /\b(?:exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/g,
    ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i,
  },
  { label: "pickle.loads", regex: /\bpickle\.loads?\s*\(/g, ext: /\.py$/i },
  { label: "marshal.loads", regex: /\bmarshal\.loads?\s*\(/g, ext: /\.py$/i },
  { label: "yaml.load (unsafe)", regex: /\byaml\.load\s*\(/g, ext: /\.py$/i },
  { label: "Kernel#system", regex: /\bsystem\s*\(/g, ext: /\.rb$/i },
  { label: "unserialize()", regex: /\bunserialize\s*\(/g, ext: /\.php$/i },
];

const SKIP_FILE = /\.(md|mdx|lock|min\.js|map|svg|test|spec)\.|__(tests|mocks)__|\.d\.ts$/i;

const USER_INPUT_HINT =
  /req\.(?:body|query|params)|request\.(?:json|form)|os\.environ|process\.env|params\[|\$\{|input\(/i;

interface Hit {
  file: string;
  line: number;
  label: string;
  userAdjacent: boolean;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function lineText(content: string, index: number): string {
  const start = content.lastIndexOf("\n", index) + 1;
  const end = content.indexOf("\n", index);
  return content.slice(start, end === -1 ? content.length : end);
}

export function checkUnsafeApis(
  fileContents: Record<string, string>,
  issues: IssueInput[],
  opts?: {
    skipFiles?: ReadonlySet<string>;
    /** AST-confirmed hits (Phase 1) folded into this one finding, so the two never collide in dedupe. */
    extraHits?: { file: string; line: number; label: string }[];
  },
) {
  const hits: Hit[] = [];
  const signals: Signal[] = [];

  for (const [file, content] of Object.entries(fileContents)) {
    if (SKIP_FILE.test(file) || !content) continue;
    // Files already handled by the AST pass (Phase 1) are skipped here so the regex rule never
    // double-reports or contradicts the more precise AST result.
    if (opts?.skipFiles?.has(file)) continue;

    for (const { label, regex, ext } of UNSAFE_PATTERNS) {
      if (ext && !ext.test(file)) continue;
      regex.lastIndex = 0;
      for (const m of content.matchAll(regex)) {
        const line = lineText(content, m.index ?? 0);
        // Skip commented lines
        if (/^\s*(\/\/|#|\*|<!--)/.test(line)) continue;
        const userAdjacent = USER_INPUT_HINT.test(line);
        hits.push({
          file,
          line: lineOf(content, m.index ?? 0),
          label,
          userAdjacent,
        });
        signals.push({ kind: "heuristic", detail: `${label} in ${file}` });
      }
    }
  }

  // Fold in AST-confirmed hits (Phase 1) so JS/TS and non-JS unsafe calls land in ONE finding — a
  // separate issue with the same fixId would be dropped by dedupeIssues on a polyglot repo.
  const astConfirmed = opts?.extraHits ?? [];
  for (const h of astConfirmed) {
    hits.push({ file: h.file, line: h.line, label: h.label, userAdjacent: false });
    // AST-confirmed at a real call site (not a heuristic string/comment match).
    signals.push({ kind: "exact_match", detail: `${h.label} in ${h.file}` });
  }

  if (hits.length === 0) return;

  const anyUserAdjacent = hits.some((h) => h.userAdjacent);
  const shown = hits
    .slice(0, 5)
    .map((h) => `${h.label} in ${h.file}:${h.line}`)
    .join("; ");
  const more = hits.length > 5 ? ` +${hits.length - 5} more.` : "";

  issues.push({
    category: "Security",
    title: `Unsafe API usage (${hits.length} found)`,
    severity: anyUserAdjacent ? "high" : "medium",
    why: anyUserAdjacent
      ? "Dangerous APIs appear near user-input or env-driven values. If attacker-controlled data reaches them, this becomes remote code execution or deserialization attacks."
      : "Dangerous APIs (`eval`, process spawn, unsafe deserialization) are present in source. Even without clear user-input wiring, they raise the blast radius of any future input-handling bug.",
    timeSaved: "2h",
    fixId: "security-unsafe-api",
    checkedFor: [
      "eval / new Function",
      "child_process exec/spawn",
      "pickle/marshal/yaml.load",
      "unserialize / system",
      "up to ~40 sampled source files (not the full repo tree)",
    ],
    foundEvidence: `Found: ${shown}.${more}`,
    confidence: confidenceFromSignals(signals),
    recommendedFix:
      "Replace eval/dynamic Function with safe parsers; avoid shelling out with user input; use safe loaders (yaml.safe_load, JSON) instead of pickle/unserialize.",
  });
}
