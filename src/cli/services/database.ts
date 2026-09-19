import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { migrate, pendingMigrations, listMigrations } from "../../db/migrate.js";

// Always invoked from the project root — see PROJECT_ROOT comment in commands/doctor.ts.
const PROJECT_ROOT = process.cwd();
const DATA_DIR = join(PROJECT_ROOT, "data");
const DB_PATH = join(DATA_DIR, "launchreadyy.db");

export interface DatabaseHealth {
  healthy: boolean;
  message: string;
  migrationsApplied: number;
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function initializeDatabase(): DatabaseHealth {
  const dbExisted = existsSync(DB_PATH);
  ensureDataDir();

  const db = new Database(DB_PATH);

  try {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");

    const { applied } = migrate(db);

    // Prove the database is actually writable, not just openable.
    db.exec("CREATE TABLE IF NOT EXISTS health_check (id INTEGER PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO health_check (value) VALUES (?)").run("test");
    const result = db.prepare("SELECT value FROM health_check WHERE value = ?").get("test") as
      | { value?: string }
      | undefined;
    db.prepare("DELETE FROM health_check WHERE value = ?").run("test");
    if (!result || result.value !== "test") {
      throw new Error("Database read/write test failed");
    }

    db.close();

    const message = dbExisted
      ? applied.length > 0
        ? `SQLite database found\n✓ Applied ${applied.length} new migration(s)`
        : "SQLite database found\n✓ Schema up to date"
      : `Created SQLite database\n✓ Applied ${applied.length} migration(s)`;

    return { healthy: true, message, migrationsApplied: applied.length };
  } catch (error) {
    db.close();
    return {
      healthy: false,
      message: `Database initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      migrationsApplied: 0,
    };
  }
}

export function checkDatabaseHealth(): DatabaseHealth {
  if (!existsSync(DB_PATH)) {
    return { healthy: false, message: "Database file not found", migrationsApplied: 0 };
  }

  const db = new Database(DB_PATH, { readonly: true });

  try {
    const pending = pendingMigrations(db);
    const total = listMigrations().length;
    db.prepare("SELECT 1").get();
    db.close();

    if (pending.length > 0) {
      return {
        healthy: false,
        message: `${pending.length} migration(s) pending — run 'launchreadyy setup'`,
        migrationsApplied: total - pending.length,
      };
    }

    return {
      healthy: true,
      message: `SQLite database found\n✓ Schema up to date (${total} migration(s))`,
      migrationsApplied: total,
    };
  } catch (error) {
    db.close();
    return {
      healthy: false,
      message: `Database health check failed: ${error instanceof Error ? error.message : String(error)}`,
      migrationsApplied: 0,
    };
  }
}

export function databaseExists(): boolean {
  return existsSync(DB_PATH);
}

export function getDatabasePath(): string {
  return DB_PATH;
}
