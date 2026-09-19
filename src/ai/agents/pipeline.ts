/**
 * Multi-agent orchestration (v2 Phase 8). Runs the six agents in sequence, threading each structured
 * output into the next, recording reasoning, and running one bounded code-generation revision if the
 * PR reviewer rejects. Halts gracefully (with `error`) if any agent returns unparseable output — the
 * caller can fall back to the existing single-shot fix path.
 *
 * @see docs/README.md  (Phase 8)
 */

import {
  codeGeneratorAgent,
  plannerAgent,
  prReviewerAgent,
  securityReviewerAgent,
  synthesizerAgent,
  testWriterAgent,
  type AgentOutput,
} from "./agents";
import type { AgentContext, AgentIssueInput, AgentRunResult, ReasoningStep } from "./types";

const MAX_REVISIONS = 1;

/** Thrown when an agent returns unparseable output; caught to halt the pipeline gracefully. */
class HaltError extends Error {
  constructor(readonly agent: string) {
    super(agent);
  }
}

export async function runAgentPipeline(
  issue: AgentIssueInput,
  ctx: AgentContext,
): Promise<AgentRunResult> {
  const reasoning: ReasoningStep[] = [];
  const result: AgentRunResult = { reasoning, revisions: 0 };

  /** Record the step, returning the parsed value or halting if it's null. */
  const need = <T>(agent: string, out: AgentOutput<T>): T => {
    reasoning.push({ agent, raw: out.raw, ok: out.value !== null });
    if (out.value === null) throw new HaltError(agent);
    return out.value;
  };

  try {
    const plan = need("planner", await plannerAgent(issue, ctx));
    result.plan = plan;

    const review = need("security-reviewer", await securityReviewerAgent(plan, ctx));
    result.securityReview = review;

    let code = need("code-generator", await codeGeneratorAgent(plan, review, ctx));
    result.code = code;

    let tests = need("test-writer", await testWriterAgent(code, ctx));
    result.tests = tests;

    let prReview = need("pr-reviewer", await prReviewerAgent(code, tests, ctx));

    // Bounded revision loop: reviewer rejects → regenerate once with its comments, re-test, re-review.
    while (!prReview.approved && result.revisions < MAX_REVISIONS) {
      result.revisions++;
      code = need("code-generator", await codeGeneratorAgent(plan, review, ctx, prReview.comments));
      result.code = code;

      tests = need("test-writer", await testWriterAgent(code, ctx));
      result.tests = tests;

      prReview = need("pr-reviewer", await prReviewerAgent(code, tests, ctx));
    }
    result.prReview = prReview;

    const synthesis = need("synthesizer", await synthesizerAgent(issue, plan, code, ctx));
    result.synthesis = synthesis;
  } catch (err) {
    if (err instanceof HaltError) {
      result.error = `${err.agent} returned no parseable output`;
    } else {
      throw err;
    }
  }

  return result;
}
