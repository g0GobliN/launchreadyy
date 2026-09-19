import { describe, expect, it } from "vitest";
import { importInsertionIndex, findExpressApp } from "./github";

/** Apply the insertion the way patchSourceFile does, so tests read as the resulting file. */
function insert(src: string, importLine = 'import "./src/lib/sentry";'): string {
  const lines = src.split("\n");
  const at = importInsertionIndex(lines);
  return [...lines.slice(0, at), importLine, ...lines.slice(at)].join("\n");
}

describe("importInsertionIndex", () => {
  it("places a new import after a single-line import", () => {
    expect(insert('import express from "express";\n\nconst app = express();')).toBe(
      'import express from "express";\nimport "./src/lib/sentry";\n\nconst app = express();',
    );
  });

  /**
   * Regression: the scan took the last line that merely *started with* `import `, which for a
   * multi-line import is its opening line. The new import was spliced between `import {` and the
   * first named binding, cutting a statement in half and leaving the user's entry point
   * syntactically invalid. Braces still balanced, so validateBalancedSyntax passed it and the
   * broken file went out in the PR.
   */
  it("does not split a multi-line import", () => {
    const out = insert(
      [
        'import express from "express";',
        "import {",
        "  json,",
        '} from "body-parser";',
        "",
        "const app = express();",
      ].join("\n"),
    );
    expect(out).toContain('} from "body-parser";\nimport "./src/lib/sentry";');
    expect(out).not.toContain('import {\nimport "./src/lib/sentry";');
  });

  it("handles a multi-line import as the only import", () => {
    const out = insert(["import {", "  a,", "  b,", '} from "mod";', "", "run();"].join("\n"));
    expect(out.split("\n")[4]).toBe('import "./src/lib/sentry";');
  });

  it("handles a side-effect import with no from clause", () => {
    const out = insert('import "./polyfills";\n\nstart();');
    expect(out.split("\n")[1]).toBe('import "./src/lib/sentry";');
  });

  it("keeps imports below a shebang when the file has none", () => {
    const out = insert('#!/usr/bin/env node\nconst x = require("x");');
    expect(out.split("\n")[0]).toBe("#!/usr/bin/env node");
    expect(out.split("\n")[1]).toBe('import "./src/lib/sentry";');
  });

  it("keeps imports below a use-strict directive", () => {
    const out = insert('"use strict";\nconst x = 1;');
    expect(out.split("\n")[0]).toBe('"use strict";');
    expect(out.split("\n")[1]).toBe('import "./src/lib/sentry";');
  });

  it("inserts at the top of a plain CommonJS file", () => {
    expect(importInsertionIndex(['const x = require("x");'])).toBe(0);
  });

  it("skips leading comments without treating them as the end of the block", () => {
    const out = insert(
      ["// entry point", "/* eslint-disable */", 'import a from "a";', "", "a();"].join("\n"),
    );
    expect(out.split("\n")[3]).toBe('import "./src/lib/sentry";');
  });

  /** A line starting with `import ` further down is far likelier to be data than a statement. */
  it("ignores an import-looking line inside a template literal", () => {
    const src = [
      'import express from "express";',
      "",
      "const doc = `",
      'import fake from "nope";',
      "`;",
    ].join("\n");
    expect(importInsertionIndex(src.split("\n"))).toBe(1);
  });

  it("ignores imports appearing after real code", () => {
    const src = ['import a from "a";', "const x = 1;", 'import b from "b";'].join("\n");
    expect(importInsertionIndex(src.split("\n"))).toBe(1);
  });

  it("handles an empty file", () => {
    expect(importInsertionIndex([""])).toBe(0);
  });
});

/**
 * Regression: every Express middleware fix (helmet/cors/rate-limit/logger/cookie-flags/
 * https-redirect) and health-check anchored their usage line on the literal string
 * "const app = express()". A miss inserted the import but not the call, and patchSourceFile still
 * returned content — so the caller reported "verified" for a fix that wired nothing. Confirmed
 * against a real cloned repo: stripe-server/server.js declares `var app = express();`.
 */
describe("findExpressApp", () => {
  const decl = (line: string) => findExpressApp(["import express from 'express';", line, "x"]);

  it("finds the const form the old literal anchor already handled", () => {
    expect(decl("const app = express();")).toEqual({
      line: "const app = express();",
      varName: "app",
    });
  });

  it.each([
    ["var (stripe-server/server.js, real)", "var app = express();", "app"],
    ["let", "let app = express();", "app"],
    ["typed Application", "const app: Application = express();", "app"],
    ["typed Express", "const app: Express = express();", "app"],
    ["extra whitespace", "const   app   =   express( );", "app"],
  ])("finds %s — the old anchor missed these silently", (_label, line, varName) => {
    expect(line.includes("const app = express()")).toBe(false); // the old anchor really did miss
    expect(findExpressApp([line])?.varName).toBe(varName);
  });

  // Indentation was never a problem — the literal substring still matched. Kept so the regex is
  // not "fixed" later in a way that regresses the case that always worked.
  it("still finds an indented declaration", () => {
    expect(findExpressApp(["  const app = express();"])?.varName).toBe("app");
  });

  it("reports the user's own identifier so generated calls do not assume `app`", () => {
    expect(decl("const server = express();")?.varName).toBe("server");
  });

  it("returns null when there is no express() construction to anchor on", () => {
    expect(findExpressApp(["import express from 'express';", "router.get('/', h);"])).toBeNull();
  });

  it("does not match a call that merely mentions express", () => {
    expect(findExpressApp(["app.use(express.json());"])).toBeNull();
  });
});
