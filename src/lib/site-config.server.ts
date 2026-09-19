import { getDataStore } from "./data-store.server";
import { FEATURE_FLAG_DEFS, type FeatureFlagKey, defaultFeatureFlags } from "./feature-flags";

const FLAG_CACHE_MS = 30_000;
let flagCache: { at: number; flags: Record<FeatureFlagKey, boolean> } | null = null;

export function clearFeatureFlagCache(): void {
  flagCache = null;
}

export async function getFeatureFlags(): Promise<Record<FeatureFlagKey, boolean>> {
  const now = Date.now();
  if (flagCache && now - flagCache.at < FLAG_CACHE_MS) return flagCache.flags;

  const flags = defaultFeatureFlags();
  flagCache = { at: now, flags };
  return flags;
}

export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
  const flags = await getFeatureFlags();
  return flags[key];
}

export async function assertFeatureEnabled(key: FeatureFlagKey): Promise<void> {
  if (!(await isFeatureEnabled(key))) {
    const def = FEATURE_FLAG_DEFS.find((d) => d.key === key);
    throw new Error(`${def?.label ?? key} is temporarily disabled. Try again later.`);
  }
}

export async function getSiteConfigValue(key: string): Promise<string | null> {
  const db = getDataStore();
  const { data } = await db.from("site_config").select("value").eq("key", key).single();
  return data?.value ?? null;
}

export async function setSiteConfigValue(key: string, value: string): Promise<void> {
  const db = getDataStore();
  await db
    .from("site_config")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (key.startsWith("flag_")) clearFeatureFlagCache();
}

export async function getAllSiteConfig(): Promise<Record<string, string>> {
  const db = getDataStore();
  const { data } = await db.from("site_config").select("key, value");
  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.key] = row.value;
  return map;
}

export async function isMaintenanceMode(): Promise<boolean> {
  const val = await getSiteConfigValue("maintenance_mode");
  return val === "true";
}

export async function assertNotMaintenanceMode(): Promise<void> {
  if (await isMaintenanceMode()) {
    throw new Error("LaunchReadyy is in maintenance mode. New scans and fix jobs are paused.");
  }
}
