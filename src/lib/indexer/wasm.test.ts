import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hashContent } from "../scan-engine/incremental";
import { indexRepository } from "./index";

// Loads the real wasm-pack artifact and proves it produces the same output as the TS reference.
// The artifact lives in the gitignored `pkg/` (rebuild with
// `wasm-pack build rust/crates/indexer --target web -- --features wasm`), so this test skips when it
// hasn't been built — the WASM path is an optional accelerator and must never fail `npm test`.
const WASM_PATH = "rust/crates/indexer/pkg/launchreadyy_indexer_bg.wasm";
const GLUE = "../../../rust/crates/indexer/pkg/launchreadyy_indexer.js";
const built = existsSync(WASM_PATH);

describe.skipIf(!built)("WASM indexer (wasm-pack artifact)", () => {
  it("fnv1a_hex matches the TS hashContent (incl. Unicode/emoji)", async () => {
    const wasm = await import(/* @vite-ignore */ GLUE);
    wasm.initSync({ module: readFileSync(WASM_PATH) });
    for (const s of ["", "a", "hello world", "café", "你好世界", "😀🎉"]) {
      expect(wasm.fnv1a_hex(s), `hash ${JSON.stringify(s)}`).toBe(hashContent(s));
    }
  });

  it("index_files_json matches the TS indexRepository (filtering + hashes + byte size)", async () => {
    const wasm = await import(/* @vite-ignore */ GLUE);
    wasm.initSync({ module: readFileSync(WASM_PATH) });

    const files = [
      { path: "src/a.ts", content: "eval(x);\n你好\n" },
      { path: "node_modules/dep/i.js", content: "skip me" }, // filtered by both
    ];
    const wasmIdx = JSON.parse(wasm.index_files_json(JSON.stringify(files))) as {
      files: { path: string; hash: string; size: number; lines: number }[];
      totalBytes: number;
      totalLines: number;
    };
    const tsIdx = indexRepository(files);

    expect(wasmIdx.files.map((f) => f.path)).toEqual(tsIdx.files.map((f) => f.path));
    expect(wasmIdx.totalBytes).toBe(tsIdx.totalBytes);
    expect(wasmIdx.totalLines).toBe(tsIdx.totalLines);
    expect(wasmIdx.files[0].hash).toBe(tsIdx.files[0].hash);
    expect(wasmIdx.files[0].size).toBe(tsIdx.files[0].size);
  });

  it("extract_imports_json matches findImports on a barrel + require file", async () => {
    const wasm = await import(/* @vite-ignore */ GLUE);
    wasm.initSync({ module: readFileSync(WASM_PATH) });
    const { findImports, parseSource } = await import("../scanner/ast");

    const files = [
      {
        path: "src/barrel.ts",
        content: `export { a } from "./a";\nexport * from "./b";\nconst x = require("pg");`,
      },
      { path: "src/thing.test.ts", content: `import x from "./x";` }, // TS AST skips test files
    ];
    const out = JSON.parse(wasm.extract_imports_json(JSON.stringify(files))) as {
      path: string;
      imports: string[];
    }[];

    expect(out).toHaveLength(2);
    const expected0 = [
      ...new Set(findImports((await parseSource(files[0].path, files[0].content)).tree!)),
    ].sort();
    expect([...out[0].imports].sort()).toEqual(expected0);
    expect(out[1].imports).toEqual([]);
  });

  it("extract_unsafe_calls_json matches findUnsafeCalls (omits skipped/non-JS)", async () => {
    const wasm = await import(/* @vite-ignore */ GLUE);
    wasm.initSync({ module: readFileSync(WASM_PATH) });
    const { findUnsafeCalls } = await import("../scanner/ast/rules/unsafe-calls");

    const files = [
      {
        path: "src/danger.ts",
        content: [
          "const warning = 'never use eval()';",
          "eval(userInput);",
          "cp.exec('ls');",
          "const f = new Function('a', 'return a');",
        ].join("\n"),
      },
      { path: "src/thing.test.ts", content: "eval(x);\n" },
      { path: "app.py", content: "eval(x)\n" },
    ];
    const out = JSON.parse(wasm.extract_unsafe_calls_json(JSON.stringify(files))) as {
      path: string;
      hits: { label: string; line: number }[];
    }[];

    // Only danger.ts is handled; test/non-JS omitted so TS/regex can cover them.
    expect(out.map((f) => f.path)).toEqual(["src/danger.ts"]);
    const expected = (await findUnsafeCalls(files[0].path, files[0].content))!;
    expect(out[0].hits.map((h) => `${h.line}:${h.label}`).sort()).toEqual(
      expected.map((h) => `${h.line}:${h.label}`).sort(),
    );
  });
});
