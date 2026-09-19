import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  exists: false,
  pragmaError: null as Error | null,
  closed: false,
  pragmas: [] as string[],
  prepared: [] as string[],
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(() => state.exists),
  mkdirSync: vi.fn(),
}));

vi.mock("better-sqlite3", () => ({
  default: class MockDatabase {
    pragma(value: string) {
      if (state.pragmaError) throw state.pragmaError;
      state.pragmas.push(value);
    }

    exec() {}

    prepare(sql: string) {
      state.prepared.push(sql);
      return {
        all: () => [],
        run: () => ({ changes: 1 }),
        get: () => (sql.includes("SELECT value FROM health_check") ? { value: "test" } : {}),
      };
    }

    close() {
      state.closed = true;
    }
  },
}));

vi.mock("../../db/migrate.js", () => ({
  migrate: vi.fn(() => ({ applied: ["001_initial_schema.sql"], alreadyCurrent: false })),
  pendingMigrations: vi.fn(() => []),
  listMigrations: vi.fn(() => ["001_initial_schema.sql", "002_remove_commercial_tables.sql"]),
}));

import { mkdirSync } from "fs";
import { checkDatabaseHealth, initializeDatabase } from "./database.js";

beforeEach(() => {
  state.exists = false;
  state.pragmaError = null;
  state.closed = false;
  state.pragmas.length = 0;
  state.prepared.length = 0;
  vi.clearAllMocks();
});

describe("database service", () => {
  it("initializes SQLite through the shared migration runner and verifies writes", () => {
    const result = initializeDatabase();

    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining("data"), { recursive: true });
    expect(state.pragmas).toContain("journal_mode = WAL");
    expect(state.pragmas).toContain("foreign_keys = ON");
    expect(state.prepared).toContain("INSERT INTO health_check (value) VALUES (?)");
    expect(result).toMatchObject({ healthy: true, migrationsApplied: 1 });
    expect(state.closed).toBe(true);
  });

  it("closes the database and reports initialization failures", () => {
    state.pragmaError = new Error("DB locked");

    const result = initializeDatabase();

    expect(result.healthy).toBe(false);
    expect(result.message).toContain("DB locked");
    expect(state.closed).toBe(true);
  });

  it("reports a missing database without opening it", () => {
    expect(checkDatabaseHealth()).toEqual({
      healthy: false,
      message: "Database file not found",
      migrationsApplied: 0,
    });
  });
});
