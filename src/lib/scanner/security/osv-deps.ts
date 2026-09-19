/**
 * Known-vulnerability check against OSV.dev.
 *
 * Queries the exact versions a lockfile records, across every ecosystem we scan — see
 * `dependency-inventory.ts` for why the old `package.json`-only inventory was answering a
 * different question than the one advisories are indexed by.
 */

import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals } from "./signals";
import { numericScoreFrom } from "./cvss";
import type { Dependency } from "./dependency-inventory";

const OSV_URL = "https://api.osv.dev/v1/querybatch";
/**
 * A real lockfile tree runs to thousands of packages. The cap is high enough that a typical
 * application is covered whole and low enough to bound worker time; when it bites, the count of
 * what went unchecked is disclosed in `checkedFor` rather than passed off as a clean result.
 */
const MAX_PACKAGES = 1500;
/** OSV accepts up to 1000 queries per batch; stay clear of the edge. */
const BATCH_SIZE = 500;
const MAX_ISSUES = 5;
const TIMEOUT_MS = 10_000;

interface OsvVulnerability {
  id?: string;
  summary?: string;
  database_specific?: { severity?: string };
  severity?: Array<{ type?: string; score?: string }>;
}

interface OsvQueryResult {
  vulns?: OsvVulnerability[];
}

/**
 * Grade an OSV vulnerability, or null when the advisory carries no usable severity at all.
 *
 * `null` is deliberately distinct from `"low"`. The previous version collapsed the two, and since
 * the caller drops lows, an advisory we simply failed to grade vanished from the report — which
 * was every advisory without `database_specific.severity`, because the CVSS fallback ran
 * parseFloat over a *vector string* (`"CVSS:3.1/AV:N/..."`) and got NaN every time.
 */
export function severityFromOsv(v: OsvVulnerability): IssueInput["severity"] | null {
  const dbSev = (v.database_specific?.severity ?? "").toUpperCase();
  if (dbSev.includes("CRITICAL")) return "critical";
  if (dbSev.includes("HIGH")) return "high";
  if (dbSev.includes("MODERATE") || dbSev.includes("MEDIUM")) return "medium";
  if (dbSev.includes("LOW")) return "low";

  // Prefer the newest CVSS the advisory carries. v4 vectors cannot be scored with v3 weights, so
  // numericScoreFrom rejects them and we fall through to the next entry rather than inventing one.
  for (const type of ["CVSS_V4", "CVSS_V3", "CVSS_V2"]) {
    const n = numericScoreFrom(v.severity?.find((s) => s.type === type)?.score);
    if (n === null) continue;
    if (n >= 9) return "critical";
    if (n >= 7) return "high";
    if (n >= 4) return "medium";
    return "low";
  }
  return null;
}

/**
 * Query OSV for the exact installed versions; soft-fail on network errors.
 *
 * A failed batch is skipped rather than aborting the rest: one ecosystem's request timing out
 * should not discard the advisories another already returned.
 */
