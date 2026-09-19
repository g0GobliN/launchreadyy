/**
 * Per-repo build overrides.
 *
 * Detection stays the default — these values exist only to correct a wrong guess:
 * an app that lives in a monorepo subdirectory, or a build script we didn't find.
 * Every field here is user input that ends up inside a shell command in the
 * sandbox, so normalization throws on anything unsafe rather than quietly
 * repairing something the user didn't mean.
 */

export type BuildSettings = {
  /** Repo-relative directory the app lives in, or null for the repo root. */
  rootDir: string | null;
  /** Replaces the detected build command when set. */
  buildCommand: string | null;
  /** Wins over .nvmrc and package.json engines when set. */
  nodeVersion: string | null;
  includeTest: boolean;
};

export const EMPTY_BUILD_SETTINGS: BuildSettings = {
  rootDir: null,
  buildCommand: null,
  nodeVersion: null,
  includeTest: false,
};

const MAX_ROOT_DIR_LEN = 200;
const MAX_BUILD_COMMAND_LEN = 500;
/** Deliberately narrow: no spaces, no quotes, no shell metacharacters, no backslashes. */
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/** "./apps/web/" → "apps/web". Blank and "." both mean the repo root (null). */
export function normalizeRootDir(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim().replace(/^\.\//, "");
  const stripped = trimmed.replace(/^\/+|\/+$/g, "");
  if (!stripped || stripped === ".") return null;
  if (stripped.length > MAX_ROOT_DIR_LEN) {
    throw new Error(`Root directory is too long (max ${MAX_ROOT_DIR_LEN} characters).`);
  }
  const segments = stripped.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw new Error("Root directory cannot contain '..' — it must stay inside the repository.");
    }
    if (!SEGMENT_RE.test(segment)) {
      throw new Error(
        `Invalid root directory segment "${segment}" — use letters, numbers, dot, dash, underscore.`,
      );
    }
  }
  return segments.join("/");
}

/**
 * Build commands are arbitrary shell by nature, and that is not a new exposure:
 * the sandbox already runs whatever the repo's own package.json scripts say, in an
 * isolated e2b VM belonging to the person who asked for the run. What we do enforce
 * is one single line, so a pasted value can't smuggle extra steps past the audit log.
 */
export function normalizeBuildCommand(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_BUILD_COMMAND_LEN) {
    throw new Error(`Build command is too long (max ${MAX_BUILD_COMMAND_LEN} characters).`);
  }
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error("Build command must be a single line with no control characters.");
  }
  return trimmed;
}

/**
 * "v22" / "22.13" / "22.13.0" → the bare version. A bare major is fine and often
 * better: it resolves against nodejs.org's release index at run time, so the sandbox
 * tracks the newest patch instead of freezing on whichever one was current today.
 */
export function normalizeNodeVersion(input: string | null | undefined): string | null {
  if (input == null) return null;
  const cleaned = input.trim().replace(/^v/i, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d+){0,2}$/.test(cleaned)) {
    throw new Error('Node version must look like "22", "22.13", or "22.13.0".');
  }
  return cleaned;
}

/** Resolve a repo-relative file path against the configured root directory. */
export function repoPath(rootDir: string | null | undefined, relative: string): string {
  return rootDir ? `${rootDir}/${relative}` : relative;
}
