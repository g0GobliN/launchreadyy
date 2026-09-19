import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Covers the state the live-security page reads. The cadence/due policy is tested pure in
 * live-site-monitor.test.ts; what needs a harness here is the confirmation-expiry join —
 * a lapsed confirmation makes scheduled monitoring skip the domain, so the value the UI warns
 * from has to be right — and the fact that every monitored domain comes back, not just one.
 */

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

function query(table: string) {
  const filters: Record<string, unknown> = {};
  const inFilters: Record<string, unknown[]> = {};
  let limitN: number | null = null;
  let patch: Row | null = null;

  const matching = () =>
    (tables[table] ?? []).filter(
      (r) =>
        Object.entries(filters).every(([k, v]) => r[k] === v) &&
        Object.entries(inFilters).every(([k, vs]) => vs.includes(r[k])),
    );

  const settle = () => {
    if (patch) {
      for (const r of matching()) Object.assign(r, patch);
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
    in: (col: string, vals: unknown[]) => {
      inFilters[col] = vals;
      return chain;
    },
    order: () => chain,
    limit: (n: number) => {
      limitN = n;
      return chain;
    },
    update: (p: Row) => {
      patch = p;
      return chain;
    },
    maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(settle()).then(res, rej),
  };
  return chain;
}

vi.mock("../../data-store.server", () => ({
  getDataStore: () => ({ from: (t: string) => query(t) }),
}));
vi.mock("../../jobs.server", () => ({
  enqueueDurableJob: async () => "job-1",
}));

import { getLiveSiteMonitorsForRepo, setLiveSiteMonitorEnabled } from "./live-site-monitor.server";

const DAY = 24 * 60 * 60 * 1000;

const monitorRow = (over: Partial<Row>): Row => ({
  domain: "a.com",
  user_id: "alice",
  repo_id: "repo-1",
  enabled: true,
  cadence: "daily",
  last_enqueued_at: null,
  created_at: "2026-08-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
});

describe("getLiveSiteMonitorsForRepo", () => {
  it("is empty when the repo has no monitored domain", async () => {
    expect(await getLiveSiteMonitorsForRepo("alice", "repo-1")).toEqual([]);
  });

  it("reports cadence, last check, and when the confirmation lapses", async () => {
    const confirmedAt = new Date(Date.now() - 2 * DAY).toISOString();
    tables.live_site_monitors = [
      monitorRow({ domain: "example.com", last_enqueued_at: "2026-08-12T06:00:00Z" }),
    ];
    tables.domain_scan_confirmations = [
      { user_id: "alice", domain: "example.com", confirmed_at: confirmedAt },
    ];

    const [state] = await getLiveSiteMonitorsForRepo("alice", "repo-1");
    expect(state).toMatchObject({
      domain: "example.com",
      enabled: true,
      cadence: "daily",
      lastCheckedAt: "2026-08-12T06:00:00Z",
    });
    // 30-day TTL, so a confirmation from two days ago has 28 left.
    const remaining = new Date(state!.confirmationExpiresAt!).getTime() - Date.now();
    expect(Math.round(remaining / DAY)).toBe(28);
  });

  it("returns every monitored domain, each with its own confirmation", async () => {
    // Three sites connected to one repo have three independent monitors. Returning
    // only the newest would leave two running with nothing on the page able to stop them.
    const fresh = new Date(Date.now() - DAY).toISOString();
    const stale = new Date(Date.now() - 40 * DAY).toISOString();
    tables.live_site_monitors = [
      monitorRow({ domain: "a.com" }),
      monitorRow({ domain: "b.com", enabled: false, cadence: "weekly" }),
      monitorRow({ domain: "c.com" }),
    ];
    tables.domain_scan_confirmations = [
      { user_id: "alice", domain: "a.com", confirmed_at: fresh },
      { user_id: "alice", domain: "b.com", confirmed_at: stale },
    ];

    const states = await getLiveSiteMonitorsForRepo("alice", "repo-1");
    expect(states.map((s) => s.domain)).toEqual(["a.com", "b.com", "c.com"]);
    expect(states.map((s) => s.enabled)).toEqual([true, false, true]);
    expect(states.map((s) => s.cadence)).toEqual(["daily", "weekly", "daily"]);

    // a.com still covered, b.com lapsed, c.com never confirmed.
    expect(new Date(states[0]!.confirmationExpiresAt!).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(states[1]!.confirmationExpiresAt!).getTime()).toBeLessThan(Date.now());
    expect(states[2]!.confirmationExpiresAt).toBeNull();
  });

  it("does not cross confirmations between domains", async () => {
    tables.live_site_monitors = [monitorRow({ domain: "a.com" })];
    tables.domain_scan_confirmations = [
      { user_id: "alice", domain: "b.com", confirmed_at: new Date().toISOString() },
    ];
    const [state] = await getLiveSiteMonitorsForRepo("alice", "repo-1");
    expect(state!.confirmationExpiresAt).toBeNull();
  });

  it("treats an unknown cadence as weekly", async () => {
    tables.live_site_monitors = [monitorRow({ cadence: "hourly" })];
    const [state] = await getLiveSiteMonitorsForRepo("alice", "repo-1");
    expect(state!.cadence).toBe("weekly");
  });

  it("does not read another user's monitor", async () => {
    tables.live_site_monitors = [monitorRow({ user_id: "bob" })];
    expect(await getLiveSiteMonitorsForRepo("alice", "repo-1")).toEqual([]);
  });

  it("does not read a monitor belonging to another repo", async () => {
    tables.live_site_monitors = [monitorRow({ repo_id: "repo-2" })];
    expect(await getLiveSiteMonitorsForRepo("alice", "repo-1")).toEqual([]);
  });
});

describe("setLiveSiteMonitorEnabled", () => {
  beforeEach(() => {
    tables.live_site_monitors = [
      { domain: "a.com", user_id: "alice", enabled: true, cadence: "daily" },
      { domain: "b.com", user_id: "alice", enabled: true, cadence: "daily" },
      { domain: "a.com", user_id: "bob", enabled: true, cadence: "daily" },
    ];
  });

  it("pauses only the named domain", async () => {
    await setLiveSiteMonitorEnabled("alice", "a.com", false);
    expect(tables.live_site_monitors!.map((r) => r.enabled)).toEqual([false, true, true]);
  });

  it("resumes again", async () => {
    await setLiveSiteMonitorEnabled("alice", "a.com", false);
    await setLiveSiteMonitorEnabled("alice", "a.com", true);
    expect(tables.live_site_monitors![0]!.enabled).toBe(true);
  });

  it("cannot touch a domain owned by someone else", async () => {
    await setLiveSiteMonitorEnabled("alice", "a.com", false);
    expect(tables.live_site_monitors![2]!.enabled).toBe(true);
  });
});
