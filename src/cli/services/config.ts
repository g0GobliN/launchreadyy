import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Always invoked from the project root (npm script / built CLI run from the
// cloned repo) — see the PROJECT_ROOT comment in commands/doctor.ts.
const PROJECT_ROOT = process.cwd();

export interface LaunchReadyyConfig {
  githubToken?: string;
  e2bApiKey?: string;
  aiProvider?: "deepseek" | "anthropic" | "openai" | "gemini";
  deepseekApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  localUserLogin?: string;
  localUserEmail?: string;
  localUserAvatarUrl?: string;
  sessionSecret?: string;
  appUrl?: string;
  envVarEncryptionSecret?: string;
  e2bTemplateId?: string;
}

const CONFIG_DIR = join(PROJECT_ROOT, "data");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const ENV_FILE = join(PROJECT_ROOT, ".env");

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/** Raw KEY → value pairs from `.env`, ignoring comments and blank lines. */
function readEnvFileRaw(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(ENV_FILE)) return out;

  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    out[key] = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * Precedence: `data/config.json` is authoritative when it exists; `.env` is the fallback
 * (and stays the transport to the child process, since env binds at request time).
 * `saveConfig` writes both, so a hand-edit to `.env` alone is silently ignored — this
 * reports exactly those keys so `doctor` can say so instead of the operator guessing.
 */
export function findConflictingVars(): string[] {
  if (!existsSync(CONFIG_FILE)) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Record<string, unknown>;
  } catch {
    return [];
  }

  const raw = readEnvFileRaw();
  const envToConfigKey: Record<string, string> = {
    GITHUB_TOKEN: "githubToken",
    E2B_API_KEY: "e2bApiKey",
    AI_PROVIDER: "aiProvider",
    DEEPSEEK_API_KEY: "deepseekApiKey",
    ANTHROPIC_API_KEY: "anthropicApiKey",
    OPENAI_API_KEY: "openaiApiKey",
    GEMINI_API_KEY: "geminiApiKey",
    LOCAL_USER_LOGIN: "localUserLogin",
    LOCAL_USER_EMAIL: "localUserEmail",
    LOCAL_USER_AVATAR_URL: "localUserAvatarUrl",
    SESSION_SECRET: "sessionSecret",
    APP_URL: "appUrl",
    ENV_VAR_ENCRYPTION_SECRET: "envVarEncryptionSecret",
    E2B_TEMPLATE_ID: "e2bTemplateId",
  };

  const conflicts: string[] = [];
  for (const [envKey, configKey] of Object.entries(envToConfigKey)) {
    const fromEnv = raw[envKey];
    const fromConfig = parsed[configKey];
    if (
      fromEnv !== undefined &&
      fromEnv !== "" &&
      typeof fromConfig === "string" &&
      fromConfig !== "" &&
      fromEnv !== fromConfig
    ) {
      conflicts.push(envKey);
    }
  }
  return conflicts;
}

export function loadConfig(): LaunchReadyyConfig {
  ensureConfigDir();

  // config.json wins when present; .env is the fallback. See findConflictingVars().
  if (existsSync(CONFIG_FILE)) {
    try {
      const content = readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(content);
    } catch {
      // Fall through to .env
    }
  }

  // Fallback to .env
  return loadFromEnv();
}

function loadFromEnv(): LaunchReadyyConfig {
  const config: LaunchReadyyConfig = {};
  const raw = readEnvFileRaw();

  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case "GITHUB_TOKEN":
        config.githubToken = value;
        break;
      case "E2B_API_KEY":
        config.e2bApiKey = value;
        break;
      case "AI_PROVIDER":
        config.aiProvider = value as LaunchReadyyConfig["aiProvider"];
        break;
      case "DEEPSEEK_API_KEY":
        config.deepseekApiKey = value;
        break;
      case "ANTHROPIC_API_KEY":
        config.anthropicApiKey = value;
        break;
      case "OPENAI_API_KEY":
        config.openaiApiKey = value;
        break;
      case "GEMINI_API_KEY":
        config.geminiApiKey = value;
        break;
      case "LOCAL_USER_LOGIN":
        config.localUserLogin = value;
        break;
      case "LOCAL_USER_EMAIL":
        config.localUserEmail = value;
        break;
      case "LOCAL_USER_AVATAR_URL":
        config.localUserAvatarUrl = value;
        break;
      case "SESSION_SECRET":
        config.sessionSecret = value;
        break;
      case "APP_URL":
        config.appUrl = value;
        break;
      case "ENV_VAR_ENCRYPTION_SECRET":
        config.envVarEncryptionSecret = value;
        break;
      case "E2B_TEMPLATE_ID":
        config.e2bTemplateId = value;
        break;
    }
  }

  return config;
}

export function saveConfig(config: LaunchReadyyConfig): void {
  ensureConfigDir();

  // Save to config.json (primary)
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");

  // Set restrictive permissions on Unix
  try {
    chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // Ignore on Windows
  }

  // Also update .env for compatibility with existing app
  updateEnvFile(config);
}

function updateEnvFile(config: LaunchReadyyConfig): void {
  let envContent = "";

  if (existsSync(ENV_FILE)) {
    envContent = readFileSync(ENV_FILE, "utf-8");
  }

  const updates: Record<string, string | undefined> = {
    GITHUB_TOKEN: config.githubToken,
    E2B_API_KEY: config.e2bApiKey,
    AI_PROVIDER: config.aiProvider,
    DEEPSEEK_API_KEY: config.deepseekApiKey,
    ANTHROPIC_API_KEY: config.anthropicApiKey,
    OPENAI_API_KEY: config.openaiApiKey,
    GEMINI_API_KEY: config.geminiApiKey,
    LOCAL_USER_LOGIN: config.localUserLogin,
    LOCAL_USER_EMAIL: config.localUserEmail,
    LOCAL_USER_AVATAR_URL: config.localUserAvatarUrl,
    SESSION_SECRET: config.sessionSecret,
    APP_URL: config.appUrl,
    ENV_VAR_ENCRYPTION_SECRET: config.envVarEncryptionSecret,
    E2B_TEMPLATE_ID: config.e2bTemplateId,
  };

  const lines = envContent.split("\n");
  const updatedKeys = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (key in updates) {
      const value = updates[key];
      if (value !== undefined) {
        lines[i] = `${key}=${value}`;
      } else {
        lines[i] = `# ${key}=`;
      }
      updatedKeys.add(key);
    }
  }

  // Add missing keys
  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key) && value !== undefined) {
      lines.push(`${key}=${value}`);
    }
  }

  writeFileSync(ENV_FILE, lines.join("\n"), "utf-8");

  // Set restrictive permissions on Unix
  try {
    chmodSync(ENV_FILE, 0o600);
  } catch {
    // Ignore on Windows
  }
}

export function maskToken(token?: string): string {
  if (!token) return "not configured";
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}****${token.slice(-4)}`;
}

export function isConfigured(): boolean {
  const config = loadConfig();
  return !!config.githubToken;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function getEnvPath(): string {
  return ENV_FILE;
}
