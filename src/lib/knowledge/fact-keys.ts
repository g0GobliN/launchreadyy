/**
 * Canonical repository-knowledge fact keys (v2 Phase 2). One place so producers (scanner, sandbox,
 * fix executor, user actions) and the AI consumer agree on names. Values are stored in
 * `repo_knowledge_facts` via `upsertKnowledgeFact`.
 *
 * @see docs/README.md  (Phase 2)
 * @see src/lib/repo-knowledge.server.ts
 */

export const KNOWLEDGE_FACT_KEYS = {
  framework: "framework",
  language: "language",
  runtime: "runtime",
  nodeVersion: "node-version",
  packageManager: "package-manager",
  dockerImage: "docker-image",
  buildCommand: "build-command",
  testCommand: "test-command",
  deploymentTarget: "deployment-target",
  ciProvider: "ci-provider",
  lintTools: "lint-tools",
  formatter: "formatter",
  database: "database",
  orm: "orm",
  authProvider: "auth-provider",
  cloudProvider: "cloud-provider",
  hostingProvider: "hosting-provider",
  testFramework: "test-framework",
  directoryConventions: "directory-conventions",
  apiStyle: "api-style",
  codingConventions: "coding-conventions",
  preferredImports: "preferred-imports",
  historicalFixes: "historical-fixes",
  aiPreferences: "ai-preferences",
} as const;

export type KnowledgeFactKey = (typeof KNOWLEDGE_FACT_KEYS)[keyof typeof KNOWLEDGE_FACT_KEYS];

/** Human-friendly labels for prompt/UI rendering. */
export const KNOWLEDGE_FACT_LABELS: Record<string, string> = {
  framework: "Framework",
  language: "Language",
  runtime: "Runtime",
  "node-version": "Node version",
  "package-manager": "Package manager",
  "docker-image": "Docker base image",
  "build-command": "Build command",
  "test-command": "Test command",
  "deployment-target": "Deployment target",
  "ci-provider": "CI provider",
  "lint-tools": "Lint tools",
  formatter: "Formatter",
  database: "Database",
  orm: "ORM",
  "auth-provider": "Auth provider",
  "cloud-provider": "Cloud provider",
  "hosting-provider": "Hosting provider",
  "test-framework": "Test framework",
  "directory-conventions": "Directory conventions",
  "api-style": "API style",
  "coding-conventions": "Coding conventions",
  "preferred-imports": "Preferred imports",
  "historical-fixes": "Historical fixes",
  "ai-preferences": "AI preferences",
};
