import { describe, expect, it } from "vitest";
import { parseLiveLogLines } from "./sandbox-log-lines";

describe("parseLiveLogLines", () => {
  it("returns empty for blank log", () => {
    expect(parseLiveLogLines("")).toEqual([]);
    expect(parseLiveLogLines("   ")).toEqual([]);
  });

  it("classifies success, error, and command lines", () => {
    const lines = parseLiveLogLines("npm install\n✓ 12 packages\nerror: build failed");
    expect(lines).toHaveLength(3);
    expect(lines[0].type).toBe("command");
    expect(lines[1].type).toBe("success");
    expect(lines[2].type).toBe("error");
  });

  it("does not treat keywords inside asset filenames as errors", () => {
    const lines = parseLiveLogLines(
      [
        "dist/client/assets/auth-error-screen-B3DdWTQD.js   2.21 kB | gzip: 1.01 kB",
        "dist/client/assets/checkout_.success-BajyZl9m.js    1.19 kB | gzip: 0.61 kB",
        "dist/client/assets/launch-blockers-hnTJH6ad.js      3.99 kB | gzip: 1.73 kB",
      ].join("\n"),
    );
    expect(lines.map((l) => l.type)).toEqual(["output", "output", "output"]);
  });

  it("reads an eslint summary with zero errors as a pass", () => {
    const lines = parseLiveLogLines(
      ["✖ 3 problems (0 errors, 3 warnings)", "✖ 2 problems (2 errors, 0 warnings)"].join("\n"),
    );
    expect(lines[0].type).toBe("warning");
    expect(lines[1].type).toBe("error");
  });

  it("still flags real failures that mention a path", () => {
    const lines = parseLiveLogLines(
      [
        "src/routes/index.tsx:12:5 - error TS2345: Argument of type 'x'",
        "Command failed with exit code 1.",
        "[vite]: Rollup failed to resolve import ./missing",
      ].join("\n"),
    );
    expect(lines.map((l) => l.type)).toEqual(["error", "error", "error"]);
  });
});
