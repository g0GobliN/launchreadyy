import type { IssueInput } from "../../scanner-rules";

export interface TlsCheckResult {
  httpsOk: boolean;
  issues: IssueInput[];
}

/** Passive HTTPS / redirect check — no certificate deep-parse in Node-friendly path. */
export async function checkTlsAndHttps(
  domain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TlsCheckResult> {
  const issues: IssueInput[] = [];
  const httpsUrl = `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/`;
  const httpUrl = `http://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/`;

  let httpsOk = false;
  try {
    const res = await fetchImpl(httpsUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    httpsOk = res.ok || (res.status >= 300 && res.status < 500);
  } catch {
    try {
      const res = await fetchImpl(httpsUrl, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
      httpsOk = res.ok || (res.status >= 300 && res.status < 500);
    } catch {
      httpsOk = false;
    }
  }

  if (!httpsOk) {
    issues.push({
      category: "Security",
      title: "HTTPS not reachable",
      severity: "critical",
      why: "The site did not respond successfully over HTTPS. Production traffic must be encrypted.",
      timeSaved: "2h",
      fixId: "live-https",
      checkedFor: [`HEAD/GET ${httpsUrl}`],
      foundEvidence: `HTTPS request to ${httpsUrl} failed or returned an error.`,
      confidence: "high",
      detection: ["rule-based"],
      recommendedFix: "Enable TLS on your host/CDN and redirect all HTTP traffic to HTTPS.",
    });
  }

  // Soft check: HTTP should redirect to HTTPS when HTTPS works
  if (httpsOk) {
    try {
      const res = await fetchImpl(httpUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      const loc = res.headers.get("location") ?? "";
      if (res.status >= 200 && res.status < 300 && !loc.startsWith("https://")) {
        issues.push({
          category: "Security",
          title: "HTTP does not redirect to HTTPS",
          severity: "medium",
          why: "Plain HTTP still serves content, so users can be downgraded to an unencrypted connection.",
          timeSaved: "30m",
          fixId: "live-http-redirect",
          checkedFor: [`GET ${httpUrl} (redirect manual)`],
          foundEvidence: `HTTP responded ${res.status} without an https:// Location.`,
          confidence: "high",
          detection: ["rule-based"],
          recommendedFix: "Configure a 301 redirect from HTTP to HTTPS at the edge.",
        });
      }
    } catch {
      /* ignore */
    }
  }

  return { httpsOk, issues };
}
