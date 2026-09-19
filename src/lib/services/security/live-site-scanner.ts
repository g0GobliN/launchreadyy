import type { IssueInput } from "../../scanner-rules";
import { isBlockedHost } from "../../ssrf-guard";
import { checkCookieFlags, checkSecurityHeaders } from "./header-checks";
import { checkExposures } from "./exposure-checks";
import { checkTlsAndHttps } from "./tls-check";

export interface LiveSiteScanResult {
  domain: string;
  securityScore: number;
  findings: IssueInput[];
  checkedAt: string;
}

function scoreFromIssues(issues: IssueInput[]): number {
  const penalty: Record<string, number> = { critical: 25, high: 15, medium: 8, low: 3 };
  const total = issues.reduce((s, i) => s + (penalty[i.severity] ?? 5), 0);
  return Math.max(0, 100 - Math.min(100, total));
}

function normalizeDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

/**
 * Passive live-site security scan. No exploit payloads, no auth bypass, status/headers only.
 */
export async function runLiveSiteScan(
  domainInput: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveSiteScanResult> {
  const domain = normalizeDomain(domainInput);
  if (!domain || domain.includes(" ") || !domain.includes(".")) {
    throw new Error("Invalid domain");
  }
  // Re-checked here and not only at enqueue: this runs from the job queue, so a row
  // written before the API-boundary guard existed would otherwise still be scanned.
  if (isBlockedHost(domain)) {
    throw new Error("That host is not a public domain.");
  }

  const findings: IssueInput[] = [];
  const { httpsOk, issues: tlsIssues } = await checkTlsAndHttps(domain, fetchImpl);
  findings.push(...tlsIssues);

  const origin = `https://${domain}`;
  if (httpsOk) {
    try {
      const res = await fetchImpl(origin + "/", {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(12_000),
      });
      findings.push(...checkSecurityHeaders(res.headers));
      findings.push(...checkCookieFlags(res.headers));

      const server = res.headers.get("server") || res.headers.get("x-powered-by");
      if (server) {
        findings.push({
          category: "Security",
          title: "Server fingerprint leaked",
          severity: "low",
          why: "Server / X-Powered-By headers advertise stack details useful to attackers.",
          timeSaved: "15m",
          fixId: "live-server-fingerprint",
          checkedFor: ["Server", "X-Powered-By"],
          foundEvidence: `Found: ${server}`,
          confidence: "high",
          detection: ["rule-based"],
          recommendedFix: "Strip Server and X-Powered-By headers at the edge.",
        });
      }
    } catch {
      /* header fetch failed — TLS finding already covers reachability */
    }

    findings.push(...(await checkExposures(origin, fetchImpl)));
  }

  return {
    domain,
    securityScore: scoreFromIssues(findings),
    findings,
    checkedAt: new Date().toISOString(),
  };
}
