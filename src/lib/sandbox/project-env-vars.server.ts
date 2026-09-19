/**
 * Per-repo encrypted env var CRUD (Capability 2 / Phase 2).
 * Values are write-only after save — list never returns plaintext.
 */

import { getDataStore } from "../data-store.server";
import { assertRepoOwner } from "../auth.server";
import { decryptEnvValue, encryptEnvValue, ENV_VAR_KEY_VERSION } from "./env-crypto.server";
import { writeSandboxAudit } from "./audit.server";

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ProjectEnvVarMeta = {
  id: string;
  key: string;
  isSecret: boolean;
  isSet: true;
  updatedAt: string;
  lastUsedAt: string | null;
};

export async function listProjectEnvVars(
  repoId: string,
  userLogin: string,
): Promise<ProjectEnvVarMeta[]> {
  await assertRepoOwner(repoId, userLogin);
  const db = getDataStore();
  const { data, error } = await db
    .from("project_env_vars")
    .select("id, key, is_secret, updated_at, last_used_at")
    .eq("repo_id", repoId)
    .order("key");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    key: r.key,
    isSecret: r.is_secret,
    isSet: true as const,
    updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at,
  }));
}

export async function upsertProjectEnvVar(input: {
  repoId: string;
  userLogin: string;
  key: string;
  value: string;
  isSecret?: boolean;
}): Promise<ProjectEnvVarMeta> {
  await assertRepoOwner(input.repoId, input.userLogin);
  const key = input.key.trim();
  if (!KEY_RE.test(key)) throw new Error("Invalid env var key");
  if (!input.value) throw new Error("Value is required");

  const db = getDataStore();
  const encrypted = encryptEnvValue(input.value);
  const now = new Date().toISOString();

  const { data: existing } = await db
    .from("project_env_vars")
    .select("id")
    .eq("repo_id", input.repoId)
    .eq("key", key)
    .maybeSingle();

  let id = existing?.id;
  if (id) {
    const { error } = await db
      .from("project_env_vars")
      .update({
        encrypted_value: encrypted,
        key_version: ENV_VAR_KEY_VERSION,
        is_secret: input.isSecret !== false,
        updated_at: now,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    id = crypto.randomUUID();
    const { error } = await db.from("project_env_vars").insert({
      id,
      repo_id: input.repoId,
      user_id: input.userLogin,
      key,
      encrypted_value: encrypted,
      key_version: ENV_VAR_KEY_VERSION,
      is_secret: input.isSecret !== false,
      created_by: input.userLogin,
      created_at: now,
      updated_at: now,
    });
    if (error) throw new Error(error.message);
  }

  await writeSandboxAudit({
    userId: input.userLogin,
    repoId: input.repoId,
    action: "env_var_write",
    meta: { key },
  });

  return {
    id,
    key,
    isSecret: input.isSecret !== false,
    isSet: true,
    updatedAt: now,
    lastUsedAt: null,
  };
}

const MAX_BULK_ENTRIES = 100;

/** Bulk upsert — used by the "paste .env" flow so N vars cost one rate-limit hit, not N. */
export async function upsertProjectEnvVarsBulk(input: {
  repoId: string;
  userLogin: string;
  entries: { key: string; value: string }[];
}): Promise<ProjectEnvVarMeta[]> {
  if (input.entries.length === 0) throw new Error("No variables to save");
  if (input.entries.length > MAX_BULK_ENTRIES) {
    throw new Error(`Too many variables in one paste (max ${MAX_BULK_ENTRIES})`);
  }
  const out: ProjectEnvVarMeta[] = [];
  for (const entry of input.entries) {
    out.push(
      await upsertProjectEnvVar({
        repoId: input.repoId,
        userLogin: input.userLogin,
        key: entry.key,
        value: entry.value,
      }),
    );
  }
  return out;
}

export async function deleteProjectEnvVar(input: {
  repoId: string;
  userLogin: string;
  key: string;
}): Promise<void> {
  await assertRepoOwner(input.repoId, input.userLogin);
  const db = getDataStore();
  const { error } = await db
    .from("project_env_vars")
    .delete()
    .eq("repo_id", input.repoId)
    .eq("key", input.key);
  if (error) throw new Error(error.message);
  await writeSandboxAudit({
    userId: input.userLogin,
    repoId: input.repoId,
    action: "env_var_delete",
    meta: { key: input.key },
  });
}

/** Decrypt all vars for a repo for sandbox injection. Audit-logged. Never expose to client. */
export async function loadDecryptedProjectEnvVars(
  repoId: string,
  userLogin: string,
  jobId?: string,
): Promise<Record<string, string>> {
  await assertRepoOwner(repoId, userLogin);
  const db = getDataStore();
  const { data, error } = await db
    .from("project_env_vars")
    .select("id, key, encrypted_value")
    .eq("repo_id", repoId);
  if (error) throw new Error(error.message);

  const out: Record<string, string> = {};
  const ids: string[] = [];
  for (const row of data ?? []) {
    const plain = decryptEnvValue(row.encrypted_value);
    if (plain == null) continue;
    out[row.key] = plain;
    ids.push(row.id);
  }

  if (ids.length > 0) {
    await writeSandboxAudit({
      userId: userLogin,
      repoId,
      action: "env_var_decrypt",
      jobId,
      meta: { keys: Object.keys(out) },
    });
    await db
      .from("project_env_vars")
      .update({ last_used_at: new Date().toISOString() })
      .in("id", ids);
  }
  return out;
}
