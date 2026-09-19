import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { githubLoginString, idString, mediumText } from "./schema-primitives";
import {
  requireAuthUser,
  assertRepoOwner,
  assertScanOwner,
  assertRiskAcceptanceOwner,
} from "../auth.server";
import {
  getRepo,
  getScan,
  getScanTrend,
  getFixRequest,
  getLatestPrJobForRepo,
  getRecentFixRequests,
  getRecentScans,
  getScanHistoryPage,
  updateScanContext,
  acceptRisk,
  getRiskAcceptances,
  revokeRiskAcceptance,
} from "../db.server";

export const getRepoFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    return getRepo(data.repoId);
  });

export const getLatestPrJobFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    return getLatestPrJobForRepo(data.repoId);
  });

export const getScanFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    return getScan(data.repoId);
  });

export const getScanTrendFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    return getScanTrend(data.repoId);
  });

export const getFixRequestByIdFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const job = await getFixRequest(data.id);
    if (!job) return null;
    await assertRepoOwner(job.repoId, user.login);
    return job;
  });

export const getRecentScansFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ owner: githubLoginString.optional() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    if (data.owner && data.owner !== user.login) throw new Error("Not authorized");
    return getRecentScans(user.login);
  });

export const listScansPageFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    return getScanHistoryPage(user.login, data.page ?? 1, data.pageSize ?? 20);
  });

export const getRecentFixRequestsFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ owner: githubLoginString.optional() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    if (data.owner && data.owner !== user.login) throw new Error("Not authorized");
    return getRecentFixRequests(user.login);
  });

export const updateScanContextFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      scanId: idString,
      launchTarget: z
        .enum(["mvp", "startup", "enterprise", "oss", "product_hunt", "investors"])
        .nullable(),
      launchTimeline: z.enum(["today", "this_week", "this_month", "exploring"]).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertScanOwner(data.scanId, user.login);
    return updateScanContext(data.scanId, data.launchTarget, data.launchTimeline);
  });

export const acceptRiskFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      repoId: idString,
      fixId: idString,
      reasonType: z.enum(["temporary", "wont_fix", "false_positive", "not_applicable"]),
      note: mediumText.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    return acceptRisk(data.repoId, data.fixId, user.login, data.reasonType, data.note);
  });

export const getRiskAcceptancesFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ repoId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRepoOwner(data.repoId, user.login);
    return getRiskAcceptances(data.repoId);
  });

export const revokeRiskAcceptanceFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await assertRiskAcceptanceOwner(data.id, user.login);
    return revokeRiskAcceptance(data.id);
  });
