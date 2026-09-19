import { describe, expect, it } from "vitest";
import { connectRepoForOwner, type RepoConnectRow } from "./repo-connect.server";

type FakeRow = { id: string; owner: string; name: string };

/**
 * Minimal stand-in for the PostgREST builder, modelling the one behaviour that matters:
 * `update` only matches rows whose owner equals the caller, and `insert` rejects an id that
 * is already taken with 23505 — the same way the real primary key does.
 */
function fakeDb(rows: FakeRow[]) {
  const calls = { update: 0, insert: 0 };

  const builder = (table: string) => {
    if (table !== "repos") throw new Error(`unexpected table ${table}`);
    return {
      update(patch: Partial<FakeRow>) {
        calls.update += 1;
        const filters: Partial<FakeRow> = {};
        const chain = {
          eq(col: keyof FakeRow, val: string) {
            filters[col] = val;
            return chain;
          },
          select() {
            return chain;
          },
          async maybeSingle() {
            const hit = rows.find((r) =>
              Object.entries(filters).every(([k, v]) => r[k as keyof FakeRow] === v),
            );
            if (!hit) return { data: null, error: null };
            Object.assign(hit, patch);
            return { data: { id: hit.id }, error: null };
          },
        };
        return chain;
      },
      // Nothing calls upsert any more — it is modelled anyway (overwrite on conflict, exactly
      // what PostgREST does) so that a regression back to upsert fails on the ownership
      // assertion below rather than erroring out with "upsert is not a function".
      async upsert(row: FakeRow) {
        calls.insert += 1;
        const i = rows.findIndex((r) => r.id === row.id);
        if (i >= 0) rows[i] = { ...rows[i], ...row };
        else rows.push({ ...row });
        return { error: null };
      },
      async insert(row: FakeRow) {
        calls.insert += 1;
        if (rows.some((r) => r.id === row.id)) {
          return { error: { code: "23505", message: "duplicate key value" } };
        }
        rows.push({ ...row });
        return { error: null };
      },
    };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow fake, not a full client
  return { db: { from: builder } as any, rows, calls };
}

function row(id: string, owner: string, name = "app"): RepoConnectRow {
  return {
    id,
    owner,
    name,
    full_name: `${owner}/${name}`,
    description: null,
    language: "TypeScript",
    stars: 0,
    updated_at: new Date().toISOString(),
    private: false,
    framework: "unknown",
    default_branch: "main",
  };
}

describe("connectRepoForOwner", () => {
  it("inserts a repository that has not been connected", async () => {
    const { db, rows, calls } = fakeDb([]);
    let charged = 0;

    const result = await connectRepoForOwner(db, row("42", "alice"), async () => {
      charged += 1;
    });

    expect(result).toEqual({ repoId: "42", created: true });
    expect(charged).toBe(1);
    expect(calls.insert).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].owner).toBe("alice");
  });

  it("refreshes a repository already connected by the operator", async () => {
    const { db, rows, calls } = fakeDb([{ id: "42", owner: "alice", name: "old-name" }]);
    let charged = 0;

    const result = await connectRepoForOwner(db, row("42", "alice", "new-name"), async () => {
      charged += 1;
    });

    expect(result).toEqual({ repoId: "42", created: false });
    expect(charged).toBe(0);
    expect(calls.insert).toBe(0);
    expect(rows[0].name).toBe("new-name");
  });

  // The bug this function exists to prevent: `repos.id` is the GitHub repo id and is the
  // table's primary key, so it is global across accounts. The previous upsert-on-id rewrote
  // `owner`, which is what every assertRepoOwner check resolves against — so posting a victim's
  // repo id handed over their scans, fix history, and decryptable sandbox env vars, and locked
  // the real owner out of their own repo.
  it("refuses to take over a repo another account already connected", async () => {
    const { db, rows, calls } = fakeDb([{ id: "42", owner: "victim", name: "app" }]);
    let charged = 0;

    await expect(
      connectRepoForOwner(db, row("42", "attacker"), async () => {
        charged += 1;
      }),
    ).rejects.toThrow("Not authorized for this repo");

    expect(rows).toHaveLength(1);
    expect(rows[0].owner).toBe("victim");
    expect(calls.update).toBe(1);
    expect(charged).toBe(1);
  });

  it("never rewrites owner via the update path when the caller is not the owner", async () => {
    const { db, rows } = fakeDb([{ id: "7", owner: "victim", name: "app" }]);

    await expect(
      connectRepoForOwner(db, row("7", "attacker", "renamed"), async () => {}),
    ).rejects.toThrow();

    expect(rows[0]).toEqual({ id: "7", owner: "victim", name: "app" });
  });

  it("surfaces a non-conflict insert error instead of reporting success", async () => {
    const { db } = fakeDb([]);
    const failing = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          }),
        }),
        insert: async () => ({ error: { code: "08006", message: "connection failure" } }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow fake
    } as any;
    void db;

    await expect(connectRepoForOwner(failing, row("9", "alice"), async () => {})).rejects.toThrow();
  });
});
