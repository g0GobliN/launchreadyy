import type { IssueInput } from "../../scanner-rules";

/** Passive exposure probes — status code only, never download body contents of secrets. */
const EXPOSURE_PATHS: { path: string; title: string; severity: IssueInput["severity"] }[] = [
  { path: "/.env", title: "Exposed /.env", severity: "critical" },
  { path: "/.git/HEAD", title: "Exposed /.git", severity: "critical" },
  { path: "/backup.zip", title: "Exposed /backup.zip", severity: "high" },
  { path: "/robots.txt", title: "robots.txt present", severity: "low" },
  { path: "/sitemap.xml", title: "sitemap.xml present", severity: "low" },
];

export async function checkExposures(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IssueInput[]> {
  const issues: IssueInput[] = [];
  for (const { path, title, severity } of EXPOSURE_PATHS) {
    try {
      const res = await fetchImpl(new URL(path, origin).toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      // Only flag sensitive paths on 200; robots/sitemap are informational low when present
      if (path === "/robots.txt" || path === "/sitemap.xml") {
        if (res.status === 200 && severity === "low") {
          // Informational — skip issuing noise for expected files
          continue;
        }
        continue;
      }
      if (res.status === 200) {
        issues.push({
          category: "Security",
          title,
          severity,
          why: `${path} returned HTTP 200 on the live site. Sensitive paths must not be publicly reachable.`,
          timeSaved: "1h",
          fixId: `live-exposure-${path.replace(/\W+/g, "-")}`,
          checkedFor: [`GET ${path} (status only — body not downloaded)`],
          foundEvidence: `GET ${origin}${path} → ${res.status}.`,
          confidence: "high",
          detection: ["rule-based"],
          recommendedFix: `Block ${path} at the edge/web server and rotate any credentials that may have been exposed.`,
        });
      }
    } catch {
      // Network errors are not findings
    }
  }

  // /admin — status only
  try {
    const res = await fetchImpl(new URL("/admin", origin).toString(), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 200) {
      issues.push({
        category: "Security",
        title: "/admin responds 200",
        severity: "low",
        why: "An open /admin response may indicate an unguarded admin surface — confirm auth is required.",
        timeSaved: "30m",
        fixId: "live-admin-surface",
        checkedFor: ["GET /admin status only"],
        foundEvidence: `GET ${origin}/admin → ${res.status}.`,
        confidence: "medium",
        detection: ["rule-based"],
        recommendedFix:
          "Ensure /admin requires authentication and does not leak a usable UI to anonymous users.",
      });
    }
  } catch {
    /* ignore */
  }

  return issues;
}
