import { describe, expect, it } from "vitest";
import { findUnsafeCalls } from "./rules/unsafe-calls";
import { rustExtractUnsafeCalls } from "./rust-unsafe.server";
import { rustIndexerBinary } from "../../indexer/rust-backend.server";

const binary = rustIndexerBinary();

const SOURCES = [
  {
    path: "src/danger.ts",
    content: [
      "const warning = 'never use eval() in production';",
      "// remember: eval() is dangerous",
      "const result = eval(userInput);",
      "cp.exec('ls');",
      "const f = new Function('a', 'return a + 1');",
    ].join("\n"),
  },
  { path: "src/clean.ts", content: "export const x = 1;\n" },
  { path: "src/thing.test.ts", content: "eval(x);\n" }, // skipped — must be omitted
  { path: "app.py", content: "eval(user_input)\n" }, // non-JS — omitted
];

describe.skipIf(!binary)("rustExtractUnsafeCalls — parity with findUnsafeCalls", () => {
  it("agrees on handled files and hit labels/lines", async () => {
    const rust = rustExtractUnsafeCalls(SOURCES);
    expect(rust).not.toBeNull();

    const byPath = new Map(rust!.map((f) => [f.path, f.hits]));

    for (const { path, content } of SOURCES) {
      const expected = await findUnsafeCalls(path, content);
      if (expected === null) {
        expect(byPath.has(path), `Rust must omit unhandled ${path}`).toBe(false);
        continue;
      }
      const got = byPath.get(path);
      expect(got, `Rust must handle ${path}`).toBeDefined();
      expect(got!.map((h) => `${h.line}:${h.label}`).sort()).toEqual(
        expected.map((h) => `${h.line}:${h.label}`).sort(),
      );
    }
  });
});
