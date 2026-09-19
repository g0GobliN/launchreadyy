import { getDataStore } from "../../data-store.server";
import type { LiveSiteScanJobPayload } from "../../jobs.server";
import { runLiveSiteScan } from "./live-site-scanner";
import { upsertLiveSiteMonitor } from "./live-site-monitor.server";

export async function processLiveSiteScanJob(payload: LiveSiteScanJobPayload): Promise<void> {
  const db = getDataStore();
  await db
    .from("live_site_scans")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", payload.liveScanId);

  const result = await runLiveSiteScan(payload.domain);

  await db
    .from("live_site_scans")
    .update({
      status: "completed",
      results: result.findings,
      security_score: result.securityScore,
      finished_at: new Date().toISOString(),
    })
    .eq("id", payload.liveScanId);

  await db.from("category_score_history").insert({
    id: crypto.randomUUID(),
    user_id: payload.userLogin,
    category: "Security",
    repo_id: payload.repoId ?? null,
    domain: result.domain,
    score: result.securityScore,
  });

  await upsertLiveSiteMonitor({
    userLogin: payload.userLogin,
    domain: result.domain,
    repoId: payload.repoId,
  }).catch((e) => console.error("[live-site] monitor upsert failed:", e));
}
