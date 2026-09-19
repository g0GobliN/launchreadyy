import { AI_TEMPERATURE, supportsTemperature } from "../temperature";
import type { AIProvider, AIUsageSink } from "../types";

// DeepSeek exposes an OpenAI-compatible REST API.
// deepseek-chat    → DeepSeek-V3 (fast, general purpose)
// deepseek-reasoner → DeepSeek-R1 (chain-of-thought, used for deep analysis)
const DEFAULT_MODEL = "deepseek-chat";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** Bound a single provider call. These fetches had no AbortSignal at all, so a stalled
 * provider was only ever capped by the job's own 4.5 min budget — and that race does not
 * cancel the request, it just stops waiting. The user watched a spinner the whole time.
 * 100s leaves room for the router to fall back to a second provider inside that budget. */
const REQUEST_TIMEOUT_MS = 100_000;

const SYSTEM_PROMPT =
  "You are an expert software engineer. When asked to generate a file (YAML, Markdown, TypeScript, etc.), " +
  "return ONLY the file content — no markdown code fences, no preamble, no explanation — unless the " +
  "prompt explicitly asks for one. Follow the output path and format specified in each prompt exactly.";

export class DeepSeekProvider implements AIProvider {
  constructor(private readonly apiKey: string) {}

  async generate(
    prompt: string,
    maxTokens = 2048,
    _repoUrl?: string,
    model?: string,
    sink?: AIUsageSink,
  ): Promise<string> {
    return this.call(prompt, maxTokens, model, sink);
  }

  async analyze(
    prompt: string,
    maxTokens = 1024,
    _repoUrl?: string,
    model?: string,
    sink?: AIUsageSink,
  ): Promise<string> {
    return this.call(prompt, maxTokens, model, sink);
  }

  private async call(
    prompt: string,
    maxTokens: number,
    modelOverride?: string,
    sink?: AIUsageSink,
  ): Promise<string> {
    const model = modelOverride ?? process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(supportsTemperature(model) ? { temperature: AI_TEMPERATURE } : {}),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`DeepSeek API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_cache_hit_tokens?: number;
      };
    };
    if (sink && data.usage) {
      sink.usage = {
        model,
        inputTokens: data.usage.prompt_tokens ?? 0,
        outputTokens: data.usage.completion_tokens ?? 0,
        cachedInputTokens: data.usage.prompt_cache_hit_tokens,
      };
    }
    return data.choices[0]?.message?.content?.trim() ?? "";
  }
}
