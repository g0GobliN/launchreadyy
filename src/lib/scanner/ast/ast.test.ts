import { describe, expect, it } from "vitest";
import { detectAstLanguage, knownAstLanguages } from "./language";
import { parseSource, findCalls, findImports, findJsxAttributes, findNew, walk } from "./index";
import { ParserRegistry } from "./registry";
import { isTypeScriptBackendAvailable } from "./backends/typescript-backend";
import { findUnsafeCalls } from "./rules/unsafe-calls";

describe("detectAstLanguage", () => {
  it("maps common extensions to languages", () => {
    expect(detectAstLanguage("src/app.ts")).toBe("typescript");
    expect(detectAstLanguage("src/App.tsx")).toBe("tsx");
    expect(detectAstLanguage("index.mjs")).toBe("javascript");
    expect(detectAstLanguage("web/main.jsx")).toBe("jsx");
    expect(detectAstLanguage("cmd/server/main.go")).toBe("go");
    expect(detectAstLanguage("app/models/user.rb")).toBe("ruby");
    expect(detectAstLanguage("src/lib.rs")).toBe("rust");
  });

  it("returns null for non-source, declaration, test, and minified files", () => {
    expect(detectAstLanguage("README.md")).toBeNull();
    expect(detectAstLanguage("types/global.d.ts")).toBeNull();
    expect(detectAstLanguage("src/app.test.ts")).toBeNull();
    expect(detectAstLanguage("vendor/jquery.min.js")).toBeNull();
    expect(detectAstLanguage("Dockerfile")).toBeNull();
  });

  it("covers all eight target languages", () => {
    const langs = knownAstLanguages();
    for (const lang of [
      "typescript",
      "javascript",
      "go",
      "python",
      "ruby",
      "php",
      "java",
      "rust",
    ]) {
      expect(langs).toContain(lang);
    }
  });
});

describe("parseSource — graceful degradation", () => {
  it("reports unavailable (not error) for a language with no backend", async () => {
    const res = await parseSource("main.go", "package main\nfunc main() {}\n");
    expect(res.language).toBe("go");
    expect(res.available).toBe(false);
    expect(res.error).toBeUndefined();
  });

  it("reports unavailable for a file the detector skips", async () => {
    const res = await parseSource("notes.md", "# eval() everywhere");
    expect(res.available).toBe(false);
    expect(res.language).toBeNull();
  });

  it("returns null from get() for an unregistered language", () => {
    const registry = new ParserRegistry();
    expect(registry.get("python")).toBeNull();
  });
});

// The TypeScript compiler must be resolvable in the Node test runtime; if this ever fails the
// remaining AST assertions can't be trusted, so assert it explicitly rather than skipping silently.
describe("typescript backend", () => {
  it("is available in the Node test runtime", async () => {
    expect(await isTypeScriptBackendAvailable()).toBe(true);
  });

  it("parses TS into a normalized tree", async () => {
    const res = await parseSource("src/a.ts", "const x: number = eval('1 + 1');\n");
    expect(res.available).toBe(true);
    expect(res.tree?.root.kind).toBe("program");
  });
});

describe("findCalls / findImports — the regex false positives AST removes", () => {
  it("finds a real eval() call but NOT eval( inside a string or comment", async () => {
    const source = [
      "const warning = 'never use eval() in production';", // string literal — must be ignored
      "// remember: eval() is dangerous", // comment — must be ignored
      "const result = eval(userInput);", // real call — must be found
    ].join("\n");
    const res = await parseSource("src/danger.ts", source);
    const calls = findCalls(res.tree!, "eval");
    expect(calls).toHaveLength(1);
    expect(calls[0].line).toBe(3);
  });

  it("matches member-expression calls by last segment (cp.exec)", async () => {
    const source = "import cp from 'child_process';\ncp.exec('ls');\n";
    const res = await parseSource("src/run.ts", source);
    const calls = findCalls(res.tree!, "exec");
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("cp.exec");
  });

  it("resolves import declarations and require() specifiers", async () => {
    const source = [
      "import { readFile } from 'node:fs/promises';",
      "const cp = require('child_process');",
      "const mod = await import('./local');",
    ].join("\n");
    const res = await parseSource("src/imports.ts", source);
    const specs = findImports(res.tree!);
    expect(specs).toContain("node:fs/promises");
    expect(specs).toContain("child_process");
    expect(specs).toContain("./local");
  });

  it("counts re-exports as module requests", async () => {
    // `export … from` is in the ES spec's [[RequestedModules]], so it is a real dependency edge.
    // It used to be dropped here, leaving the graph blind to re-export-only barrel files.
    const source = [
      "export { a } from './a';",
      "export * from './b';",
      "export * as c from './c';",
      "export type { T } from './t';",
      "const local = 1;",
      "export { local };", // no specifier — must not appear
    ].join("\n");
    const res = await parseSource("src/barrel.ts", source);
    expect(findImports(res.tree!).sort()).toEqual(["./a", "./b", "./c", "./t"]);
  });

  it("finds new Function() as dynamic code construction", async () => {
    const res = await parseSource("src/f.js", "const f = new Function('a', 'return a + 1');\n");
    expect(findNew(res.tree!, "Function")).toHaveLength(1);
  });

  it("finds JSX attributes by name in tsx", async () => {
    const source = "export const C = () => <div dangerouslySetInnerHTML={{ __html: html }} />;\n";
    const res = await parseSource("src/C.tsx", source);
    const attrs = findJsxAttributes(res.tree!, "dangerouslySetInnerHTML");
    expect(attrs).toHaveLength(1);
  });

  it("walk visits nested nodes and can skip subtrees", async () => {
    const res = await parseSource("src/w.ts", "function outer() { function inner() {} }\n");
    let functions = 0;
    walk(res.tree!.root, (node) => {
      if (node.kind === "function") functions++;
    });
    expect(functions).toBe(2);
  });
});

describe("findUnsafeCalls — reference AST rule", () => {
  it("reports only real unsafe call sites, ignoring strings and comments", async () => {
    const source = [
      "const doc = 'call eval() to run code';", // false positive for regex, ignored here
      "import cp from 'child_process';",
      "eval(userInput);", // line 3
      "cp.spawn('sh', ['-c', cmd]);", // line 4
      "const g = new Function('return 1');", // line 5
    ].join("\n");
    const hits = await findUnsafeCalls("src/unsafe.ts", source);
    expect(hits).not.toBeNull();
    const labels = hits!.map((h) => h.label);
    expect(labels).toContain("eval()");
    expect(labels).toContain("child_process exec/spawn");
    expect(labels).toContain("new Function()");
    // The string-literal `eval()` on line 1 must NOT appear.
    expect(hits!.every((h) => h.line !== 1)).toBe(true);
    expect(hits!.find((h) => h.label === "eval()")!.line).toBe(3);
  });

  it("returns null (fall back to regex) for a language with no backend", async () => {
    const hits = await findUnsafeCalls("app.py", "eval(user_input)\n");
    expect(hits).toBeNull();
  });

  it("returns an empty array for a clean file (parsed, nothing found)", async () => {
    const hits = await findUnsafeCalls(
      "src/clean.ts",
      "export const add = (a: number, b: number) => a + b;\n",
    );
    expect(hits).toEqual([]);
  });
});
