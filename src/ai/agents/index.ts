/**
 * Multi-agent AI fix pipeline — public façade (v2 Phase 8). Gated by `flag_multi_agent_ai` at the
 * call site; when off, the existing single-shot fix path runs unchanged.
 *
 * @see docs/README.md  (Phase 8)
 */

export type {
  AgentContext,
  AgentIssueInput,
  AgentRunResult,
  FixPlan,
  GeneratedCode,
  GeneratedTests,
  GenerateFn,
  PrReview,
  ReasoningStep,
  SecurityReview,
  Synthesis,
} from "./types";
export { parseAgentJson } from "./json";
export { runAgentPipeline } from "./pipeline";
export {
  codeGeneratorAgent,
  plannerAgent,
  prReviewerAgent,
  securityReviewerAgent,
  synthesizerAgent,
  testWriterAgent,
} from "./agents";
