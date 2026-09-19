import { getDataStore } from "../data-store.server";

export type SandboxAuditAction =
  | "env_var_decrypt"
  | "env_var_write"
  | "env_var_delete"
  | "sandbox_dispatch"
  | "sandbox_skipped";

export async function writeSandboxAudit(input: {
  userId: string;
  repoId?: string | null;
  action: SandboxAuditAction;
  jobId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const db = getDataStore();
  await db.from("sandbox_audit_log").insert({
    id: crypto.randomUUID(),
    user_id: input.userId,
    repo_id: input.repoId ?? null,
    action: input.action,
    job_id: input.jobId ?? null,
    meta: input.meta ?? {},
  });
}

/** Retention purge for sandbox logs (Capability 8) — default 90 days. */
export async function purgeExpiredSandboxArtifacts(retentionDays = 90): Promise<number> {
  const db = getDataStore();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("sandbox_verify_runs")
    .delete()
    .lt("created_at", cutoff)
    .select("id");
  if (error) {
    console.error("[sandbox] purge failed:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}
