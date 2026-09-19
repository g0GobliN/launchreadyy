import { describe, expect, it, vi } from "vitest";
import { checkOsvDependencies } from "./osv-deps";
import type { Dependency } from "./dependency-inventory";
import { dedupeIssues, type IssueInput } from "../../scanner-rules";

function npmDeps(name: string, version: string): Dependency[] {
  return [{ ecosystem: "npm", name, version }];
}

describe("checkOsvDependencies", () => {
  it("maps high OSV vulns into Security issues", async () => {
    const issues: IssueInput[] = [];
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            vulns: [
              {
                id: "GHSA-test-1",
                summary: "Prototype pollution",
                database_specific: { severity: "HIGH" },
              },
            ],
          },
        ],
      }),
    });

    await checkOsvDependencies(
      npmDeps("lodash", "4.17.20"),
      issues,
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalled();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.category).toBe("Security");
    expect(issues[0]!.foundEvidence).toContain("GHSA-test-1");
    expect(issues[0]!.severity).toBe("high");
  });

  it("soft-fails on network errors", async () => {
    const issues: IssueInput[] = [];
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    await checkOsvDependencies(
      npmDeps("lodash", "4.17.20"),
      issues,
      fetchImpl as unknown as typeof fetch,
    );
    expect(issues).toHaveLength(0);
  });

  /** Respond with one vulnerability shaped however the test needs. */
  function osvReturning(vuln: Record<string, unknown>) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ vulns: [vuln] }] }),
    }) as unknown as typeof fetch;
  }

  /**
   * Regression: OSV's `severity[].score` holds a CVSS *vector*, and the old code ran parseFloat
   * over it. That produced NaN, every threshold comparison was false, the advisory graded "low",
   * and the caller dropped lows — so a 9.8 critical with no `database_specific` block vanished
   * from the report entirely.
   */
  it("reports a critical advisory that carries only a CVSS vector", async () => {
    const issues: IssueInput[] = [];
    await checkOsvDependencies(
      npmDeps("lodash", "4.17.20"),
      issues,
      osvReturning({
        id: "GHSA-cvss-only",
        summary: "Remote code execution",
        severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.foundEvidence).toContain("GHSA-cvss-only");
    // Critical is reported as high — the rule never claims Critical without high confidence.
    expect(issues[0]!.severity).toBe("high");
  });

  it("reports an advisory whose severity we cannot read, rather than dropping it", async () => {
    const issues: IssueInput[] = [];
    await checkOsvDependencies(
      npmDeps("lodash", "4.17.20"),
      issues,
      osvReturning({ id: "GHSA-no-severity", summary: "Unspecified issue" }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("medium");
    expect(issues[0]!.foundEvidence).toContain("no readable severity");
  });

  it("does not mis-score a v4-only vector with v3 weights", async () => {
    const issues: IssueInput[] = [];
    await checkOsvDependencies(
      npmDeps("lodash", "4.17.20"),
      issues,
      osvReturning({
        id: "GHSA-v4-only",
        severity: [{ type: "CVSS_V4", score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H" }],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("medium");
  });

  it("still filters genuinely low-severity advisories", async () => {
    const issues: IssueInput[] = [];
    await checkOsvDependencies(
      npmDeps("lodash", "4.17.20"),
      issues,
      osvReturning({
        id: "GHSA-low",
        severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N" }],
      }),
    );
    expect(issues).toHaveLength(0);
  });

  /**
   * Regression: one issue was pushed per vulnerable package, all under the `osv-vuln` fixId.
   * dedupeIssues in the scan keeps only the first issue per fixId, so five vulnerable
   * dependencies reported one CVE and silently discarded four. Results are sorted worst-first,
   * so the survivor was always the most severe — which is precisely what hid the loss.
   */
  it("reports every vulnerable dependency in one finding that survives dedupe", async () => {
    const pkgs = ["lodash", "axios", "express", "minimist", "jsonwebtoken"];
    const issues: IssueInput[] = [];
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: pkgs.map((p) => ({
          vulns: [
            {
              id: `GHSA-${p}`,
              summary: `RCE in ${p}`,
              database_specific: { severity: "CRITICAL" },
            },
          ],
        })),
      }),
    });

    await checkOsvDependencies(
      pkgs.map((p) => ({ ecosystem: "npm" as const, name: p, version: "1.0.0" })),
      issues,
      fetchImpl as unknown as typeof fetch,
    );

    expect(issues).toHaveLength(1);
    expect(dedupeIssues(issues)).toHaveLength(1);
    expect(issues[0]!.title).toContain("5 dependencies");
    for (const p of pkgs) {
      expect(issues[0]!.foundEvidence).toContain(`GHSA-${p}`);
    }
  });

  it("keeps the single-package wording when only one is vulnerable", async () => {
    const issues: IssueInput[] = [];
    await checkOsvDependencies(
      npmDeps("lodash", "4.17.20"),
      issues,
      osvReturning({ id: "GHSA-only", database_specific: { severity: "HIGH" } }),
    );
    expect(issues[0]!.title).toBe("Known vulnerability in lodash (GHSA-only)");
  });

  it("discloses how many locked versions were checked, and in which ecosystems", async () => {
    const issues: IssueInput[] = [];
    await checkOsvDependencies(
      [
        { ecosystem: "npm", name: "lodash", version: "4.17.20" },
        { ecosystem: "Go", name: "github.com/x/y", version: "1.0.0" },
      ],
      issues,
      osvReturning({ id: "GHSA-x", database_specific: { severity: "HIGH" } }),
    );
    const checked = issues[0]!.checkedFor!.join(" ");
    expect(checked).toContain("2 locked package versions");
    expect(checked).toContain("Go, npm");
  });

  /**
   * A lockfile tree is thousands of packages, so the query is split into batches. The regression
   * this guards is positional: OSV answers by index, and flattening a short or failed batch
   * without padding shifted every later package onto another package's advisory.
   */
  it("keeps package/advisory alignment when a batch is split", async () => {
    const deps: Dependency[] = Array.from({ length: 501 }, (_, i) => ({
      ecosystem: "npm" as const,
      name: `pkg-${i}`,
      version: "1.0.0",
    }));
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { queries: unknown[] };
      return {
        ok: true,
        // Only the very last package is vulnerable; it lives alone in the second batch.
        json: async () => ({
          results: body.queries.map((_q, i) =>
            body.queries.length === 1 && i === 0
              ? { vulns: [{ id: "GHSA-last", database_specific: { severity: "HIGH" } }] }
              : {},
          ),
        }),
      };
    });

    const issues: IssueInput[] = [];
    await checkOsvDependencies(deps, issues, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.foundEvidence).toContain("pkg-500");
    expect(issues[0]!.foundEvidence).not.toContain("pkg-0@");
  });

  it("keeps the advisories a surviving batch returned when another batch fails", async () => {
    const deps: Dependency[] = Array.from({ length: 501 }, (_, i) => ({
      ecosystem: "npm" as const,
      name: `pkg-${i}`,
      version: "1.0.0",
    }));
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { queries: unknown[] };
      if (call++ === 0) return { ok: false, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({
          results: body.queries.map(() => ({
            vulns: [{ id: "GHSA-survivor", database_specific: { severity: "HIGH" } }],
          })),
        }),
      };
    });

    const issues: IssueInput[] = [];
    await checkOsvDependencies(deps, issues, fetchImpl as unknown as typeof fetch);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.foundEvidence).toContain("GHSA-survivor");
  });

  it("reports nothing rather than throwing when every batch fails", async () => {
    const issues: IssueInput[] = [];
    const failing = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await checkOsvDependencies(
      npmDeps("lodash", "4.17.20"),
      issues,
      failing as unknown as typeof fetch,
    );
    expect(issues).toHaveLength(0);
  });
});
