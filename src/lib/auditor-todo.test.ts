import { describe, expect, it } from "vitest";
import { runAuditor, type AuditorContext } from "./readiness/auditor";

import type { AuditorLanguage } from "./auditor-lang.server";

// Minimal AuditorContext builder — only fields the TODO scan needs
function ctx(files: Record<string, string>, language: AuditorLanguage = "node"): AuditorContext {
  return {
    files: Object.keys(files),
    fileContents: files,
    envExampleContent: null,
    deps: {},
    framework: "Next.js",
    language,
  };
}

// Helper: does the result include a todo-markers finding?
function hasTodoFinding(
  files: Record<string, string>,
  language: AuditorLanguage = "node",
): boolean {
  const issues = runAuditor(ctx(files, language));
  return issues.some((i) => i.fixId === "auditor-todo-markers");
}

// ── FALSE POSITIVE TESTS ────────────────────────────────────────────────────
// These are the exact patterns that caused 8 files to be wrongly included.
// None of these should trigger the todo-markers finding.

describe("auditor TODO scanner — must NOT flag these", () => {
  it("ignores JSX placeholder attribute", () => {
    const file = `
export function Input({ value }: { value: string }) {
  return <input type="text" placeholder="Enter your name" value={value} />;
}
export function Input2({ value }: { value: string }) {
  return <input type="text" placeholder="Enter your name" value={value} />;
}
export function Input3({ value }: { value: string }) {
  return <input type="text" placeholder="Enter your name" value={value} />;
}`;
    expect(hasTodoFinding({ "a.ts": file, "b.ts": file, "c.ts": file })).toBe(false);
  });

  it("ignores textarea placeholder prop in React", () => {
    const file = `
export function NoteField() {
  return <textarea placeholder="Optional note…" rows={3} />;
}
export function NoteField2() {
  return <textarea placeholder="Optional note…" rows={3} />;
}
export function NoteField3() {
  return <textarea placeholder="Optional note…" rows={3} />;
}`;
    expect(hasTodoFinding({ "a.tsx": file, "b.tsx": file, "c.tsx": file })).toBe(false);
  });

  it("ignores placeholder string in TYPE_OPTS array (feedback-modal pattern)", () => {
    const file = `
const OPTS = [
  { value: "bug", placeholder: "What went wrong?" },
  { value: "idea", placeholder: "What would help?" },
];`;
    expect(hasTodoFinding({ "a.ts": file, "b.ts": file, "c.ts": file })).toBe(false);
  });

  it("ignores placeholder CSS variable names", () => {
    const file = `
const style = {
  color: "var(--placeholder-color)",
  background: "placeholder-bg",
};`;
    expect(hasTodoFinding({ "a.ts": file, "b.ts": file, "c.ts": file })).toBe(false);
  });

  it("ignores eslint-disable-next-line comments", () => {
    const file = `
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const x = 1;`;
    expect(hasTodoFinding({ "a.ts": file, "b.ts": file, "c.ts": file })).toBe(false);
  });
});

// ── TRUE POSITIVE TESTS ─────────────────────────────────────────────────────
// These MUST trigger the finding (threshold is 3 files).

describe("auditor TODO scanner — must flag these", () => {
  it("flags // TODO: comment markers", () => {
    const file = (n: number) => `
export function doThing${n}() {
  // TODO: implement this
  return null;
}`;
    expect(hasTodoFinding({ "a.ts": file(1), "b.ts": file(2), "c.ts": file(3) })).toBe(true);
  });

  it("flags // FIXME: comment markers", () => {
    const file = (n: number) => `
export function thing${n}() {
  // FIXME: this breaks on edge cases
  return 0;
}`;
    expect(hasTodoFinding({ "a.ts": file(1), "b.ts": file(2), "c.ts": file(3) })).toBe(true);
  });

  it("flags // Placeholder — activate when needed (gemini/openai pattern)", () => {
    const file = (n: number) => `
// Placeholder — activate when needed.
export class Provider${n} {
  generate() { throw new Error("not active"); }
}`;
    expect(hasTodoFinding({ "a.ts": file(1), "b.ts": file(2), "c.ts": file(3) })).toBe(true);
  });

  it("flags # TODO in Python files", () => {
    const file = (n: number) => `
def do_thing_${n}():
    # TODO: implement
    pass`;
    expect(hasTodoFinding({ "a.py": file(1), "b.py": file(2), "c.py": file(3) }, "python")).toBe(
      true,
    );
  });

  it("flags // HACK: markers", () => {
    const file = (n: number) => `
export function get${n}() {
  // HACK: remove before prod
  return hardcodedValue${n};
}`;
    expect(hasTodoFinding({ "a.ts": file(1), "b.ts": file(2), "c.ts": file(3) })).toBe(true);
  });

  it("does not trigger with only 2 files (threshold is 3)", () => {
    const file = `
export function thing() {
  // TODO: implement
  return null;
}`;
    expect(hasTodoFinding({ "a.ts": file, "b.ts": file })).toBe(false);
  });
});