export async function checkOsvDependencies(
  deps: Dependency[],
  issues: IssueInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const scanned = deps.slice(0, MAX_PACKAGES);
  const skipped = deps.length - scanned.length;
  const entries = scanned.map((dep) => ({
    package: { name: dep.name, ecosystem: dep.ecosystem },
    version: dep.version,
  }));

  if (entries.length === 0) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const batches: (typeof entries)[] = [];
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      batches.push(entries.slice(i, i + BATCH_SIZE));
    }

    const settled = await Promise.all(
      batches.map(async (batch) => {
        try {
          const res = await fetchImpl(OSV_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ queries: batch }),
            signal: controller.signal,
          });
          if (!res.ok) return null;
          const body = (await res.json()) as { results?: OsvQueryResult[] };
          // Results are positional, so a short response must not shift later packages onto the
          // wrong advisory. Pad to the batch length instead of trusting the array to line up.
          const got = body.results ?? [];
          return Array.from({ length: batch.length }, (_, i) => got[i] ?? {});
        } catch {
          return null;
        }
      }),
    );

    if (settled.every((batch) => batch === null)) return;
    const results: OsvQueryResult[] = settled.flatMap(
      (batch, i) =>
        batch ?? Array.from({ length: batches[i]!.length }, () => ({}) as OsvQueryResult),
    );

    const found: Array<{
      pkg: string;
      ver: string;
      vuln: OsvVulnerability;
      sev: IssueInput["severity"];
      /** False when the advisory carried no readable severity and `sev` is our fallback. */
      graded: boolean;
    }> = [];
    for (let i = 0; i < results.length; i++) {
      const vulns = results[i]?.vulns ?? [];
      const pkg = entries[i]?.package.name ?? "unknown";
      const ver = entries[i]?.version ?? "";
      for (const vuln of vulns) {
        const graded = severityFromOsv(vuln);
        if (graded === "low") continue;
        // Ungradable is not the same as harmless: OSV only returns advisories that *affect* the
        // queried version, so report it at medium rather than discarding a real hit because its
        // severity metadata was in a shape we could not read.
        found.push({ pkg, ver, vuln, sev: graded ?? "medium", graded: graded !== null });
      }
    }

    if (found.length === 0) return;

    const ecosystems = [...new Set(scanned.map((d) => d.ecosystem))].sort();

    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    found.sort((a, b) => rank[a.sev] - rank[b.sev]);
    const listed = found.slice(0, MAX_ISSUES);

    // One aggregated issue, not one per package. Every row here carries the same `osv-vuln`
    // fixId, and the scan pipes results through dedupeIssues, which keeps only the first issue
    // per fixId — so pushing one per dependency reported a single CVE and silently discarded the
    // rest. Findings are sorted worst-first, so the survivor was at least the most severe, which
    // is exactly what made the loss invisible.
    const worst = listed[0]!.sev;
    const evidence = listed
      .map(
        (item) =>
          `${item.vuln.id ?? "OSV"} · ${item.pkg}@${item.ver}${
            item.vuln.summary ? ` — ${item.vuln.summary.slice(0, 120)}` : ""
          }${item.graded ? "" : " (advisory carried no readable severity — graded medium)"}`,
      )
      .join("; ");
    const more = found.length > listed.length ? ` +${found.length - listed.length} more.` : "";

    issues.push({
      category: "Security",
      title:
        listed.length === 1
          ? `Known vulnerability in ${listed[0]!.pkg} (${listed[0]!.vuln.id ?? "OSV"})`
          : `Known vulnerabilities in ${found.length} dependencies`,
      severity: worst === "critical" ? "high" : worst, // never Critical without high confidence
      why:
        listed.length === 1
          ? (listed[0]!.vuln.summary ??
            "A known vulnerability is reported for this dependency version — upgrade before launch when possible.")
          : "Known vulnerabilities are reported for these dependency versions — upgrade before launch when possible.",
      timeSaved: "1h",
      fixId: "osv-vuln",
      checkedFor: [
        "OSV.dev querybatch",
        ...listed.map((item) => `${item.pkg}@${item.ver}`),
        `${scanned.length} locked package version${scanned.length === 1 ? "" : "s"} across ${ecosystems.join(", ")}`,
        ...(skipped > 0 ? [`${skipped} further packages not checked (per-scan cap)`] : []),
      ],
      foundEvidence: `${evidence}.${more}`,
      // Both signals are exact now: the version came from a lockfile rather than a range, and OSV
      // returns only advisories that affect the version asked about. The old heuristic signal
      // existed because we were guessing the installed version, and that guess is gone.
      confidence: confidenceFromSignals([
        { kind: "exact_match", detail: listed.map((i) => i.vuln.id ?? "OSV").join(", ") },
        { kind: "exact_match", detail: "versions read from lockfiles" },
      ]),
      detection: ["rule-based"],
      recommendedFix:
        listed.length === 1
          ? `Upgrade ${listed[0]!.pkg} past the fixed version (see ${listed[0]!.vuln.id ?? "OSV"} on osv.dev), then commit the updated lockfile.`
          : `Upgrade each affected package past its fixed version (see the advisory ids on osv.dev), then commit the updated lockfile.`,
    });
  } catch {
    // soft-fail — never break the scan
  } finally {
    clearTimeout(timer);
  }
}
