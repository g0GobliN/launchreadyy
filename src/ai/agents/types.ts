/**
 * Multi-agent fix pipeline types (v2 Phase 8). An orchestrator *above* the existing `route()` — each
 * agent is a typed step that calls an injected `generate` fn (which wraps the router in production,
 * or a stub in tests), consumes prior outputs, and emits structured JSON. Reasoning is recorded per
 * step for auditability.
 *
 * @see docs/README.md  (Phase 8)
 */

/** The issue the pipeline is trying to fix. */
export interface AgentIssueInput {
  title: string;
  category: string;
  severity: string;
  description: string;
  filePath?: string;
}

/** Injected text generator — wraps `route()` in production; deterministic stub in tests. */
export type GenerateFn = (prompt: string) => Promise<string>;

export interface AgentContext {
  generate: GenerateFn;
  /** Repository-knowledge block (Phase 2) injected so every agent shares proven facts. */
  repoKnowledge?: string;
}

export interface FixPlan {
  summary: string;
  steps: string[];
  files: string[];
}

export interface SecurityRisk {
  severity: "high" | "medium" | "low";
  note: string;
}

export interface SecurityReview {
  risks: SecurityRisk[];
  approved: boolean;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GeneratedCode {
  files: GeneratedFile[];
  notes?: string;
}

export interface GeneratedTests {
  files: GeneratedFile[];
}

export interface PrReview {
  approved: boolean;
  comments: string[];
}

export interface Synthesis {
  title: string;
  body: string;
}

/** One recorded step: which agent ran, the raw model text, and whether parsing succeeded. */
export interface ReasoningStep {
  agent: string;
  raw: string;
  ok: boolean;
}

/** The full pipeline result — structured outputs plus the reasoning trail. */
export interface AgentRunResult {
  plan?: FixPlan;
  securityReview?: SecurityReview;
  code?: GeneratedCode;
  tests?: GeneratedTests;
  prReview?: PrReview;
  synthesis?: Synthesis;
  reasoning: ReasoningStep[];
  /** Populated if the pipeline halted early. */
  error?: string;
  /** How many code-generation revisions the PR reviewer triggered. */
  revisions: number;
}
