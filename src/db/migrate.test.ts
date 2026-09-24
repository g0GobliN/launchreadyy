import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, pendingMigrations } from "./migrate";

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("SQLite migrations", () => {
  it("creates the Community schema without commercial tables", () => {
    db = new Database(":memory:");

    const result = migrate(db);

    expect(result.applied).toContain("001_initial_schema.sql");
    expect(result.applied).toContain("002_remove_commercial_tables.sql");
    expect(pendingMigrations(db)).toEqual([]);
    expect(tableNames(db)).toContain("repos");
    expect(tableNames(db)).not.toContain("user_credits");
    expect(tableNames(db)).not.toContain("credit_transactions");
    expect(tableNames(db)).not.toContain("processed_stripe_events");
    expect(tableNames(db)).not.toContain("github_credentials");
    expect(tableNames(db)).not.toContain("marketing_articles");
  });

  it("removes commercial tables from an upgraded database", () => {
    db = new Database(":memory:");
    migrate(db);
    db.exec(`
      CREATE TABLE user_credits (github_login TEXT PRIMARY KEY);
      CREATE TABLE credit_transactions (id TEXT PRIMARY KEY);
      CREATE TABLE processed_stripe_events (event_id TEXT PRIMARY KEY);
      CREATE TABLE github_credentials (login TEXT PRIMARY KEY, sealed_token TEXT NOT NULL);
      CREATE TABLE marketing_articles (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE);
      INSERT INTO background_jobs (id, kind, payload)
      VALUES ('legacy-job', 'fix_run', '{"type":"fix_run","sealedGitHubToken":"secret","repoId":"r1"}');
      DELETE FROM schema_migrations
      WHERE name IN (
        '002_remove_commercial_tables.sql',
        '004_remove_credential_vault.sql',
        '005_remove_marketing_articles.sql'
      );
    `);

    migrate(db);

    expect(tableNames(db)).not.toContain("user_credits");
    expect(tableNames(db)).not.toContain("credit_transactions");
    expect(tableNames(db)).not.toContain("processed_stripe_events");
    expect(tableNames(db)).not.toContain("github_credentials");
    expect(tableNames(db)).not.toContain("marketing_articles");
    expect(
      db.prepare("SELECT payload FROM background_jobs WHERE id = 'legacy-job'").pluck().get(),
    ).toBe('{"type":"fix_run","repoId":"r1"}');
  });
});

function tableNames(database: Database.Database): string[] {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => (row as { name: string }).name);
}
