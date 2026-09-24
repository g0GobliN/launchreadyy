import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "./migrate";

/**
 * Every table the migrations leave behind must be read by application source.
 *
 * The failure this guards against is a retired feature: its code is deleted, its table is not, and
 * nothing notices — so the table (and its `Database` type entry) ships in every new install forever.
 * Retiring one is a one-line forward migration, which is why the check is worth having.
 *
 * Three kinds of file are deliberately not evidence of a reader:
 *   - `*.test.ts(x)`      — a test that touches a table is not an application reader
 *   - `src/db/migrations/` — the `CREATE TABLE` is the thing under test, not a reference to it
 *   - `data-store.types.ts` — the type catalogue names every table, so counting it would let an
 *                             orphaned table pass on its own declaration alone
 *
 * Comments are stripped before matching, for the same reason: a changelog entry or a migration
 * note that merely *names* a retired table is not a reader, and treating it as one is how an
 * orphaned table survives a cleanup like that.
 *
 * A real reader looks like `supabase.from("repos")`, a raw SQL string, or an RPC call.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("schema coverage", () => {
  it("has a reader in src/ for every table the migrations leave behind", () => {
    db = new Database(":memory:");
    migrate(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)
      .filter((name) => !name.startsWith("sqlite_"));

    // A sanity check on the harness itself: if the migrations stopped producing the core tables,
    // an empty list would otherwise make the assertion below pass vacuously.
    expect(tables).toContain("repos");

    const sources = readSources().map((path) => ({
      path,
      text: withoutComments(readFileSync(join(root, path), "utf8")),
    }));

    const orphans = tables.filter((table) => {
      // Boundaries treat `_` as a word character, so `scans` is not satisfied by `live_site_scans`.
      const token = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(table)}([^A-Za-z0-9_]|$)`);
      return !sources.some((file) => token.test(file.text));
    });

    expect(
      orphans,
      "These tables survive the migrations but no application source reads them. Drop them in a new forward migration (the feature they belonged to is gone), or — if the name is assembled at runtime — teach this scan where to look.",
    ).toEqual([]);
  });
});

/** Application sources under `src/` that could plausibly query a table. */
function readSources(directory = "src"): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return path === "src/db/migrations" ? [] : readSources(path);
    }
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    if (path === "src/lib/data-store.types.ts") return [];
    return /\.(?:tsx?|sql)$/.test(entry.name) ? [path] : [];
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Drop comments so prose can't satisfy the search.
 *
 * The line-comment pattern skips a `//` that follows a colon, which is the `://` of a URL rather
 * than the start of a comment — otherwise stripping a line with a link in it would take whatever
 * follows on that line with it.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/[^\n]*/g, " ");
}
