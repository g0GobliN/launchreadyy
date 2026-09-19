import { db } from "./client";
import { migrate } from "./migrate";

let ensured = false;

/**
 * Bring the local database up to the current schema version.
 *
 * The DDL lives in `src/db/migrations/*.sql` — this only applies what is
 * pending. Idempotent and safe to call from any entry point.
 */
export function ensureSchema(): void {
  if (ensured) return;
  migrate(db);
  ensured = true;
}
