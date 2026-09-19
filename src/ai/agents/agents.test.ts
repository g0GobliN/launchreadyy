import { describe, expect, it } from "vitest";
import { parseAgentJson } from "./json";
import { runAgentPipeline } from "./pipeline";
import type { AgentContext, AgentIssueInput, GenerateFn } from "./types";

const issue: AgentIssueInput = {
  title: "Missing auth on admin route",
  category: "Security",
  severity: "high",
  description: "The /admin route has no auth guard.",
  filePath: "src/routes/admin.ts",
};

/** Build a deterministic generator that returns canned JSON per agent, keyed off the role marker. */
function mockGenerator(overrides: Record<string, string> = {}): GenerateFn {
  const defaults: Record<string, string> = {
    Planner: '{"summary":"Add auth guard","steps":["wrap route"],"files":["src/routes/admin.ts"]}',
    "Security Reviewer": '{"risks":[],"approved":true}',
    "Code Generator":
      '```json\n{"files":[{"path":"src/routes/admin.ts","content":"guarded"}],"notes":"done"}\n```',
    "Test Writer": '{"files":[{"path":"src/routes/admin.test.ts","content":"test"}]}',
    "PR Reviewer": '{"approved":true,"comments":[]}',
    "Final Synthesizer": '{"title":"Fix admin auth","body":"Adds an auth guard."}',
  };
  const table = { ...defaults, ...overrides };
  return async (prompt: string) => {
    for (const [marker, response] of Object.entries(table)) {
      if (prompt.includes(`You are the ${marker}`)) return response;
    }
    return "{}";
  };
}

describe("parseAgentJson", () => {
  it("parses plain JSON, fenced JSON, and JSON embedded in prose", () => {
    expect(parseAgentJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(parseAgentJson<{ a: number }>('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseAgentJson<{ a: number }>('Sure! {"a":3} hope that helps')).toEqual({ a: 3 });
  });

  it("returns null for unparseable text", () => {
    expect(parseAgentJson("no json here")).toBeNull();
    expect(parseAgentJson("")).toBeNull();
  });
});

describe("runAgentPipeline", () => {
  it("runs all six agents and produces a synthesis with reasoning trail", async () => {
    const ctx: AgentContext = {
      generate: mockGenerator(),
      repoKnowledge: "## Known facts\n- Framework: TanStack",
    };
    const result = await runAgentPipeline(issue, ctx);

    expect(result.error).toBeUndefined();
    expect(result.plan?.summary).toBe("Add auth guard");
    expect(result.securityReview?.approved).toBe(true);
    expect(result.code?.files[0].path).toBe("src/routes/admin.ts");
    expect(result.tests?.files).toHaveLength(1);
    expect(result.prReview?.approved).toBe(true);
    expect(result.synthesis?.title).toBe("Fix admin auth");
    expect(result.revisions).toBe(0);
    expect(result.reasoning.map((r) => r.agent)).toEqual([
      "planner",
      "security-reviewer",
      "code-generator",
      "test-writer",
      "pr-reviewer",
      "synthesizer",
    ]);
  });

  it("passes the repo-knowledge block into agent prompts", async () => {
    const seen: string[] = [];
    const base = mockGenerator();
    const ctx: AgentContext = {
      repoKnowledge: "## Known facts\n- Database: postgres",
      generate: async (p) => {
        seen.push(p);
        return base(p);
      },
    };
    await runAgentPipeline(issue, ctx);
    expect(seen.some((p) => p.includes("Database: postgres"))).toBe(true);
  });

  it("runs one bounded revision when the PR reviewer rejects, then approves", async () => {
    let reviewCalls = 0;
    const ctx: AgentContext = {
      generate: async (prompt) => {
        if (prompt.includes("You are the PR Reviewer")) {
          reviewCalls++;
          return reviewCalls === 1
            ? '{"approved":false,"comments":["needs a test for the 401 case"]}'
            : '{"approved":true,"comments":[]}';
        }
        return mockGenerator()(prompt);
      },
    };
    const result = await runAgentPipeline(issue, ctx);
    expect(result.revisions).toBe(1);
    expect(result.prReview?.approved).toBe(true);
    // code-generator should appear twice in the reasoning trail (original + revision).
    expect(result.reasoning.filter((r) => r.agent === "code-generator")).toHaveLength(2);
  });

  it("halts gracefully when an agent returns unparseable output", async () => {
    const ctx: AgentContext = {
      generate: mockGenerator({ Planner: "I cannot help with that." }),
    };
    const result = await runAgentPipeline(issue, ctx);
    expect(result.error).toContain("planner");
    expect(result.plan).toBeUndefined();
    expect(result.reasoning[0].ok).toBe(false);
  });
});
