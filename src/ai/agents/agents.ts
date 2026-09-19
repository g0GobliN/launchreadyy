/**
 * The six specialized agents (v2 Phase 8): Planner → Security Reviewer → Code Generator → Test
 * Writer → PR Reviewer → Synthesizer. Each builds a prompt (with shared repo knowledge + prior
 * outputs), calls the injected generator, and parses structured JSON.
 *
 * @see docs/README.md  (Phase 8)
 */

import { parseAgentJson } from "./json";
import type {
  AgentContext,
  AgentIssueInput,
  FixPlan,
  GeneratedCode,
  GeneratedTests,
  PrReview,
  SecurityReview,
  Synthesis,
} from "./types";

export interface AgentOutput<T> {
  value: T | null;
  raw: string;
}

function knowledgeBlock(ctx: AgentContext): string {
  return ctx.repoKnowledge ? `\n\n${ctx.repoKnowledge}\n` : "";
}

async function callJson<T>(ctx: AgentContext, prompt: string): Promise<AgentOutput<T>> {
  const raw = await ctx.generate(prompt);
  return { value: parseAgentJson<T>(raw), raw };
}

export function plannerAgent(
  issue: AgentIssueInput,
  ctx: AgentContext,
): Promise<AgentOutput<FixPlan>> {
  const prompt = `You are the Planner. Produce a change plan for this issue as JSON matching
{"summary": string, "steps": string[], "files": string[]}.${knowledgeBlock(ctx)}

Issue: ${issue.title} [${issue.category}/${issue.severity}]
${issue.description}
${issue.filePath ? `Primary file: ${issue.filePath}` : ""}
Respond with ONLY the JSON.`;
  return callJson<FixPlan>(ctx, prompt);
}

export function securityReviewerAgent(
  plan: FixPlan,
  ctx: AgentContext,
): Promise<AgentOutput<SecurityReview>> {
  const prompt = `You are the Security Reviewer. Assess this plan for security risks. JSON only,
matching {"risks": [{"severity": "high"|"medium"|"low", "note": string}], "approved": boolean}.
Set approved=false if any high-severity risk is unaddressed.${knowledgeBlock(ctx)}

Plan: ${JSON.stringify(plan)}`;
  return callJson<SecurityReview>(ctx, prompt);
}

export function codeGeneratorAgent(
  plan: FixPlan,
  review: SecurityReview,
  ctx: AgentContext,
  reviseComments?: string[],
): Promise<AgentOutput<GeneratedCode>> {
  const revise = reviseComments?.length
    ? `\n\nAddress this reviewer feedback in the revision:\n- ${reviseComments.join("\n- ")}`
    : "";
  const prompt = `You are the Code Generator. Implement the plan honoring the security review. JSON
only, matching {"files": [{"path": string, "content": string}], "notes": string}.${knowledgeBlock(ctx)}

Plan: ${JSON.stringify(plan)}
Security review: ${JSON.stringify(review)}${revise}`;
  return callJson<GeneratedCode>(ctx, prompt);
}

export function testWriterAgent(
  code: GeneratedCode,
  ctx: AgentContext,
): Promise<AgentOutput<GeneratedTests>> {
  const prompt = `You are the Test Writer. Write tests covering the generated changes. JSON only,
matching {"files": [{"path": string, "content": string}]}.${knowledgeBlock(ctx)}

Changed files: ${code.files.map((f) => f.path).join(", ")}`;
  return callJson<GeneratedTests>(ctx, prompt);
}

export function prReviewerAgent(
  code: GeneratedCode,
  tests: GeneratedTests,
  ctx: AgentContext,
): Promise<AgentOutput<PrReview>> {
  const prompt = `You are the PR Reviewer. Review the diff + tests. JSON only, matching
{"approved": boolean, "comments": string[]}. Reject (approved=false) if changes are unsafe,
untested, or incomplete; list actionable comments.${knowledgeBlock(ctx)}

Files: ${code.files.map((f) => f.path).join(", ")}
Test files: ${tests.files.map((f) => f.path).join(", ")}`;
  return callJson<PrReview>(ctx, prompt);
}

export function synthesizerAgent(
  issue: AgentIssueInput,
  plan: FixPlan,
  code: GeneratedCode,
  ctx: AgentContext,
): Promise<AgentOutput<Synthesis>> {
  const prompt = `You are the Final Synthesizer. Write the PR title and body. JSON only, matching
{"title": string, "body": string}. The body explains what changed and why, and lists the files.

Issue: ${issue.title}
Plan summary: ${plan.summary}
Files: ${code.files.map((f) => f.path).join(", ")}`;
  return callJson<Synthesis>(ctx, prompt);
}
