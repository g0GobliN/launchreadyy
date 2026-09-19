import { describe, expect, it } from "vitest";
import { buildPrBody } from "./pr";
import { sandboxPassedNote, sandboxSkippedNote } from "./verification-notes";
import type { VerificationNote } from "./types";

/**
 * The sandbox-verification disclosure.
 *
 * `verifyBeforePr` blocks the PR when a sandbox run fails, but it *skips* on six ordinary
 * conditions — flag off, no provider, operator budget, unsupported ecosystem, no
 * commands — and the PR opens anyway. Before this, a skip added nothing to the body, so an
 * unverified PR and a verified one differed only by the absence of a line, which reads as
 * approval. These cases exist so silence can never mean "we checked" again.
 */
const base = {
  fixIds: ["helmet"],
  files: [{ path: "src/app.ts", content: "x" }],
  baseBranch: "main",
};

// The production builders, deliberately. An earlier version of this file wrote its own copy of
// the note text, which meant rewording the real message would break the PR body while these tests
// stayed green — the failure mode the tests exist to prevent.
const verified: VerificationNote = sandboxPassedNote(false);
const skipped = (reason: string): VerificationNote => sandboxSkippedNote(reason);

describe("buildPrBody — sandbox verification disclosure", () => {
  it("says so when the sandbox verified the change", () => {
    const body = buildPrBody({ ...base, verificationNotes: [verified] });
    expect(body).toContain("_Verified: install/build/lint passed");
    expect(body).not.toContain("Not verified in a sandbox");
  });

  it("warns, and names the reason, when verification was skipped", () => {
    const body = buildPrBody({
      ...base,
      verificationNotes: [skipped("Sandbox concurrency limit reached — skipped pre-PR verify")],
    });
    expect(body).toContain("⚠️ **Not verified in a sandbox.**");
    expect(body).toContain("Sandbox concurrency limit reached");
    expect(body).toContain("run it locally before merging");
  });

  it("carries the skip reason as data, not by re-parsing the sentence", () => {
    const note = sandboxSkippedNote("Operator sandbox budget reached");
    expect(note.reason).toBe("Operator sandbox budget reached");
    const body = buildPrBody({ ...base, verificationNotes: [note] });
    expect(body).toContain("The sandbox did not run (Operator sandbox budget reached).");
  });

  it("still warns for a note persisted before the reason field existed", () => {
    // `pending_verification_notes` rows are re-read from the database, so older ones have no
    // `reason`. Those PRs are just as unverified and must not get a softer message.
    const legacy: VerificationNote = { fixId: "sandbox-verify", status: "warning", note: "old" };
    const body = buildPrBody({ ...base, verificationNotes: [legacy] });
    expect(body).toContain("⚠️ **Not verified in a sandbox.**");
    expect(body).toContain("was not built, linted or tested");
  });

  it("distinguishes a pass with tests from a pass without them", () => {
    expect(sandboxPassedNote(true).note).toContain("generated tests all passed");
    const withoutTests = sandboxPassedNote(false).note;
    expect(withoutTests).toContain("Tests were not run");
    expect(withoutTests).toContain("not that behaviour is unchanged");
  });

  it("warns even when no verification was attempted at all", () => {
    // `createPR` never calls verifyBeforePr, so there is no sandbox-verify note to find. That PR
    // is every bit as unverified as a skipped one and must not read as though it passed.
    const body = buildPrBody({ ...base, verificationNotes: [] });
    expect(body).toContain("⚠️ **Not verified in a sandbox.**");
    expect(body).toContain("was not built, linted or tested");
  });

  it("never claims verification on the undefined-notes path", () => {
    const body = buildPrBody(base);
    expect(body).toContain("⚠️ **Not verified in a sandbox.**");
    expect(body).not.toContain("_Verified:");
  });

  it("tells the reader to run the build themselves when unverified", () => {
    const body = buildPrBody({ ...base, verificationNotes: [skipped("Sandbox disabled")] });
    expect(body).toContain("npm run lint");
    expect(body).not.toContain("Sandbox already verified");
  });
});

describe("buildPrBody — verification table", () => {
  it("labels a skipped sandbox 'not verified', not 'needs manual step'", () => {
    const body = buildPrBody({ ...base, verificationNotes: [skipped("Sandbox disabled")] });
    expect(body).toContain("⚠️ not verified");
    expect(body).not.toContain("⚠️ needs manual step");
  });

  it("still labels a genuine manual step 'needs manual step'", () => {
    const body = buildPrBody({
      ...base,
      verificationNotes: [{ fixId: "monitoring", status: "warning", note: "Add your Sentry DSN." }],
    });
    expect(body).toContain("⚠️ needs manual step");
  });

  it("escapes a pipe in a skip reason so the table row survives", () => {
    // The reason can carry a provider error verbatim, and an unescaped `|` silently splits the
    // row — losing the very warning this table exists to show.
    const body = buildPrBody({
      ...base,
      verificationNotes: [skipped("provider said: a | b")],
    });
    const row = body.split("\n").find((l) => l.startsWith("| ") && l.includes("not verified"))!;
    expect(row).toContain("a \\| b");
    // Only unescaped pipes are cell separators: leading, two dividers, trailing.
    expect(row.match(/(?<!\\)\|/g)).toHaveLength(4);
  });

  it("flattens newlines in a note so they cannot break the table", () => {
    const body = buildPrBody({ ...base, verificationNotes: [skipped("line one\nline two")] });
    const row = body.split("\n").find((l) => l.includes("not verified"))!;
    expect(row).toContain("line one line two");
  });
});
