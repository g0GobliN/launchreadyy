import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals } from "./signals";

const GITHUB_API = "https://api.github.com";
const MAX_ALERTS = 8;

interface DependabotAlert {
  number: number;
  html_url?: string;
  security_advisory?: {
    summary?: string;
    severity?: string;
    ghsa_id?: string;
  };
  dependency?: {
    package?: { name?: string };
  };
}

function mapSeverity(sev?: string): IssueInput["severity"] {
  const s = (sev ?? "").toLowerCase();
  if (s === "critical") return "high"; // cap — upstream severity ≠ our Critical+high-confidence rule
  if (s === "high") return "high";
  if (s === "medium" || s === "moderate") return "medium";
  return "low";
}

/**
 * Aggregate open GitHub Dependabot alerts into Security issues.
 * 403/404 (not enabled / no permission) → silent skip.
 */
export async function checkDependabotAlerts(
  opts: {
    token: string;
    owner: string;
    repo: string;
  },
  issues: IssueInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `${GITHUB_API}/repos/${opts.owner}/${opts.repo}/dependabot/alerts?state=open&per_page=${MAX_ALERTS}`;
    const res = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${opts.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "LaunchReadyy",
      },
      signal: controller.signal,
    });
    if (res.status === 403 || res.status === 404 || !res.ok) return;
    const alerts = (await res.json()) as DependabotAlert[];
    if (!Array.isArray(alerts)) return;

    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    const reportable = alerts
      .slice(0, MAX_ALERTS)
      .map((alert) => ({
        pkg: alert.dependency?.package?.name ?? "dependency",
        ghsa: alert.security_advisory?.ghsa_id ?? `alert-${alert.number}`,
        sev: mapSeverity(alert.security_advisory?.severity),
        summary: alert.security_advisory?.summary,
        ref: alert.html_url ?? `alert #${alert.number}`,
      }))
      .filter((a) => a.sev !== "low")
      .sort((a, b) => rank[a.sev] - rank[b.sev]);

    if (reportable.length === 0) return;

    // Aggregated for the same reason as osv-deps: every alert shares the `dependabot-alert`
    // fixId, and dedupeIssues in the scan keeps only the first issue per fixId, so one push per
    // alert reported a single advisory and dropped the rest.
    const worst = reportable[0]!.sev;
    issues.push({
      category: "Security",
      title:
        reportable.length === 1
          ? `Dependabot: ${reportable[0]!.pkg} (${reportable[0]!.ghsa})`
          : `Dependabot: ${reportable.length} open vulnerability alerts`,
      severity: worst,
      why:
        reportable.length === 1
          ? (reportable[0]!.summary ??
            "GitHub Dependabot reported an open vulnerability alert for this repository.")
          : "GitHub Dependabot reports open vulnerability alerts for this repository.",
      timeSaved: "1h",
      fixId: "dependabot-alert",
      checkedFor: ["GitHub Dependabot alerts API", "open alerts"],
      foundEvidence: reportable.map((a) => `${a.ghsa} · ${a.pkg} · ${a.ref}`).join("; "),
      confidence: confidenceFromSignals([
        { kind: "exact_match", detail: reportable.map((a) => a.ghsa).join(", ") },
      ]),
      detection: ["rule-based"],
      recommendedFix:
        "Review and merge the Dependabot upgrade PRs, or dismiss with a documented risk acceptance.",
    });
  } catch {
    // soft-fail
  } finally {
    clearTimeout(timer);
  }
}
