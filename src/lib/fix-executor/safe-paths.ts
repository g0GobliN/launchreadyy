/**
 * Path policy for files this service writes into a user's repository.
 *
 * Two levels, because the two producers are not equally trusted:
 *
 * - {@link isSafeRepoPath} — every committed file, whatever produced it. Structural only:
 *   no traversal, no absolute paths, no writes into `.git/`. Templates legitimately
 *   generate `.github/workflows/ci.yml`, so this level must not block that.
 *
 * - {@link isSafeAgentPath} — additionally applied to model-authored files. The scan reads
 *   an untrusted repository and its contents reach the model, so a repo crafted to steer
 *   the model is a real input. A PR is still human-reviewed before merge, but "the model
 *   proposed a workflow change" should never be a diff a reviewer has to catch: workflow
 *   files execute in CI with repository secrets, and install-time config can redirect a
 *   package registry. Templates own those paths; the agent only fixes code.
 *
 * @see src/lib/fix-executor/safe-paths.test.ts
 */

/** Longest single path segment and total path, matching common filesystem limits. */
const MAX_SEGMENT = 255;
const MAX_PATH = 1024;

/**
 * Repo-root-relative paths that model output must never write.
 *
 * `.github/` covers workflows (arbitrary CI execution with secrets), composite actions, and
 * CODEOWNERS (review-requirement bypass). The dotfiles below all run code or resolve
 * packages at install time.
 */
const AGENT_DENIED_PREFIXES = [".github/"];
const AGENT_DENIED_FILES = new Set([
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  ".gitattributes",
  ".gitmodules",
  "codeowners",
]);

/**
 * Structural safety for any path committed to a repo.
 *
 * Rejects traversal (`../`), absolute and drive-letter paths, backslash separators, empty
 * or dot segments, control characters, percent-encoded traversal, and anything under `.git/`.
 */
export function isSafeRepoPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > MAX_PATH) return false;

  // Control characters and NUL — never valid, and a classic truncation trick.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;

  // Backslashes would be a literal filename on git but a separator on Windows checkouts.
  if (path.includes("\\")) return false;

  // Percent-encoded traversal, in case any consumer decodes downstream.
  if (/%2e%2e|%2f/i.test(path)) return false;

  // Absolute POSIX path, UNC path, or Windows drive letter.
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return false;

  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0) return false; // leading, trailing or doubled slash
    if (segment.length > MAX_SEGMENT) return false;
    if (segment === "." || segment === "..") return false;
    if (segment !== segment.trim()) return false; // leading/trailing whitespace
  }

  // Never write git's own metadata.
  if (segments[0]?.toLowerCase() === ".git") return false;

  return true;
}

/** Structural safety plus the model-output denylist. */
export function isSafeAgentPath(path: unknown): path is string {
  if (!isSafeRepoPath(path)) return false;

  const lower = path.toLowerCase();
  if (AGENT_DENIED_PREFIXES.some((p) => lower.startsWith(p))) return false;
  // CODEOWNERS is valid at the repo root or in docs/ as well as .github/.
  const basename = lower.split("/").pop()!;
  if (AGENT_DENIED_FILES.has(basename) && (basename !== "codeowners" || lower === basename)) {
    return false;
  }
  return true;
}

export type RepoFile = { path: string; content: string };

/**
 * Drop unsafe entries from a file list, reporting what was removed.
 *
 * Filtering rather than throwing is deliberate: one bad path from the model should cost that
 * file, not the whole fix job. Rejections are returned so the caller can log them — a
 * rejection is a signal worth seeing, not routine.
 */
export function filterSafeFiles(
  files: RepoFile[],
  mode: "repo" | "agent" = "repo",
): { safe: RepoFile[]; rejected: string[] } {
  const check = mode === "agent" ? isSafeAgentPath : isSafeRepoPath;
  const safe: RepoFile[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    if (check(file.path)) safe.push(file);
    else rejected.push(String(file.path).slice(0, 200));
  }
  return { safe, rejected };
}
