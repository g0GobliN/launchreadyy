import { describe, expect, it } from "vitest";
import { mergeAgentGeneratedFiles } from "./agent-fix.server";

describe("mergeAgentGeneratedFiles", () => {
  it("prefers agent content for overlapping paths", () => {
    const merged = mergeAgentGeneratedFiles(
      [
        { path: "a.ts", content: "old" },
        { path: "b.ts", content: "keep" },
      ],
      [{ path: "a.ts", content: "new" }],
    );
    expect(merged.find((f) => f.path === "a.ts")?.content).toBe("new");
    expect(merged.find((f) => f.path === "b.ts")?.content).toBe("keep");
  });

  it("returns base when agent empty", () => {
    const base = [{ path: "x.ts", content: "1" }];
    expect(mergeAgentGeneratedFiles(base, [])).toEqual(base);
  });
});
