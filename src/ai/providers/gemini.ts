import { AI_TEMPERATURE, supportsTemperature } from "../temperature";
import type { AIProvider, AIUsageSink } from "../types";

// Gemini exposes an OpenAI-compatible REST API.
// https://ai.google.dev/gemini-api/docs/openai
const DEFAULT_MODEL = "gemini-2.0-flash";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

const REQUEST_TIMEOUT_MS = 100_000;

const SYSTEM_PROMPT =
  "You are an expert software engineer. When asked to generate a file (YAML, Markdown, TypeScript, etc.), " +
  "return ONLY the file content — no markdown code fences, no preamble, no explanation — unless the " +
  "prompt explicitly asks for one. Follow the output path and format specified in each prompt exactly.";

// Set AI_PROVIDER=gemini and GEMINI_API_KEY in your .env to enable.
export class GeminiProvider implements AIProvider {
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
    const model = modelOverride ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
    const res = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
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
      throw new Error(`Gemini API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (sink && data.usage) {
      sink.usage = {
        model,
        inputTokens: data.usage.prompt_tokens ?? 0,
        outputTokens: data.usage.completion_tokens ?? 0,
      };
    }
    return data.choices[0]?.message?.content?.trim() ?? "";
  }
}
