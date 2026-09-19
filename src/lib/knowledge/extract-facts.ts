/**
 * Extract repository-knowledge facts from scan inputs (v2 Phase 2). Pure and deterministic: given
 * what the scanner already gathered, produce fact candidates to upsert. No evidence → no fact (the
 * knowledge model must never store guesses as if observed). Tiers follow the knowledge model: tier 2
 * = declared in a manifest/config, tier 3 = inferred from a dependency's presence.
 *
 * @see docs/README.md  (Phase 2)
 */

import { KNOWLEDGE_FACT_KEYS as K } from "./fact-keys";
import type { KnowledgeTier } from "../repo-knowledge.server";

export interface KnowledgeExtractionInput {
  framework: string;
  language: string;
  files: string[];
  /** Merged dependencies + devDependencies (name → version range). */
  deps: Record<string, string>;
  scripts: Record<string, string>;
  /** package.json `engines`, if present. */
  engines?: Record<string, string>;
  /** `.nvmrc` contents, if present. */
  nvmrc?: string | null;
  /** Dockerfile contents, if present. */
  dockerfile?: string | null;
}

export interface ExtractedFact {
  factKey: string;
  value: unknown;
  tier: KnowledgeTier;
  producer: string;
  evidenceRef?: string;
}

const PRODUCER = "scanner";

function has(deps: Record<string, string>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(deps, name);
}

function firstPresent(deps: Record<string, string>, names: string[]): string | undefined {
  return names.find((n) => has(deps, n));
}

function detectPackageManager(files: string[]): { value: string; evidence: string } | null {
  if (files.includes("bun.lockb") || files.includes("bun.lock"))
    return { value: "bun", evidence: "bun.lockb" };
  if (files.includes("pnpm-lock.yaml")) return { value: "pnpm", evidence: "pnpm-lock.yaml" };
  if (files.includes("yarn.lock")) return { value: "yarn", evidence: "yarn.lock" };
  if (files.includes("package-lock.json")) return { value: "npm", evidence: "package-lock.json" };
  return null;
}

function detectCiProvider(files: string[]): { value: string; evidence: string } | null {
  if (files.some((f) => f.startsWith(".github/workflows/")))
    return { value: "github-actions", evidence: ".github/workflows" };
  if (files.includes(".gitlab-ci.yml")) return { value: "gitlab-ci", evidence: ".gitlab-ci.yml" };
  if (files.includes(".circleci/config.yml"))
    return { value: "circleci", evidence: ".circleci/config.yml" };
  if (files.includes("azure-pipelines.yml"))
    return { value: "azure-pipelines", evidence: "azure-pipelines.yml" };
  if (files.some((f) => f.startsWith(".buildkite/")))
    return { value: "buildkite", evidence: ".buildkite" };
  return null;
}

const DEPLOY_TARGETS: { file: string; value: string }[] = [
  { file: "vercel.json", value: "vercel" },
  { file: "netlify.toml", value: "netlify" },
  { file: "fly.toml", value: "fly.io" },
  { file: "render.yaml", value: "render" },
  { file: "wrangler.toml", value: "cloudflare" },
  { file: "railway.json", value: "railway" },
  { file: "app.yaml", value: "gcp-app-engine" },
];

const DB_DEPS: { dep: string; value: string }[] = [
  { dep: "pg", value: "postgres" },
  { dep: "postgres", value: "postgres" },
  { dep: "mysql2", value: "mysql" },
  { dep: "mysql", value: "mysql" },
  { dep: "mongodb", value: "mongodb" },
  { dep: "mongoose", value: "mongodb" },
  { dep: "redis", value: "redis" },
  { dep: "ioredis", value: "redis" },
  { dep: "@supabase/supabase-js", value: "supabase-postgres" },
  { dep: "better-sqlite3", value: "sqlite" },
];

