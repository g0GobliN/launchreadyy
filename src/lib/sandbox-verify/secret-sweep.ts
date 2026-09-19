/**
 * Whole-repository secret sweep (deep tier).
 *
 * The fast tier reads at most ~35 sampled files, because each one costs a GitHub API round trip —
 * so a key sitting in the 200th file is invisible to it. The sandbox already has the entire
 * repository checked out on disk, so a single `grep` pass covers every file for the price of one
 * command.
 *
 * This is deliberately a *pre-filter*, not a second secret scanner: it narrows thousands of files
 * down to the handful that contain something secret-shaped, and `scanner/security/secrets` remains
 * the one authoritative implementation that decides what is actually reported. Two detectors that
 * can disagree is a bug factory; one detector with a cheap candidate filter in front is not.
 *
 * Patterns here are intentionally looser than the authoritative ones (case-insensitive, no word
 * boundaries). Over-matching costs one file read; under-matching means a missed credential.
 */

import type { IssueInput } from "../scanner-rules";
import { checkHardcodedSecrets } from "../scanner/security/secrets";
import { grepExcludeArgs } from "../scanner/non-shipping-paths";

/**
 * POSIX ERE alternatives, mirroring `PROVIDER_PATTERNS` in scanner/security/secrets.
 *
 * Deliberately free of `'` and `"`: the pattern is interpolated into a single-quoted shell
 * argument, and a quote inside it would end the argument early. The generic-assignment branch
 * therefore matches the *shape* (`token = <20+ chars>`) rather than the exact quoting.
 */
const SWEEP_PATTERNS = [
  "AKIA[0-9A-Z]{16}",
  "[sr]k_live_[0-9a-zA-Z]{20,}",
  "gh[pousr]_[A-Za-z0-9]{36,}",
  "github_pat_[A-Za-z0-9_]{22,}",
  "xox[baprs]-[0-9A-Za-z-]{10,}",
  "sk-ant-[A-Za-z0-9_-]{20,}",
  "AIza[0-9A-Za-z_-]{35}",
  "npm_[A-Za-z0-9]{36}",
  "-----BEGIN[ A-Z]*PRIVATE KEY",
  "(api[_-]?key|apikey|secret|token|passwd|password).{0,3}[:=].{0,3}[A-Za-z0-9+/_=-]{20,}",
];

/**
 * Upper bound on candidate files carried back to the Worker. Each one costs a GitHub read, and a
 * repo that trips the filter more than this is already reporting plenty — the count is disclosed
 * so a truncated sweep never looks like a clean one.
 */
export const MAX_SWEEP_CANDIDATES = 100;

/**
 * `grep` walks the tree natively, skips binaries with `-I`, and prints one path per match with
 * `-l`. Values never leave the sandbox — only paths — so the log cannot leak a key.
 *
 * `|| true` because grep exits 1 when nothing matches, which is the *good* outcome here, not a
 * failed step.
 */
export function secretSweepCommand(): string {
  const excludes = grepExcludeArgs();
  const pattern = SWEEP_PATTERNS.join("|");
  return `grep -rIlEi ${excludes} -e '${pattern}' . 2>/dev/null | head -${MAX_SWEEP_CANDIDATES} || true`;
}

/**
 * Fix ids the whole-repo sweep supersedes. The fast tier reports these from a ~35-file sample; once
 * the sandbox has grepped every file, keeping both would show the same leak twice with two
 * different counts. The deep-tier result is a strict superset, so it replaces rather than adds.
 */
export const SWEEP_SUPERSEDES_FIX_IDS = [
  "security-hardcoded-secret",
  "security-secret-heuristic",
] as const;

/**
 * Run the authoritative secret check over every candidate the sweep surfaced.
 *
 * `readFile` is injected so this is unit-testable without a GitHub client; in production it's the
 * same provider the scan uses. Reads are batched because each one is a network round trip.
 */
export async function issuesFromSecretSweep(opts: {
  stdout: string;
  readFile: (path: string) => Promise<string | null>;
  verifiedAt: string;
}): Promise<IssueInput[]> {
  const paths = parseSweepPaths(opts.stdout);
  if (paths.length === 0) return [];

  const fileContents: Record<string, string> = {};
  const BATCH = 8;
  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((p) => opts.readFile(p).catch(() => null)));
    batch.forEach((p, j) => {
      const content = results[j];
      if (content) fileContents[p] = content;
    });
  }
  if (Object.keys(fileContents).length === 0) return [];

  const truncated = paths.length >= MAX_SWEEP_CANDIDATES;
  const scopeNote = truncated
    ? `every file in the repository (candidate list capped at ${MAX_SWEEP_CANDIDATES} files — more may exist)`
    : "every file in the repository, scanned on disk in an isolated sandbox";

  const issues: IssueInput[] = [];
  checkHardcodedSecrets(fileContents, issues, { scopeNote });
  return issues.map((issue) => ({
    ...issue,
    detection: [...(issue.detection ?? []), "sandbox-verified"],
    verifiedAt: opts.verifiedAt,
  }));
}

/** Repo-relative candidate paths from the sweep's stdout. */
export function parseSweepPaths(stdout: string): string[] {
  const seen = new Set<string>();
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // grep prints "./src/config.ts" when handed "." as the search root.
    const path = line.replace(/^\.\//, "");
    // Defensive: a path that escaped the checkout is never something we should read back.
    if (!path || path.startsWith("/") || path.split("/").includes("..")) continue;
    seen.add(path);
  }
  return [...seen];
}
