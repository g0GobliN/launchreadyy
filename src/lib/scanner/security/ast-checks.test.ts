import { describe, expect, it, vi } from "vitest";

// `computeAstUnsafeCalls` asks `flag_rust_indexer` which backend to use, and the real lookup goes
// to Supabase for site config. `getFeatureFlags` swallows the failure and caches it, so only the
// first call paid — but that one call exceeded the 15s default timeout on a cold cache and failed
// this file. These cases are about the per-file TS AST path, so pin the flag off and keep the
// unit test off the network entirely.
vi.mock("../../site-config.server", () => ({ isFeatureEnabled: async () => false }));

import { computeAstUnsafeCalls } from "./ast-checks";
import { checkUnsafeApis } from "./unsafe-apis";
import { dedupeIssues, type IssueInput } from "../../scanner-rules";

describe("computeAstUnsafeCalls (Phase 1 wiring)", () => {
  it("returns AST-confirmed hits and marks the file handled", async () => {
    const files = {
      "src/danger.ts": ["const doc = 'never call eval() here';", "eval(userInput);"].join("\n"),
    };
    const { handledFiles, hits } = await computeAstUnsafeCalls(files);
    expect(handledFiles.has("src/danger.ts")).toBe(true);
    // The string-literal eval() on line 1 must NOT be a hit — only the real call on line 2.
    expect(hits).toEqual([{ file: "src/danger.ts", line: 2, label: "eval()" }]);
  });

  it("marks a cleanly-parsed file handled even with no hits (supersedes regex)", async () => {
    const { handledFiles, hits } = await computeAstUnsafeCalls({
      "src/clean.ts": "export const add = (a: number, b: number) => a + b;\n",
    });
    expect(handledFiles.has("src/clean.ts")).toBe(true);
    expect(hits).toEqual([]);
  });

  it("leaves files with no parser to the regex rule (no coverage gap)", async () => {
    const { handledFiles } = await computeAstUnsafeCalls({ "app.py": "eval(user_input)\n" });
    expect(handledFiles.has("app.py")).toBe(false);
  });
});

describe("checkUnsafeApis — folds AST hits into one finding (polyglot dedupe regression)", () => {
  it("merges JS/TS AST hits and non-JS regex hits into a SINGLE issue that survives dedupe", async () => {
    // Repo with unsafe calls in BOTH a JS/TS file (AST) and a Python file (regex).
    const files = {
      "src/a.ts": "eval(x);",
      "app.py": "eval(user_input)",
    };
    const { handledFiles, hits } = await computeAstUnsafeCalls(files);

    const issues: IssueInput[] = [];
    checkUnsafeApis(files, issues, { skipFiles: handledFiles, extraHits: hits });

    // Exactly one security-unsafe-api issue, covering BOTH files.
    const unsafe = issues.filter((i) => i.fixId === "security-unsafe-api");
    expect(unsafe).toHaveLength(1);
    expect(unsafe[0].title).toBe("Unsafe API usage (2 found)");
    expect(unsafe[0].foundEvidence).toContain("src/a.ts");
    expect(unsafe[0].foundEvidence).toContain("app.py");

    // And it survives dedupeIssues (the bug was a second same-fixId issue dropping the AST findings).
    const deduped = dedupeIssues(issues);
    expect(deduped.filter((i) => i.fixId === "security-unsafe-api")).toHaveLength(1);
    expect(deduped.find((i) => i.fixId === "security-unsafe-api")!.foundEvidence).toContain(
      "src/a.ts",
    );
  });

  it("with no extraHits, behaves exactly like the plain regex rule", () => {
    const issues: IssueInput[] = [];
    checkUnsafeApis({ "app.py": "eval(user_input)" }, issues);
    expect(issues.filter((i) => i.fixId === "security-unsafe-api")).toHaveLength(1);
    expect(issues[0].foundEvidence).toContain("app.py");
  });
});