const ORM_DEPS: { dep: string; value: string }[] = [
  { dep: "prisma", value: "prisma" },
  { dep: "@prisma/client", value: "prisma" },
  { dep: "drizzle-orm", value: "drizzle" },
  { dep: "typeorm", value: "typeorm" },
  { dep: "sequelize", value: "sequelize" },
  { dep: "mongoose", value: "mongoose" },
  { dep: "kysely", value: "kysely" },
];

const AUTH_DEPS: { dep: string; value: string }[] = [
  { dep: "next-auth", value: "next-auth" },
  { dep: "@auth/core", value: "authjs" },
  { dep: "@clerk/nextjs", value: "clerk" },
  { dep: "@clerk/clerk-react", value: "clerk" },
  { dep: "lucia", value: "lucia" },
  { dep: "passport", value: "passport" },
  { dep: "@supabase/ssr", value: "supabase-auth" },
  { dep: "firebase", value: "firebase-auth" },
];

/** Parse a Dockerfile's first `FROM` base image. */
function dockerBaseImage(dockerfile: string): string | null {
  for (const line of dockerfile.split("\n")) {
    const m = /^\s*FROM\s+(\S+)/i.exec(line);
    if (m) return m[1];
  }
  return null;
}

export function extractKnowledgeFacts(input: KnowledgeExtractionInput): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const add = (factKey: string, value: unknown, tier: KnowledgeTier, evidenceRef?: string) => {
    facts.push({ factKey, value, tier, producer: PRODUCER, evidenceRef });
  };

  if (input.framework && input.framework !== "unknown") {
    add(K.framework, input.framework, 2, "dependency/manifest detection");
  }
  if (input.language && input.language !== "unknown") {
    add(K.language, input.language, 2, "manifest detection");
  }

  const nodeVersion = input.engines?.node ?? input.nvmrc?.trim();
  if (nodeVersion) {
    add(K.nodeVersion, nodeVersion, 2, input.engines?.node ? "package.json engines" : ".nvmrc");
  }

  const pm = detectPackageManager(input.files);
  if (pm) add(K.packageManager, pm.value, 2, pm.evidence);

  if (input.scripts.build)
    add(K.buildCommand, input.scripts.build, 2, "package.json scripts.build");
  if (input.scripts.test) add(K.testCommand, input.scripts.test, 2, "package.json scripts.test");

  const testFw = firstPresent(input.deps, ["vitest", "jest", "mocha", "ava", "@playwright/test"]);
  if (testFw) add(K.testFramework, testFw, 2, `dependency ${testFw}`);

  const lint = firstPresent(input.deps, ["eslint", "@biomejs/biome", "oxlint"]);
  if (lint) add(K.lintTools, lint, 2, `dependency ${lint}`);

  const fmt = firstPresent(input.deps, ["prettier", "@biomejs/biome", "dprint"]);
  if (fmt) add(K.formatter, fmt, 2, `dependency ${fmt}`);

  const ci = detectCiProvider(input.files);
  if (ci) add(K.ciProvider, ci.value, 2, ci.evidence);

  const deploy = DEPLOY_TARGETS.find((t) => input.files.includes(t.file));
  if (deploy) {
    add(K.deploymentTarget, deploy.value, 2, deploy.file);
    add(K.hostingProvider, deploy.value, 3, deploy.file);
  }

  if (input.dockerfile) {
    const image = dockerBaseImage(input.dockerfile);
    if (image) add(K.dockerImage, image, 2, "Dockerfile FROM");
  }

  const db = DB_DEPS.find((d) => has(input.deps, d.dep));
  if (db) add(K.database, db.value, 3, `dependency ${db.dep}`);

  const orm = ORM_DEPS.find((d) => has(input.deps, d.dep));
  if (orm) add(K.orm, orm.value, 3, `dependency ${orm.dep}`);

  const auth = AUTH_DEPS.find((d) => has(input.deps, d.dep));
  if (auth) add(K.authProvider, auth.value, 3, `dependency ${auth.dep}`);

  return facts;
}
