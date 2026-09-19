/**
 * Intelligent sandbox learning (v2 Phase 9). Read a sandbox run's log/output and infer what the
 * project actually needs — backing services (Postgres, Redis, …) and required env vars — from real
 * failure signatures, then build a priming plan so the *next* run starts closer to green. Pure and
 * deterministic; persisting the results as tier-1 (observed) knowledge facts happens at the call site.
 *
 * @see docs/README.md  (Phase 9)
 */

export interface RequiredService {
  service: string;
  port?: number;
  evidence: string;
}

export interface RequiredEnvVar {
  name: string;
  evidence: string;
}

interface ServicePattern {
  service: string;
  port?: number;
  re: RegExp;
}

const SERVICE_PATTERNS: ServicePattern[] = [
  {
    service: "postgres",
    port: 5432,
    re: /(?::5432\b|postgres|password authentication failed for user|could not connect to server)/i,
  },
  { service: "redis", port: 6379, re: /(?::6379\b|redis)/i },
  { service: "mysql", port: 3306, re: /(?::3306\b|ER_ACCESS_DENIED_ERROR|mysql)/i },
  { service: "mongodb", port: 27017, re: /(?::27017\b|MongoNetworkError|mongodb)/i },
  { service: "elasticsearch", port: 9200, re: /(?::9200\b|elasticsearch)/i },
  { service: "rabbitmq", port: 5672, re: /(?::5672\b|amqp|rabbitmq)/i },
];

/** A connection-failure signature — services are only inferred from a real failure, not a mention. */
const CONNECTION_FAILURE =
  /(ECONNREFUSED|connection refused|ENOTFOUND|ETIMEDOUT|could not connect|MongoNetworkError|getaddrinfo)/i;

/** Detect backing services the project needs, from connection-failure lines in the run log. */
export function detectRequiredServices(log: string): RequiredService[] {
  const found = new Map<string, RequiredService>();
  for (const line of log.split("\n")) {
    if (!CONNECTION_FAILURE.test(line)) continue;
    for (const p of SERVICE_PATTERNS) {
      if (p.re.test(line) && !found.has(p.service)) {
        found.set(p.service, {
          service: p.service,
          port: p.port,
          evidence: line.trim().slice(0, 200),
        });
      }
    }
  }
  return [...found.values()];
}

const ENV_PATTERNS: RegExp[] = [
  /missing (?:required )?env(?:ironment)? variable[:\s]+["'`]?([A-Z][A-Z0-9_]{2,})/i,
  /environment variable ["'`]?([A-Z][A-Z0-9_]{2,})["'`]? is (?:required|not set|missing|undefined)/i,
  /process\.env\.([A-Z][A-Z0-9_]{2,}) is (?:undefined|not defined|required)/,
  /please (?:define|set) (?:the )?["'`]?([A-Z][A-Z0-9_]{2,})["'`]? (?:environment variable|env)/i,
  /([A-Z][A-Z0-9_]{2,}) is not defined in (?:process\.)?env/i,
];

/** Detect required env var names from "missing/undefined env" signatures. */
export function detectRequiredEnvVars(log: string): RequiredEnvVar[] {
  const found = new Map<string, RequiredEnvVar>();
  for (const line of log.split("\n")) {
    for (const re of ENV_PATTERNS) {
      const m = re.exec(line);
      if (m && m[1] && !found.has(m[1])) {
        found.set(m[1], { name: m[1], evidence: line.trim().slice(0, 200) });
      }
    }
  }
  return [...found.values()];
}

export interface PrimingPlan {
  /** Services to pre-provision before the next run. */
  services: string[];
  /** Env var names to pre-seed (names only — values come from `project_env_vars`). */
  envVarNames: string[];
}

/**
 * Combine detections (and any previously-known facts) into a plan for the next run. Union of what
 * was newly detected and what was already known, so knowledge only accumulates.
 */
export function buildPrimingPlan(input: {
  services: RequiredService[];
  envVars: RequiredEnvVar[];
  knownServices?: string[];
  knownEnvVarNames?: string[];
}): PrimingPlan {
  const services = new Set([
    ...(input.knownServices ?? []),
    ...input.services.map((s) => s.service),
  ]);
  const envVarNames = new Set([
    ...(input.knownEnvVarNames ?? []),
    ...input.envVars.map((e) => e.name),
  ]);
  return { services: [...services].sort(), envVarNames: [...envVarNames].sort() };
}
