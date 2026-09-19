/**
 * Capability 5 — placeholder env synthesis for sandboxed verify runs.
 * Pure merge logic: user-supplied → .env.example literal → synthesized placeholder.
 * No I/O, no crypto, no provider calls.
 */

export type EnvValueSource = "user" | "example" | "synthesized";

export type MergedEnvEntry = {
  value: string;
  source: EnvValueSource;
};

export type MergeEnvVarsResult = {
  entries: Record<string, MergedEnvEntry>;
  valuesAsRecord: () => Record<string, string>;
};

const SECRET_SUFFIX = /_(?:KEY|SECRET|TOKEN|PASSWORD|PASS|PRIVATE)$/i;
const SECRET_EXACT = /^(?:KEY|SECRET|TOKEN|PASSWORD|PASS|PRIVATE)$/i;
const URL_SUFFIX = /_(?:URL|URI)$/i;
const EMAIL_SUFFIX = /_EMAIL$/i;
const ENABLE_PREFIX = /^ENABLE_/i;
const ENABLED_SUFFIX = /_ENABLED$/i;
const DB_URL_KEY = /(?:DATABASE|DB|POSTGRES|MYSQL|MONGO(?:DB)?)_?(?:URL|URI)$/i;

/** Example values that are documentation placeholders, not usable build-time values. */
const EXAMPLE_PLACEHOLDER_RE =
  /^(changeme|change.?me|your[-_ ].+|<.*>|xxx+|todo|replace.?me|insert.?|fill.?in|example|dummy|n\/a|none)$/i;

function isSecretShapedKey(key: string): boolean {
  return SECRET_SUFFIX.test(key) || SECRET_EXACT.test(key);
}

function isUsableExampleLiteral(key: string, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (EXAMPLE_PLACEHOLDER_RE.test(trimmed)) return false;
  // Never trust example literals for secret-shaped keys — synthesize instead.
  if (isSecretShapedKey(key)) return false;
  return true;
}

/** Deterministic placeholder so re-runs are stable for caching / redaction. */
function deterministicPlaceholder(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `lr_placeholder_${hash.toString(16).padStart(8, "0")}`;
}

export function synthesizePlaceholder(key: string): string {
  if (DB_URL_KEY.test(key)) {
    return "postgres://placeholder:placeholder@127.0.0.1:5432/placeholder";
  }
  if (URL_SUFFIX.test(key)) {
    return "https://placeholder.example.invalid";
  }
  if (EMAIL_SUFFIX.test(key)) {
    return "placeholder@example.invalid";
  }
  if (ENABLE_PREFIX.test(key) || ENABLED_SUFFIX.test(key)) {
    return "false";
  }
  if (isSecretShapedKey(key)) {
    return deterministicPlaceholder(key);
  }
  return deterministicPlaceholder(key);
}

function unquote(raw: string): string {
  const v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse KEY=value literals from `.env.example`-style content.
 * Skips comments, blank keys, empty values, and documentation placeholders
 * for secret-shaped keys.
 */
export function parseEnvExampleLiterals(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = unquote(trimmed.slice(eq + 1));
    if (!isUsableExampleLiteral(key, value)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Config values that carry no secret but appear constantly in build output. Blanking these does
 * not protect anything and actively destroys the log — redacting `false` turns a real
 * `Type 'true' is not assignable to type 'false'` into `type [REDACTED]`.
 */
const NEVER_REDACT = new Set([
  "true",
  "false",
  "development",
  "production",
  "staging",
  "test",
  "local",
  "localhost",
  "debug",
  "info",
  "warn",
  "error",
  "silent",
  "none",
  "null",
  "undefined",
]);

/** Below this, a value is far likelier to be a common word than a credential. */
const MIN_REDACTABLE_LENGTH = 8;

/**
 * The subset of merged env values worth scrubbing from sandbox logs.
 *
 * Redacting every value is not the safe default it looks like: `.env.example` is committed to the
 * repository, and synthesized placeholders are constants this code invented, so blanking them
 * protects nothing while corrupting the output users rely on to debug a failed build.
 *
 * - `user`   — supplied privately, so treat as secret unless it is a well-known config word.
 * - `example`— public already; redact only when long enough to plausibly be a real credential
 *              someone committed by mistake.
 * - `synthesized` — ours; only the deterministic secret placeholder is worth masking, never the
 *              generic constants (`false`, the `.invalid` URLs, the local postgres string).
 */
export function redactableEnvValues(entries: Record<string, MergedEnvEntry>): string[] {
  const out = new Set<string>();
  for (const { value, source } of Object.values(entries)) {
    const trimmed = value.trim();
    if (!trimmed || NEVER_REDACT.has(trimmed.toLowerCase())) continue;
    if (source === "synthesized") {
      if (trimmed.startsWith("lr_placeholder_")) out.add(trimmed);
      continue;
    }
    if (source === "user" ? trimmed.length >= 4 : trimmed.length >= MIN_REDACTABLE_LENGTH) {
      out.add(trimmed);
    }
  }
  return [...out];
}

export function mergeEnvVars(opts: {
  keys: string[];
  userValues?: Record<string, string>;
  exampleValues?: Record<string, string>;
}): MergeEnvVarsResult {
  const userValues = opts.userValues ?? {};
  const exampleValues = opts.exampleValues ?? {};
  const entries: Record<string, MergedEnvEntry> = {};

  for (const key of opts.keys) {
    const userRaw = userValues[key];
    if (typeof userRaw === "string" && userRaw.trim() !== "") {
      entries[key] = { value: userRaw, source: "user" };
      continue;
    }
    const exampleRaw = exampleValues[key];
    if (typeof exampleRaw === "string" && isUsableExampleLiteral(key, exampleRaw)) {
      entries[key] = { value: exampleRaw.trim(), source: "example" };
      continue;
    }
    entries[key] = { value: synthesizePlaceholder(key), source: "synthesized" };
  }

  return {
    entries,
    valuesAsRecord: () => {
      const record: Record<string, string> = {};
      for (const [k, entry] of Object.entries(entries)) {
        record[k] = entry.value;
      }
      return record;
    },
  };
}
