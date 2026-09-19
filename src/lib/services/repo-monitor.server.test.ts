import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Covers the two guarantees the monitoring design rests on and that the pure
 * policy tests cannot reach:
 *   1. an automatic scan does not start sandbox verification
 *   2. a rejected GITHUB_TOKEN disables monitors instead of retrying into the DLQ
 */

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const updates: Array<{ table: string; patch: Row }> = [];
const inserts: Array<{ table: string; row: Row }> = [];

function query(table: string) {
  const filters: Record<string, unknown> = {};
  let limitN: number | null = null;
  let patch: Row | null = null;

  const matching = () =>
    (tables[table] ?? []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));

  const settle = () => {
    if (patch) {
      for (const r of matching()) Object.assign(r, patch);
      updates.push({ table, patch });
      return { data: null, error: null };
    }
    const rows = matching();
    return { data: limitN === null ? rows : rows.slice(0, limitN), error: null };
  };

  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return chain;
    },
    not: () => chain,
    order: () => chain,
    limit: (n: number) => {
      limitN = n;
      return chain;
    },
    update: (p: Row) => {
      patch = p;
      return chain;
    },
    insert: (row: Row) => {
      (tables[table] ??= []).push({ ...row });
      inserts.push({ table, row });
      return Promise.resolve({ error: null });
    },
    maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
    single: async () => {
      const hit = matching()[0];
      return { data: hit ?? null, error: hit ? null : { message: "not found" } };
    },
    // `.update(...).eq(...)` and `.select(...).limit(...)` are both awaited
    // directly, so the builder itself has to be thenable.
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(settle()).then(res, rej),
  };
  return chain;
}

const enqueued: Row[] = [];
let envToken: string | null = "gho_token";
let headSha: string | null = "sha-1";
let flagOn = true;

vi.mock("../data-store.server", () => ({
  getDataStore: () => ({ from: (t: string) => query(t) }),
}));
vi.mock("../github-token.server", () => ({
  getGitHubToken: () => envToken,
  isAuthFailure: (e: unknown) => /401|403|bad credentials/i.test(String((e as Error)?.message)),
}));
vi.mock("../github.server", () => ({
  resolveBranchHeadSha: async () => headSha,
}));
vi.mock("../jobs.server", () => ({
  enqueueDurableJob: async (p: Row) => {
    enqueued.push(p);
    return "job-1";
  },
}));
vi.mock("../site-config.server", () => ({
  isFeatureEnabled: async () => flagOn,
}));

const runAndPersistScan = vi.fn(async (_opts: unknown) => ({
  scanId: "scan-new",
  score: 70,
  issueCount: 0,
  repoFullName: "alice/app",
  sandboxRunId: null as string | null,
  sandboxJobId: null as string | null,
}));
vi.mock("../scan-run.server", () => ({ runAndPersistScan: (o: unknown) => runAndPersistScan(o) }));

const { enqueueDueRepoMonitors, hasEnabledRepoMonitors } = await import("./repo-monitor.server");
const { processRepoScanJob } = await import("./repo-scan-job.server");

const OLD = new Date(Date.UTC(2025, 0, 1)).toISOString();

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  updates.length = 0;
  inserts.length = 0;
  enqueued.length = 0;
  envToken = "gho_token";
  headSha = "sha-1";
  flagOn = true;
  runAndPersistScan.mockClear();

  tables.repo_monitors = [
    {
      id: "m1",
      user_id: "alice",
      repo_id: "r1",
      cadence: "weekly",
      enabled: true,
      last_enqueued_at: OLD,
      last_notified_at: null,
      last_head_sha: "sha-0",
    },
  ];
  tables.repos = [{ id: "r1", full_name: "alice/app", default_branch: "main" }];
  tables.scans = [{ id: "scan-old", repo_id: "r1", score: 80, created_at: OLD }];
  tables.issues = [];
});

describe("enqueueDueRepoMonitors", () => {
  it("does nothing at all while the feature flag is off", async () => {
    flagOn = false;
    expect(await enqueueDueRepoMonitors()).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it("enqueues a repo_scan job when the branch head moved", async () => {
    headSha = "sha-2";
    expect(await enqueueDueRepoMonitors()).toBe(1);
    expect(enqueued[0]).toEqual({
      type: "repo_scan",
      repoId: "r1",
      userLogin: "alice",
      trigger: "monitor",
    });
    // The observed SHA becomes the next baseline.
    expect(tables.repo_monitors![0]!.last_head_sha).toBe("sha-2");
  });

  it("skips the scan when nothing changed, but still moves the clock", async () => {
    headSha = "sha-0"; // unchanged, and the last scan is old...
    tables.scans![0]!.created_at = new Date().toISOString(); // ...but recent
    expect(await enqueueDueRepoMonitors()).toBe(0);
    expect(enqueued).toHaveLength(0);
    // Without this the monitor would be re-evaluated on every 2-minute tick.
    expect(tables.repo_monitors![0]!.last_enqueued_at).not.toBe(OLD);
  });

  it("skips every monitor when GITHUB_TOKEN is unset, without disabling them", async () => {
    envToken = null;
    expect(await enqueueDueRepoMonitors()).toBe(0);
    // Left enabled so monitoring resumes by itself once the token is configured.
    expect(tables.repo_monitors![0]!.enabled).toBe(true);
  });

  it("honours the batch limit", async () => {
    tables.repo_monitors!.push({
      ...tables.repo_monitors![0]!,
      id: "m2",
      repo_id: "r1",
    });
    headSha = "sha-2";
    expect(await enqueueDueRepoMonitors(1)).toBe(1);
    expect(enqueued).toHaveLength(1);
  });
});

describe("hasEnabledRepoMonitors", () => {
  it("reflects whether this operator has any enabled repo monitor", async () => {
    expect(await hasEnabledRepoMonitors("alice")).toBe(true);
    tables.repo_monitors![0]!.enabled = false;
    expect(await hasEnabledRepoMonitors("alice")).toBe(false);
  });
});

describe("processRepoScanJob", () => {
  const payload = {
    type: "repo_scan" as const,
    repoId: "r1",
    userLogin: "alice",
    trigger: "monitor" as const,
  };

  it("does not enqueue redundant sandbox verification", async () => {
    await processRepoScanJob(payload);

    expect(runAndPersistScan).toHaveBeenCalledWith(
      expect.objectContaining({
        enqueueSandbox: false,
        trigger: "monitor",
      }),
    );
  });

  it("does nothing when GITHUB_TOKEN vanished between enqueue and execute", async () => {
    envToken = null;
    await processRepoScanJob(payload);
    expect(runAndPersistScan).not.toHaveBeenCalled();
  });

  it("disables the operator's monitors on a rejected token instead of retrying into the DLQ", async () => {
    runAndPersistScan.mockRejectedValueOnce(new Error("GitHub 401: Bad credentials"));

    // Must resolve, not throw — throwing would burn all three job attempts on a
    // token that will never work again.
    await expect(processRepoScanJob(payload)).resolves.toBeUndefined();
    expect(tables.repo_monitors![0]!.enabled).toBe(false);
  });

  it("rethrows a transient failure so the job retries, leaving monitors enabled", async () => {
    runAndPersistScan.mockRejectedValueOnce(new Error("network timeout"));

    await expect(processRepoScanJob(payload)).rejects.toThrow("network timeout");
    expect(tables.repo_monitors![0]!.enabled).toBe(true);
  });
});
