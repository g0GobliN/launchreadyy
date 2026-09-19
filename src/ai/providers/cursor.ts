import type { AIProvider } from "../types";

const CURSOR_API = "https://api.cursor.com/v1";
const DEFAULT_MODEL = "composer-2.5";
const POLL_MS = 3_000;
const MAX_WAIT_MS = 180_000;

function buildModel(modelId: string): Record<string, unknown> {
  const model: Record<string, unknown> = { id: modelId };
  if (modelId.startsWith("composer")) {
    model.params = [{ id: "fast", value: "true" }];
  }
  return model;
}

type RunStatus = "CREATING" | "RUNNING" | "FINISHED" | "ERROR" | "CANCELLED" | "EXPIRED";

interface CreateAgentResponse {
  agent: { id: string };
  run: { id: string };
}

interface RunResponse {
  status: RunStatus;
  result?: string;
}

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : trimmed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cursor Cloud Agents API — accessed over HTTP without a local SDK.
// Set AI_PROVIDER=cursor and CURSOR_API_KEY from cursor.com/dashboard → Integrations.
export class CursorProvider implements AIProvider {
  constructor(private readonly apiKey: string) {}

  async generate(
    prompt: string,
    _maxTokens = 2048,
    repoUrl?: string,
    _model?: string,
  ): Promise<string> {
    return this.call(prompt, repoUrl);
  }

  async analyze(
    prompt: string,
    _maxTokens = 1024,
    repoUrl?: string,
    _model?: string,
  ): Promise<string> {
    return this.call(prompt, repoUrl);
  }

  private headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async call(prompt: string, repoUrl?: string): Promise<string> {
    const modelId = process.env.CURSOR_MODEL ?? DEFAULT_MODEL;

    const body: Record<string, unknown> = {
      prompt: { text: prompt },
      model: buildModel(modelId),
      autoCreatePR: false,
      skipReviewerRequest: true,
    };
    if (repoUrl) body.repos = [{ url: repoUrl }];

    const createRes = await fetch(`${CURSOR_API}/agents`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      throw new Error(`Cursor API error ${createRes.status}: ${body}`);
    }

    const { agent, run } = (await createRes.json()) as CreateAgentResponse;
    const text = await this.pollRun(agent.id, run.id);
    return stripMarkdownFences(text);
  }

  private async pollRun(agentId: string, runId: string): Promise<string> {
    const deadline = Date.now() + MAX_WAIT_MS;

    while (Date.now() < deadline) {
      const res = await fetch(`${CURSOR_API}/agents/${agentId}/runs/${runId}`, {
        headers: this.headers(),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Cursor run poll error ${res.status}: ${body}`);
      }

      const run = (await res.json()) as RunResponse;

      if (run.status === "FINISHED") {
        if (!run.result?.trim()) {
          throw new Error("Cursor agent finished without a result.");
        }
        return run.result;
      }

      if (run.status === "ERROR" || run.status === "CANCELLED" || run.status === "EXPIRED") {
        throw new Error(`Cursor agent run ${run.status}: ${run.result ?? "no details"}`);
      }

      await sleep(POLL_MS);
    }

    throw new Error("Cursor agent run timed out after 3 minutes.");
  }
}
