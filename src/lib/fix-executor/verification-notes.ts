/**
 * The sandbox-verification notes, in one place.
 *
 * These strings are written where the verdict is known (`github.functions.ts`) and read where the
 * PR body is composed (`pr.ts`). Defining them in either of those modules means the other has to
 * know the exact wording — the first version recovered the skip reason by running regexes over the
 * finished sentence, so rewording the message in one file silently degraded the other, and tests
 * that built their own copy of the prose could not catch it.
 *
 * @see src/lib/fix-executor/pr-body.test.ts
 */

import type { VerificationNote } from "./types";

export const SANDBOX_VERIFY_FIX_ID = "sandbox-verify";

/** Opens the unverified banner. Kept short — the reason follows it. */
export const UNVERIFIED_HEADLINE = "Not verified in a sandbox.";

const REVIEW_ADVICE = "Review the diff and run it locally before merging.";

/** Recorded when the pre-PR sandbox ran and the change survived it. */
export function sandboxPassedNote(testsRan: boolean): VerificationNote {
  return {
    fixId: SANDBOX_VERIFY_FIX_ID,
    status: "verified",
    note: testsRan
      ? "Build, lint and the generated tests all passed in an isolated sandbox before this PR was opened."
      : "Build and lint passed in an isolated sandbox before this PR was opened. Tests were not run, so this shows the project still builds — not that behaviour is unchanged.",
  };
}

/**
 * Recorded when verification was skipped. Six ordinary conditions reach here — flag off, no
 * provider, operator budget, unsupported ecosystem, no commands — so this is a routine
 * state rather than an incident, and the PR has to say it rather than imply it by omission.
 */
export function sandboxSkippedNote(reason: string): VerificationNote {
  return {
    fixId: SANDBOX_VERIFY_FIX_ID,
    status: "warning",
    reason,
    note: `Not verified — the sandbox did not run (${reason}). This change was not built, linted or tested before the PR was opened. ${REVIEW_ADVICE}`,
  };
}

/**
 * The PR-body banner for a PR that was not sandbox-verified.
 *
 * `reason` is absent both for notes written before it was carried and for code paths that never
 * attempt verification at all. Those PRs are equally unverified, so they get the same warning
 * without a cause attached — never a softer one.
 */
export function unverifiedBanner(reason?: string): string {
  const cause = reason
    ? `The sandbox did not run (${reason}).`
    : "This change was not built, linted or tested before the PR was opened.";
  return `\n> ⚠️ **${UNVERIFIED_HEADLINE}** ${cause} ${REVIEW_ADVICE}\n`;
}
