/**
 * Connecting a GitHub repository to this installation.
 *
 * `repos.id` is the GitHub repository id and the table's primary key. The insert must
 * never become an upsert keyed on id alone: a primary-key conflict here means the repo
 * row already exists, and silently overwriting it would rewrite `owner` — the field
 * every ownership check resolves against. The conflict is surfaced as a hard error.
 *
 * Takes the db client as an argument so the ownership rule is testable without a database.
 */
import type { Database } from "./data-store.types";
import { toPublicError } from "./utils";

type Db = ReturnType<typeof import("./data-store.server").getDataStore>;

export type RepoConnectRow = Database["public"]["Tables"]["repos"]["Insert"] & {
  id: string;
  owner: string;
};

/** Postgres unique-violation — here, the primary key on `repos.id`. */
const PG_UNIQUE_VIOLATION = "23505";

export async function connectRepoForOwner(
  db: Db,
  row: RepoConnectRow,
  onFirstConnect: () => Promise<void>,
): Promise<{ repoId: string; created: boolean }> {
  // Reconnecting a repo this installation already connected: refresh its metadata.
  const { data: refreshed, error: refreshError } = await db
    .from("repos")
    .update(row)
    .eq("id", row.id)
    .eq("owner", row.owner)
    .select("id")
    .maybeSingle();
  if (refreshError) throw new Error(toPublicError(refreshError));
  if (refreshed) return { repoId: row.id, created: false };

  // New to this installation — run the caller's pre-connect hook, then INSERT. Never
  // upsert: a primary-key conflict must fail, not transfer someone else's row.
  await onFirstConnect();
  const { error } = await db.from("repos").insert(row);
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) throw new Error("Not authorized for this repo");
    throw new Error(toPublicError(error));
  }
  return { repoId: row.id, created: true };
}
