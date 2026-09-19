import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { idString } from "./schema-primitives";
import { requireAuthUser, assertRepoOwner } from "../auth.server";
import { getDataStore } from "../data-store.server";
import {
  buildLaunchReportData,
  publicReportUrl,
  type LaunchReportData,
} from "../launch-report.server";

async function loadReportPayload(
  repoId: string,
  scanId?: string,
): Promise<LaunchReportData | null> {
  const db = getDataStore();

  const { data: repo } = await db.from("repos").select("*").eq("id", repoId).single();
  if (!repo) return null;

  let scanQuery = db
    .from("scans")
    .select("*")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false });
  if (scanId) scanQuery = scanQuery.eq("id", scanId);
  const { data: scan } = await scanQuery.limit(1).single();
  if (!scan) return null;

  const [{ data: issues }, { data: prevScan }, { count: fixCount }, { data: sandboxRun }] =
    await Promise.all([
      db.from("issues").select("*").eq("scan_id", scan.id),
      db
        .from("scans")
        .select("score")
        .eq("repo_id", repoId)
        .lt("created_at", scan.created_at)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("fix_requests")
        .select("*", { count: "exact", head: true })
        .eq("repo_id", repoId)
        .eq("status", "completed"),
      db
        .from("sandbox_verify_runs")
        .select("status")
        .eq("scan_id", scan.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  return buildLaunchReportData({
    repo,
    scan,
    issueRows: issues ?? [],
    previousScore: prevScan?.score ?? null,
    completedFixCount: fixCount ?? 0,
    sandboxStatus: sandboxRun?.status as
      | "queued"
      | "running"
      | "passed"
      | "failed"
      | "skipped"
      | null,
  });
}

export const getLaunchReportFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    const report = await loadReportPayload(data.repoId);
    if (!report) throw new Error("No scan data for this repo.");

    const db = getDataStore();
    const { data: share } = await db
      .from("launch_reports")
      .select("share_token, created_at")
      .eq("repo_id", data.repoId)
      .eq("revoked", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      report,
      shareUrl: share ? publicReportUrl(share.share_token) : null,
      shareCreatedAt: share?.created_at ?? null,
    };
  });

export const createLaunchReportShareFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);

    const db = getDataStore();
    const { data: scan } = await db
      .from("scans")
      .select("id")
      .eq("repo_id", data.repoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (!scan) throw new Error("Run a scan before sharing a launch report.");

    await db
      .from("launch_reports")
      .update({ revoked: true })
      .eq("repo_id", data.repoId)
      .eq("owner_login", user.login)
      .eq("revoked", false);

    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    const id = crypto.randomUUID();
    const { error } = await db.from("launch_reports").insert({
      id,
      share_token: token,
      repo_id: data.repoId,
      scan_id: scan.id,
      owner_login: user.login,
    });
    if (error) throw new Error(error.message);

    return { shareUrl: publicReportUrl(token), token };
  });

export const getPublicLaunchReportFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: z.string().min(8).max(128) }))
  .handler(async ({ data }): Promise<LaunchReportData | null> => {
    const db = getDataStore();
    const { data: row } = await db
      .from("launch_reports")
      .select("repo_id, scan_id, revoked")
      .eq("share_token", data.token)
      .maybeSingle();
    if (!row || row.revoked) return null;

    const report = await loadReportPayload(row.repo_id, row.scan_id);
    return report;
  });
