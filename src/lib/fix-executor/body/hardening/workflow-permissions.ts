/**
 * Fix for `workflow-permissions`: give each workflow an explicit, least-privilege token.
 *
 * The finding is cheap to describe and easy to get wrong in the fix. `contents: read` is correct
 * for the overwhelming majority of workflows and **breaks** the minority that push commits, cut
 * releases or open pull requests — and a fix that reds someone's CI is worse than the finding it
 * closed. So a workflow that shows any sign of needing write access is left alone and reported,
 * rather than edited hopefully.
 */

/** Actions and commands that cannot work under `contents: read`. */
const NEEDS_WRITE = [
  // Commands
  /\bgit\s+push\b/,
  /\bgit\s+commit\b/,
  /\bgh\s+release\s+create\b/,
  /\bgh\s+pr\s+(create|merge|edit)\b/,
  /\bgh\s+issue\s+(create|edit|comment)\b/,
  /\bnpm\s+publish\b/,
  // Actions whose whole purpose is writing back to the repository
  /peter-evans\/create-pull-request/,
  /peter-evans\/create-or-update-comment/,
  /EndBug\/add-and-commit/,
  /stefanzweifel\/git-auto-commit-action/,
  /softprops\/action-gh-release/,
  /actions\/create-release/,
  /ncipollo\/release-action/,
  /googleapis\/release-please-action/,
  /changesets\/action/,
  /semantic-release/,
  /actions\/stale/,
  /actions\/labeler/,
  /JamesIves\/github-pages-deploy-action/,
  /docker\/login-action/,
  /actions\/deploy-pages/,
  /actions\/upload-pages-artifact/,
];

/**
 * True when the workflow does something `contents: read` would deny. Deliberately generous: a
 * false "needs write" costs one unfixed finding, a false "safe to restrict" costs a broken
 * pipeline the user has to debug from a PR we opened.
 */
export function workflowNeedsWriteAccess(content: string): boolean {
  return NEEDS_WRITE.some((re) => re.test(content));
}

const WRITE_ALL = /^([ \t]*)permissions:[ \t]*write-all[ \t]*$/gm;
const TOP_LEVEL_PERMISSIONS = /^permissions:/m;
const JOBS_KEY = /^jobs:[ \t]*(#.*)?$/;

/**
 * Add a least-privilege `permissions:` block, or narrow an existing `write-all`.
 *
 * Returns `null` when nothing was changed — the workflow already restricts the token, or it has
 * no top-level `jobs:` key to anchor an insertion, which means it is not a workflow we understand
 * well enough to edit.
 */
export function restrictWorkflowPermissions(content: string): string | null {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";

  // `write-all` is an explicit grant, so narrowing it in place preserves whatever indentation it
  // had — top level or on one job.
  let next = content.replace(
    WRITE_ALL,
    (_m, indent: string) => `${indent}permissions:${eol}${indent}  contents: read`,
  );
  const narrowedWriteAll = next !== content;

  if (!TOP_LEVEL_PERMISSIONS.test(next)) {
    const lines = next.split(/\r?\n/);
    // `jobs:` is the one key every workflow has at column 0, so it is a reliable anchor. YAML
    // mapping keys are unordered, so inserting immediately above it is valid wherever it sits.
    const jobsIdx = lines.findIndex((l) => JOBS_KEY.test(l));
    if (jobsIdx === -1) return narrowedWriteAll ? next : null;
    // Most workflows already separate their top-level keys with a blank line; adding another
    // would leave a double gap where we edited, which reads as carelessness in a PR diff.
    const spacer = (lines[jobsIdx - 1] ?? "").trim() === "" ? [] : [""];
    lines.splice(jobsIdx, 0, "permissions:", "  contents: read", ...spacer);
    next = lines.join(eol);
  }

  return next === content ? null : next;
}
