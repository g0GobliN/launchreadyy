import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  domainString,
  idString,
  mediumText,
  optionalIdString,
  shortText,
  slugString,
  urlString,
} from "./schema-primitives";
import { requireAuthUser, assertRepoOwner } from "../auth.server";
import { getDataStore } from "../data-store.server";
import { enqueueDurableJob } from "../jobs.server";
import { rateLimitByUser } from "../rate-limit.server";
import {
  DOMAIN_VERIFY_PATH,
  assertDomainHttpOwnership,
  buildDomainVerifyToken,
} from "../domain-verify.server";
import { isBlockedHost } from "../ssrf-guard";

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const CONFIRM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

/**
 * DOMAIN_RE alone is not an SSRF check — `127.0.0.1` and `169.254.169.254` are made of
 * dotted alphanumeric labels and sail through it. Every entry point that turns user input
 * into an outbound request goes through here.
 */
function assertPublicDomain(domain: string): void {
  if (!DOMAIN_RE.test(domain)) throw new Error("Invalid domain");
  if (isBlockedHost(domain)) throw new Error("That host is not a public domain.");
}

export const getDomainVerifyChallengeFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ domain: z.string().min(3).max(253) }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const domain = normalizeDomain(data.domain);
    assertPublicDomain(domain);

    const token = await buildDomainVerifyToken(user.login, domain);
    return {
      domain,
      token,
      path: DOMAIN_VERIFY_PATH,
      url: `https://${domain}${DOMAIN_VERIFY_PATH}`,
      instruction: `Create a text file at ${DOMAIN_VERIFY_PATH} on ${domain} whose body contains this token: ${token}`,
    };
  });

export const confirmDomainFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ domain: z.string().min(3).max(253) }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await rateLimitByUser("scan", user.login);

    const domain = normalizeDomain(data.domain);
    assertPublicDomain(domain);

    const token = await buildDomainVerifyToken(user.login, domain);
    await assertDomainHttpOwnership(domain, token);

    const db = getDataStore();
    const id = crypto.randomUUID();
    const { error } = await db.from("domain_scan_confirmations").insert({
      id,
      user_id: user.login,
      domain,
      confirmed_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true, domain, confirmedAt: new Date().toISOString() };
  });

export const startLiveSiteScanFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      domain: z.string().min(3).max(253),
      repoId: optionalIdString,
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await rateLimitByUser("scan", user.login);

    const domain = normalizeDomain(data.domain);
    assertPublicDomain(domain);
    if (data.repoId) await assertRepoOwner(data.repoId, user.login);

    const db = getDataStore();
    const { data: confirmations } = await db
      .from("domain_scan_confirmations")
      .select("confirmed_at")
      .eq("user_id", user.login)
      .eq("domain", domain)
      .order("confirmed_at", { ascending: false })
      .limit(1);

    const latest = confirmations?.[0]?.confirmed_at
      ? new Date(confirmations[0].confirmed_at).getTime()
      : 0;
    if (!latest || Date.now() - latest > CONFIRM_TTL_MS) {
      throw new Error(
        "Confirm domain ownership first: publish the verification file, then save confirmation.",
      );
    }

    const liveScanId = crypto.randomUUID();
    const { error } = await db.from("live_site_scans").insert({
      id: liveScanId,
      user_id: user.login,
      domain,
      repo_id: data.repoId ?? null,
      status: "queued",
      results: [],
    });
    if (error) throw new Error(error.message);

    // Keep only the 10 most recent scans per repo (or per user if no repo).
    await pruneLiveSiteHistory(db, user.login, data.repoId ?? null);

    const jobId = await enqueueDurableJob({
      type: "live_site_scan",
      liveScanId,
      userLogin: user.login,
      domain,
      repoId: data.repoId ?? null,
    });

    return { liveScanId, jobId, status: "queued" as const };
  });

const HISTORY_CAP = 10;

async function pruneLiveSiteHistory(
  db: ReturnType<typeof getDataStore>,
  userId: string,
  repoId: string | null,
) {
  let q = db
    .from("live_site_scans")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (repoId) q = q.eq("repo_id", repoId);
  const { data: rows } = await q;
  if (!rows || rows.length <= HISTORY_CAP) return;
  const staleIds = rows.slice(HISTORY_CAP).map((r) => r.id as string);
  if (staleIds.length > 0) {
    await db.from("live_site_scans").delete().in("id", staleIds);
  }
}

export const getLiveSiteScanFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ liveScanId: idString }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const db = getDataStore();
    const { data: row, error } = await db
      .from("live_site_scans")
      .select("*")
      .eq("id", data.liveScanId)
      .eq("user_id", user.login)
      .single();
    if (error || !row) throw new Error("Live scan not found");
    const results = Array.isArray(row.results)
      ? (row.results as Array<{
          title?: string;
          severity?: string;
          why?: string;
          category?: string;
          fixId?: string;
          checkedFor?: string[];
          foundEvidence?: string;
          confidence?: string;
          recommendedFix?: string;
          detection?: string[];
          timeSaved?: string;
        }>)
      : [];
    return {
      id: row.id as string,
      domain: row.domain as string,
      status: row.status as string,
      results,
      security_score: (row.security_score as number | null) ?? null,
      created_at: row.created_at as string,
      started_at: (row.started_at as string | null) ?? null,
      finished_at: (row.finished_at as string | null) ?? null,
    };
  });

export const listLiveSiteScansFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      repoId: optionalIdString,
      limit: z.number().min(1).max(10).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    if (data.repoId) await assertRepoOwner(data.repoId, user.login);
    const db = getDataStore();
    let q = db
      .from("live_site_scans")
      .select("id, domain, status, security_score, created_at, finished_at")
      .eq("user_id", user.login)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? HISTORY_CAP);
    if (data.repoId) q = q.eq("repo_id", data.repoId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      id: string;
      domain: string;
      status: string;
      security_score: number | null;
      created_at: string;
      finished_at: string | null;
    }>;
  });

export const getSecurityHistoryFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      domain: domainString.optional(),
      repoId: optionalIdString,
      limit: z.number().min(1).max(50).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    if (data.repoId) await assertRepoOwner(data.repoId, user.login);
    const db = getDataStore();
    let q = db
      .from("category_score_history")
      .select("*")
      .eq("user_id", user.login)
      .eq("category", "Security")
      .order("recorded_at", { ascending: false })
      .limit(data.limit ?? 20);
    if (data.domain) q = q.eq("domain", normalizeDomain(data.domain));
    if (data.repoId) q = q.eq("repo_id", data.repoId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const explainSecurityFindingFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      // Every field here is interpolated into a model prompt, so the bounds are load-bearing:
      // they cap what one call can spend in tokens, not just what the database will accept.
      issue: z.object({
        id: idString,
        category: slugString,
        title: shortText,
        severity: z.enum(["critical", "high", "medium", "low"]),
        why: mediumText,
        timeSaved: shortText,
        fixId: idString,
        confidence: z.enum(["high", "medium", "low"]).optional(),
        foundEvidence: mediumText.optional(),
        checkedFor: z.array(shortText).max(100).optional(),
        recommendedFix: mediumText.optional(),
        autoFixable: z.boolean().optional(),
      }),
      repoUrl: urlString.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    await rateLimitByUser("ai", user.login);

    const { explainSecurityFinding } =
      await import("../services/security/ai-security-analysis.server");
    return await explainSecurityFinding(data.issue as never, { repoUrl: data.repoUrl });
  });
