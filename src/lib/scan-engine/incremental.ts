/**
 * Incremental scanning (v2 Phase 3): detect which files changed since the last scan and rerun only
 * the rules whose inputs are affected, carrying forward the rest. Pure and deterministic so it's
 * fully unit-testable; the server wiring (loading prior hashes, gating on `flag_incremental_scan`)
 * lives at the call site.
 *
 * @see docs/README.md  (Phase 3)
 */

/** Stable, fast, non-cryptographic content fingerprint (FNV-1a, 32-bit, hex). */
export function hashContent(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    // h *= 16777619, kept in 32-bit range via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** path → content hash. */
export type FileHashes = Record<string, string>;

export interface FileDiff {
  added: string[];
  modified: string[];
  removed: string[];
  unchanged: string[];
}

/** Diff two hash maps into added/modified/removed/unchanged sets. */
export function diffChangedFiles(prev: FileHashes, current: FileHashes): FileDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];
  for (const [path, hash] of Object.entries(current)) {
    if (!(path in prev)) added.push(path);
    else if (prev[path] !== hash) modified.push(path);
    else unchanged.push(path);
  }
  const removed = Object.keys(prev).filter((p) => !(p in current));
  return { added, modified, removed, unchanged };
}

/** Every path that is new, edited, or deleted — the set rules must be re-evaluated against. */
export function changedPaths(diff: FileDiff): string[] {
  return [...diff.added, ...diff.modified, ...diff.removed];
}

/**
 * What a rule reads. `repo-wide` reruns on any change (e.g. "has CI?" depends on the whole tree);
 * otherwise the rule reruns only when a changed path matches one of its globs.
 */
export interface RuleInputSpec {
  ruleId: string;
  inputs: "repo-wide" | string[];
}

const REGEX_SPECIAL = ".+?^${}()|[]\\*";

/** Escape a run of glob text so it matches itself and nothing else. */
function escapeLiteral(text: string): string {
  let out = "";
  for (const ch of text) out += REGEX_SPECIAL.includes(ch) ? `\\${ch}` : ch;
  return out;
}

/**
 * Minimal glob → RegExp: supports `**` (any depth), `*` (within a segment), `{a,b}` alternation,
 * and literals. Alternatives are treated as literal text — `{a*,b}` does not expand the `*`.
 *
 * Brace support is load-bearing, not a nicety: nearly every entry in the scan rule manifest is
 * written as `**\/*.{ts,tsx,js}`, and escaping the braces as literals produced a pattern that only
 * matched a file *named* `.{ts,tsx,js}`. Those rules therefore never re-ran on an incremental
 * scan, so their findings were carried forward untouched — a new secret went unreported and a
 * fixed one never cleared.
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          // `**/` spans any number of directories including none, but must stop at a separator so
          // `**/foo.ts` matches `a/foo.ts` and `foo.ts` — never `barfoo.ts`.
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) {
        re += "\\{"; // unbalanced — treat as a literal brace rather than swallowing the rest
      } else {
        const alternatives = glob.slice(i + 1, close).split(",");
        re += `(?:${alternatives.map(escapeLiteral).join("|")})`;
        i = close;
      }
    } else {
      re += escapeLiteral(c);
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

/**
 * Rule ids to rerun given the changed set. A `repo-wide` rule reruns when anything changed; a
 * glob rule reruns when any changed path matches. When nothing changed, nothing reruns.
 */
export function selectRulesToRerun(changed: string[], manifest: RuleInputSpec[]): string[] {
  if (changed.length === 0) return [];
  const out: string[] = [];
  for (const spec of manifest) {
    if (spec.inputs === "repo-wide") {
      out.push(spec.ruleId);
      continue;
    }
    const matched = spec.inputs.some((g) => changed.some((p) => matchesGlob(p, g)));
    if (matched) out.push(spec.ruleId);
  }
  return out;
}

/**
 * Certain changes invalidate assumptions across the whole scan (dependencies, TS/build config, CI,
 * container). When one of these changed, the safe answer is a full rescan, not an incremental one.
 */
const FULL_RESCAN_TRIGGERS = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "tsconfig.json",
  "Dockerfile",
  "go.mod",
  "requirements.txt",
  "pyproject.toml",
  "Gemfile",
  "composer.json",
  "Cargo.toml",
];

export function requiresFullRescan(changed: string[]): boolean {
  return changed.some(
    (p) => FULL_RESCAN_TRIGGERS.includes(p) || p.startsWith(".github/workflows/"),
  );
}

/** A finding tagged with the rule that produced it, for carry-forward. */
export interface CarryForwardFinding {
  ruleId: string;
  [key: string]: unknown;
}

/**
 * Merge prior findings with freshly-rerun ones: keep prior findings whose rule did NOT rerun, drop
 * prior findings whose rule reran (they're superseded — even by an empty result, which means the
 * issue was fixed), and add all rerun findings. Order: carried-forward first, then fresh.
 */
export function mergeCarryForward<T extends CarryForwardFinding>(
  prevFindings: T[],
  reranFindings: T[],
  reranRuleIds: string[],
): T[] {
  const reran = new Set(reranRuleIds);
  const carried = prevFindings.filter((f) => !reran.has(f.ruleId));
  return [...carried, ...reranFindings];
}
