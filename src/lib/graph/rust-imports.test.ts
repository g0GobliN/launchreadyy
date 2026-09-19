import { describe, expect, it } from "vitest";
import { buildGraphFromSources, extractImportsRegex } from "./index";
import { rustExtractImports } from "./rust-imports.server";
import { rustIndexerBinary } from "../indexer/rust-backend.server";
import { detectAstLanguage, findImports, parseSource } from "../scanner/ast";

/**
 * Import-extraction parity: the Rust `--imports` output must agree with the TypeScript AST layer's
 * `findImports` on the same sources. That equality is what makes the Rust path a true drop-in — a
 * scan must produce the same dependency graph whichever backend ran.
 *
 * Skipped unless the native binary is built (`npm run rust:build`), the same gate
 * `rust-backend.test.ts` uses.
 */
const binary = rustIndexerBinary();

/** The TS AST layer's answer for one file, mirroring buildGraphFromSources' per-file path. */
async function tsImports(path: string, content: string): Promise<string[]> {
  const parsed = await parseSource(path, content);
  if (parsed.available && parsed.tree) return findImports(parsed.tree);
  if (["typescript", "javascript", "tsx", "jsx"].includes(detectAstLanguage(path) ?? "")) {
    return extractImportsRegex(content);
  }
  return [];
}

const SOURCES = [
  {
    path: "src/static.ts",
    content: [
      `import a from "./a";`,
      `import "./bare";`,
      `import { b } from "./b";`,
      `import * as c from "./c";`,
      `export { d } from "./d";`,
      `export * from "./e";`,
    ].join("\n"),
  },
  {
    path: "src/cjs.ts",
    content: [`const pg = require("pg");`, `const lazy = import("./lazy");`].join("\n"),
  },
  {
    path: "src/multiline.ts",
    content: [`import {`, `  alpha,`, `  beta,`, `} from "./wrapped";`].join("\n"),
  },
  {
    path: "src/types.ts",
    content: `import type { T } from "./t";\nimport { useState } from "react";`,
  },
  {
    path: "src/component.tsx",
    content: `import React from "react";\nexport const E = () => <p/>;`,
  },
  // Files the TS side refuses to parse — both backends must yield nothing for these, or enabling
  // the flag would change the graph. Caught by benchmarking real source, where 80 test files
  // diverged before the Rust skip rules matched `language.ts`.
  { path: "src/thing.test.ts", content: `import { it } from "vitest";\nimport x from "./x";` },
  { path: "src/thing.spec.tsx", content: `import y from "./y";` },
  { path: "src/types.d.ts", content: `import type { Z } from "./z";` },
  { path: "public/app.min.js", content: `var a=require("jquery");` },
  // Non-JS: the TS regex branch is gated on a JS/TS language, so Go imports are not graph edges.
  { path: "cmd/main.go", content: `package main\nimport "fmt"` },
];

describe.skipIf(!binary)("rustExtractImports — parity with the TS AST layer", () => {
  it("agrees with findImports on every source", async () => {
    const rust = rustExtractImports(SOURCES);
    expect(rust).not.toBeNull();

    const byPath = new Map(rust!.map((f) => [f.path, [...f.imports].sort()]));

    for (const { path, content } of SOURCES) {
      const expected = [...new Set(await tsImports(path, content))].sort();
      expect(byPath.get(path), `mismatch for ${path}`).toEqual(expected);
    }
  });

  it("produces the same graph through either backend", async () => {
    const viaTs = await buildGraphFromSources(SOURCES);
    const viaRust = await buildGraphFromSources(SOURCES, { extractImports: rustExtractImports });

    const norm = (g: Awaited<ReturnType<typeof buildGraphFromSources>>) =>
      g.edges.map((e) => `${e.from}->${e.to}`).sort();

    expect(norm(viaRust)).toEqual(norm(viaTs));
    expect([...viaRust.nodes.keys()].sort()).toEqual([...viaTs.nodes.keys()].sort());
  });

  it("beats regex on a commented-out import", () => {
    const files = [
      { path: "src/x.ts", content: `// import ghost from "ghost-pkg";\nimport ok from "./ok";` },
    ];
    // Regex sees both specifiers; the AST-backed Rust path sees only the real one.
    expect(extractImportsRegex(files[0].content).sort()).toEqual(["./ok", "ghost-pkg"]);
    expect(rustExtractImports(files)![0].imports).toEqual(["./ok"]);
  });
});

describe("rustExtractImports — degradation", () => {
  it("returns null when no binary is available", () => {
    const saved = process.env.LR_RUST_INDEXER;
    process.env.LR_RUST_INDEXER = "/nonexistent/lr-indexer";
    try {
      // With the env override pointing nowhere, the helper falls back to the repo-relative path; if
      // that is missing too the result is null. Either way it must never throw.
      expect(() => rustExtractImports([{ path: "a.ts", content: "" }])).not.toThrow();
    } finally {
      if (saved === undefined) delete process.env.LR_RUST_INDEXER;
      else process.env.LR_RUST_INDEXER = saved;
    }
  });

  it("falls back to the TS path when the extractor declines", async () => {
    const g = await buildGraphFromSources(
      [
        { path: "src/a.ts", content: `import b from "./b";` },
        { path: "src/b.ts", content: "" },
      ],
      { extractImports: () => null },
    );
    expect(g.edges).toEqual([{ from: "src/a.ts", to: "src/b.ts", kind: "import" }]);
  });
});
