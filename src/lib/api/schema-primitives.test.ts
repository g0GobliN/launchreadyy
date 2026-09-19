import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  domainString,
  githubLoginString,
  idString,
  longText,
  mediumText,
  shortText,
  slugString,
  urlString,
} from "./schema-primitives";

const API_DIR = path.dirname(fileURLToPath(import.meta.url));

describe("primitives", () => {
  it("accept realistic values", () => {
    expect(idString.safeParse(crypto.randomUUID()).success).toBe(true);
    expect(idString.safeParse("sub_1MowQVLkdIwHu7ixeRlqHVzs").success).toBe(true);
    expect(githubLoginString.safeParse("g0GobliN").success).toBe(true);
    expect(domainString.safeParse("example.com").success).toBe(true);
    expect(urlString.safeParse("https://github.com/owner/repo").success).toBe(true);
  });

  it("reject empty identifiers", () => {
    expect(idString.safeParse("").success).toBe(false);
    expect(githubLoginString.safeParse("").success).toBe(false);
    expect(domainString.safeParse("").success).toBe(false);
  });

  it("bound every string type", () => {
    const cases: [string, { safeParse: (v: unknown) => { success: boolean } }, number][] = [
      ["idString", idString, 128],
      ["slugString", slugString, 64],
      ["githubLoginString", githubLoginString, 39],
      ["shortText", shortText, 200],
      ["mediumText", mediumText, 2_000],
      ["longText", longText, 20_000],
      ["urlString", urlString, 2_048],
      ["domainString", domainString, 253],
    ];

    for (const [name, schema, max] of cases) {
      expect(schema.safeParse("a".repeat(max)).success, `${name} at limit`).toBe(true);
      expect(schema.safeParse("a".repeat(max + 1)).success, `${name} past limit`).toBe(false);
    }
  });
});

/**
 * Structural guard, in the spirit of server-fn-auth.test.ts: a new endpoint whose author
 * wrote a bare `z.string()` gets caught here rather than shipping unbounded.
 *
 * Matches source text rather than introspecting schemas because the check has to run over
 * every validator in the directory, including ones built inline inside a `createServerFn`
 * chain that cannot be imported in isolation.
 */
describe("server-function inputs", () => {
  const files = fs
    .readdirSync(API_DIR)
    .filter((f) => f.endsWith(".functions.ts"))
    .sort();

  it("finds the API modules", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)("%s has no unbounded z.string()", (file) => {
    const source = fs.readFileSync(path.join(API_DIR, file), "utf8");

    const unbounded = source
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      // A bare `z.string()` not immediately followed by a bounding call. `.email()` carries
      // its own format constraint but no length one, so it still needs an explicit `.max()`.
      .filter(({ line }) => /z\.string\(\)(?!\s*\.(max|regex|refine))/.test(line))
      .filter(({ line }) => !/\.max\(/.test(line))
      // `z.array(z.string())` / `z.record(z.string(), …)` describe key and element types whose
      // own bounds live on the surrounding schema.
      .filter(({ line }) => !/z\.(array|record)\(\s*z\.string\(\)/.test(line));

    expect(
      unbounded.map(({ n, line }) => `${file}:${n}  ${line}`),
      "add a .max() or use a primitive from schema-primitives.ts",
    ).toEqual([]);
  });
});
