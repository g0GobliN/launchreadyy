/**
 * Per-repo build override storage. Reads are used by the sandbox job itself, so a
 * missing row (the common case) has to be cheap and must never fail a run.
 */

import { getDataStore } from "../data-store.server";
import { assertRepoOwner } from "../auth.server";
import {
  EMPTY_BUILD_SETTINGS,
  normalizeBuildCommand,
  normalizeNodeVersion,
  normalizeRootDir,
  type BuildSettings,
} from "./build-settings";

export type StoredBuildSettings = BuildSettings & { updatedAt: string | null };

/**
 * Job-side read: no ownership check because the job already runs on behalf of the
 * repo owner, and a settings lookup must never be the thing that fails a run.
 */
export async function getProjectBuildSettings(repoId: string): Promise<BuildSettings> {
  try {
    const db = getDataStore();
    const { data, error } = await db
      .from("project_build_settings")
      .select("root_dir, build_command, node_version, include_test")
      .eq("repo_id", repoId)
      .maybeSingle();
    if (error || !data) return EMPTY_BUILD_SETTINGS;
    return {
      // Re-normalized on read: rows written before a rule tightened shouldn't be
      // able to reach the shell just because they were once accepted.
      rootDir: normalizeRootDir(data.root_dir),
      buildCommand: normalizeBuildCommand(data.build_command),
      nodeVersion: normalizeNodeVersion(data.node_version),
      includeTest: data.include_test === true,
    };
  } catch {
    return EMPTY_BUILD_SETTINGS;
  }
}

export async function getProjectBuildSettingsForOwner(
  repoId: string,
  userLogin: string,
): Promise<StoredBuildSettings> {
  await assertRepoOwner(repoId, userLogin);
  const db = getDataStore();
  const { data, error } = await db
    .from("project_build_settings")
    .select("root_dir, build_command, node_version, include_test, updated_at")
    .eq("repo_id", repoId)
    .maybeSingle();
  if (error || !data) return { ...EMPTY_BUILD_SETTINGS, updatedAt: null };
  return {
    rootDir: normalizeRootDir(data.root_dir),
    buildCommand: normalizeBuildCommand(data.build_command),
    nodeVersion: normalizeNodeVersion(data.node_version),
    includeTest: data.include_test === true,
    updatedAt: data.updated_at as string,
  };
}

export async function saveProjectBuildSettings(input: {
  repoId: string;
  userLogin: string;
  rootDir: string | null;
  buildCommand: string | null;
  nodeVersion: string | null;
  includeTest: boolean;
}): Promise<StoredBuildSettings> {
  await assertRepoOwner(input.repoId, input.userLogin);
  const rootDir = normalizeRootDir(input.rootDir);
  const buildCommand = normalizeBuildCommand(input.buildCommand);
  const nodeVersion = normalizeNodeVersion(input.nodeVersion);
  const now = new Date().toISOString();

  const db = getDataStore();
  const { error } = await db.from("project_build_settings").upsert(
    {
      repo_id: input.repoId,
      user_id: input.userLogin,
      root_dir: rootDir,
      build_command: buildCommand,
      node_version: nodeVersion,
      include_test: input.includeTest,
      updated_at: now,
    },
    { onConflict: "repo_id" },
  );
  if (error) throw new Error(error.message);
  return { rootDir, buildCommand, nodeVersion, includeTest: input.includeTest, updatedAt: now };
}
