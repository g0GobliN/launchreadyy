import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database as Db } from "better-sqlite3";

/**
 * Versioned SQLite migrations.
 *
 * One runner serves both the running application and `launchreadyy setup`, so
 * there is a single source of truth for the schema. Each file runs once, inside
 * a transaction, and is recorded in `schema_migrations`; adding a new numbered
 * file is the only way to change the schema. Existing data is never dropped.
 */

function migrationsDir(): string {
  // Resolved relative to this module so it works from src/ and from a bundle.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "migrations"),
    path.join(process.cwd(), "src", "db", "migrations"),
  ];
  return candidates.find((d) => fs.existsSync(d)) ?? candidates[0]!;
}

export function listMigrations(): string[] {
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export interface MigrateResult {
  applied: string[];
  alreadyCurrent: boolean;
}

export function migrate(db: Db): MigrateResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const done = new Set(
    db
      .prepare("SELECT name FROM schema_migrations")
      .all()
      .map((r) => (r as { name: string }).name),
  );

  const dir = migrationsDir();
  const applied: string[] = [];

  for (const file of listMigrations()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    // better-sqlite3 forbids exec() inside a prepared transaction, so the
    // BEGIN/COMMIT is issued directly — a failed file leaves nothing behind.
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(file);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(e as Error).message}`);
    }
    applied.push(file);
  }

  return { applied, alreadyCurrent: applied.length === 0 };
}

export function pendingMigrations(db: Db): string[] {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!exists) return listMigrations();
  const done = new Set(
    db
      .prepare("SELECT name FROM schema_migrations")
      .all()
      .map((r) => (r as { name: string }).name),
  );
  return listMigrations().filter((m) => !done.has(m));
}
