import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github")>();
  return { ...actual, fetchFileContent: vi.fn() };
});

import { computeDiffsFromFiles, lcsOps, newFileDiffLines, opsToPreviewLines } from "./pr";
import { fetchFileContent } from "./github";

const mockFetch = vi.mocked(fetchFileContent);

const FILE = `import express from "express";
import helmet from "helmet";

const app = express();
app.use(helmet());
export default app;`;

beforeEach(() => mockFetch.mockReset());

describe("lcsOps", () => {
  it("reconstructs both sides from the op stream", () => {
    const a = ["a", "b", "c", "d"];
    const b = ["a", "x", "c", "d", "e"];
    const ops = lcsOps(a, b);
    expect(ops.filter((o) => o.type !== "add").map((o) => o.line)).toEqual(a);
    expect(ops.filter((o) => o.type !== "del").map((o) => o.line)).toEqual(b);
  });

  it("marks identical input as entirely unchanged", () => {
    const ops = lcsOps(["a", "b"], ["a", "b"]);
    expect(ops.every((o) => o.type === "eq")).toBe(true);
    expect(opsToPreviewLines(ops)).toEqual([]);
  });

  /**
   * The LCS table is quadratic and computeDiffsFromFiles diffs every file concurrently, so two
   * large files could exhaust a 128 MB Worker between them. Past the cell cap the precise diff is
   * abandoned for a whole-file replacement rather than allocating the table.
   */
  it("falls back to a whole-file replacement instead of allocating a huge table", () => {
    const a = Array.from({ length: 2100 }, (_, i) => `old ${i}`);
    const b = Array.from({ length: 2100 }, (_, i) => `new ${i}`);
    const ops = lcsOps(a, b);

    expect(ops.some((o) => o.type === "eq")).toBe(false);
    expect(ops.filter((o) => o.type === "del")).toHaveLength(a.length);
    expect(ops.filter((o) => o.type === "add")).toHaveLength(b.length);
    // Still a well-formed op stream: it reconstructs both sides exactly.
    expect(ops.filter((o) => o.type !== "add").map((o) => o.line)).toEqual(a);
    expect(ops.filter((o) => o.type !== "del").map((o) => o.line)).toEqual(b);
  });

  it("still diffs precisely just under the cap", () => {
    const shared = Array.from({ length: 1200 }, (_, i) => `line ${i}`);
    const ops = lcsOps(shared, [...shared.slice(0, 600), "inserted", ...shared.slice(600)]);
    expect(ops.filter((o) => o.type === "add")).toHaveLength(1);
    expect(ops.filter((o) => o.type === "del")).toHaveLength(0);
  });

  it("numbers added lines on the new side only, deleted on the old side only", () => {
    const ops = lcsOps(["keep", "gone"], ["keep", "fresh"]);
    const added = ops.find((o) => o.type === "add")!;
    const deleted = ops.find((o) => o.type === "del")!;
    expect(added.oldNo).toBe(0);
    expect(deleted.newNo).toBe(0);
  });
});

describe("opsToPreviewLines", () => {
  it("emits hunk headers whose counts match the lines they contain", () => {
    const lines = opsToPreviewLines(lcsOps(["a", "b", "c"], ["a", "B", "c"]));
    const header = lines.find((l) => l.type === "hunk")!;
    const [, , oldCount, , newCount] = /@@ -(\d+),(\d+) \+(\d+),(\d+) @@/
      .exec(header.text)!
      .map(Number);
    expect(lines.filter((l) => l.type !== "hunk" && l.type !== "add")).toHaveLength(oldCount!);
    expect(lines.filter((l) => l.type !== "hunk" && l.type !== "del")).toHaveLength(newCount!);
  });
});

describe("computeDiffsFromFiles", () => {
  it("shows a brand-new file as added", async () => {
    mockFetch.mockResolvedValue(null);
    const diffs = await computeDiffsFromFiles("t", "acme/app", [
      { path: "Dockerfile", content: "FROM node:22\n" },
    ]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.status).toBe("added");
  });

  it("shows a real edit as modified with only the changed lines", async () => {
    mockFetch.mockResolvedValue(FILE);
    const diffs = await computeDiffsFromFiles("t", "acme/app", [
      { path: "src/app.ts", content: FILE.replace("express()", "express() /* patched */") },
    ]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.status).toBe("modified");
    // Not a full-file rewrite: the untouched imports stay out of the add set.
    const added = diffs[0]!.lines.filter((l) => l.type === "add");
    expect(added).toHaveLength(1);
    expect(added[0]!.text).toContain("patched");
  });

  /**
   * Regression: when a generated file matched what was already committed, the empty diff fell
   * through to newFileDiffLines, so the review showed the whole existing file as freshly added
   * under a `@@ -0,0 +1,N @@` header. An already-applied fix looked like it would add N lines,
   * and the operator approved a PR that would contain no change at all.
   */
  it("drops a file whose generated content already matches the repo", async () => {
    mockFetch.mockResolvedValue(FILE);
    const diffs = await computeDiffsFromFiles("t", "acme/app", [
      { path: "src/app.ts", content: FILE },
    ]);
    expect(diffs).toEqual([]);
  });

  it("drops a file that differs only in trailing whitespace", async () => {
    mockFetch.mockResolvedValue(FILE);
    const diffs = await computeDiffsFromFiles("t", "acme/app", [
      { path: "src/app.ts", content: `${FILE}\n\n` },
    ]);
    expect(diffs).toEqual([]);
  });

  it("keeps real changes when another file in the same batch is a no-op", async () => {
    mockFetch.mockImplementation(async (_t, _r, path) =>
      path === "src/app.ts" ? FILE : "FROM node:20\n",
    );
    const diffs = await computeDiffsFromFiles("t", "acme/app", [
      { path: "src/app.ts", content: FILE }, // unchanged
      { path: "Dockerfile", content: "FROM node:22\n" }, // real change
    ]);
    expect(diffs.map((d) => d.path)).toEqual(["Dockerfile"]);
  });

  it("still reports validation for the files it keeps", async () => {
    mockFetch.mockResolvedValue(null);
    const diffs = await computeDiffsFromFiles("t", "acme/app", [
      { path: "ci.yml", content: "name: [unclosed\n" },
    ]);
    expect(diffs[0]!.validation.status).toBe("invalid");
  });
});

describe("newFileDiffLines", () => {
  it("counts every line of a new file in its header", () => {
    const lines = newFileDiffLines("a\nb\nc\n");
    expect(lines[0]!.text).toBe("@@ -0,0 +1,3 @@");
    expect(lines.filter((l) => l.type === "add")).toHaveLength(3);
  });
});
