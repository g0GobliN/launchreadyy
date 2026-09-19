/** Installation-wide feature definitions and shipped defaults. */

export const FEATURE_FLAG_DEFS = [
  {
    key: "flag_ai_fixes",
    label: "AI-generated fixes",
    description: "CI-ai, readme-ai, test scaffolds, and other AI fix generation.",
    defaultEnabled: true,
  },
  {
    key: "flag_playwright_ai",
    label: "Playwright E2E (AI)",
    description: "Playwright smoke tests only — other AI fixes can stay on.",
    defaultEnabled: true,
  },
  {
    key: "flag_code_auditor",
    label: "Code auditor",
    description: "Source-level checks during scan (Stripe webhooks, auth routes, etc.).",
    defaultEnabled: true,
  },
  {
    key: "flag_architecture_analysis",
    label: "Architecture analysis",
    description: "Import-graph structural audit.",
    defaultEnabled: true,
  },
  {
    key: "flag_sandbox_verify",
    label: "Sandbox verification",
    description: "Ephemeral install/build/lint verification in an isolated sandbox.",
    // A passed run is reused for the same commit, so enabling this cannot run away.
    // With no E2B_API_KEY it skips cleanly.
    defaultEnabled: true,
  },
  {
    key: "flag_semantic_scanner",
    label: "Semantic scanner (AST)",
    description:
      "Query an AST instead of regex for supported rules (v2 Phase 1). Falls back to regex when no parser is available.",
    defaultEnabled: true,
  },
  {
    key: "flag_repo_knowledge_v2",
    label: "Repository knowledge engine",
    description:
      "Capture framework/runtime/tooling facts each scan and feed them to AI before it generates fixes (v2 Phase 2).",
    defaultEnabled: true,
  },
  {
    key: "flag_incremental_scan",
    label: "Incremental scanning",
    description:
      "Rescan only files that changed since the last scan; carry forward unaffected findings (v2 Phase 3).",
    defaultEnabled: true,
  },
  {
    key: "flag_dependency_graph",
    label: "Dependency graph",
    description:
      "Build a cross-file import/route/service graph for cross-file reasoning and impact analysis (v2 Phase 4).",
    defaultEnabled: true,
  },
  {
    key: "flag_rust_indexer",
    label: "Rust/WASM indexer",
    description:
      "Accelerate file indexing/hashing, AST import extraction, and unsafe-call detection with a Rust binary (sandbox) or WASM (worker). Falls back to the TS reference impl (v2 Phase 5).",
    // Stays off: the only wired path is the stdin/stdout JSON bridge, which benchmarked *slower*
    // than the TS reference (315ms vs 192ms — rust/README.md). Rust wins only in disk-walk mode,
    // which nothing calls. Turning this on trades speed away for nothing.
    defaultEnabled: false,
  },
  {
    key: "flag_multi_agent_ai",
    label: "Multi-agent AI fixes",
    description:
      "Planner → Security Reviewer → Code Generator → Test Writer → PR Reviewer → Synthesizer pipeline (v2 Phase 8).",
    // Stays off: six AI roles per fix multiplies token spend; optional after live AI + GitHub validation.
    defaultEnabled: false,
  },
  {
    key: "flag_intelligent_sandbox",
    label: "Intelligent sandbox",
    description:
      "Learn required env vars/services from run signatures and prime future runs from cached facts (v2 Phase 9).",
    defaultEnabled: true,
  },
  {
    key: "flag_repo_learning",
    label: "Repository learning",
    description:
      "Learn from dismissed/accepted findings and user overrides; adapt future ranking and AI context (v2 Phase 10).",
    defaultEnabled: true,
  },
  {
    key: "flag_repo_monitoring",
    label: "Scheduled repo monitoring",
    description:
      "Re-scan connected repos on their cadence while the app is running and surface regressions on the dashboard.",
    // On by default. A head-SHA check skips unchanged repos, and each repo monitor
    // is opted out entirely until the operator enables it in Settings.
    defaultEnabled: true,
  },
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_DEFS)[number]["key"];

export const FEATURE_FLAG_KEYS = FEATURE_FLAG_DEFS.map((d) => d.key) as FeatureFlagKey[];

export function isFeatureFlagKey(key: string): key is FeatureFlagKey {
  return (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
}

export function defaultFeatureFlags(): Record<FeatureFlagKey, boolean> {
  return Object.fromEntries(FEATURE_FLAG_DEFS.map((d) => [d.key, d.defaultEnabled])) as Record<
    FeatureFlagKey,
    boolean
  >;
}

export function parseFeatureFlagValue(
  key: FeatureFlagKey,
  raw: string | undefined | null,
): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const def = FEATURE_FLAG_DEFS.find((d) => d.key === key);
  return def?.defaultEnabled ?? true;
}
