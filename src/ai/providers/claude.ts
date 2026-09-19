import { AI_TEMPERATURE, supportsTemperature } from "../temperature";
import type { AIProvider, AIUsageSink } from "../types";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

/** Bound a single provider call. These fetches had no AbortSignal at all, so a stalled
 * provider was only ever capped by the job's own 4.5 min budget — and that race does not
 * cancel the request, it just stops waiting. The user watched a spinner the whole time.
 * 100s leaves room for the router to fall back to a second provider inside that budget. */
const REQUEST_TIMEOUT_MS = 100_000;

// Reinforces the output-format rules that every prompt already states inline.
// Putting them here (system field) makes Claude follow them more reliably than
// embedding them only in the user message.
const SYSTEM_PROMPT =
  "You are an expert software engineer. When asked to generate a file (YAML, Markdown, TypeScript, etc.), " +
  "return ONLY the file content — no markdown code fences, no preamble, no explanation — unless the " +
  "prompt explicitly asks for one. Follow the output path and format specified in each prompt exactly.";

// Set AI_PROVIDER=claude and CLAUDE_API_KEY (or ANTHROPIC_API_KEY) in your .env.
export class ClaudeProvider implements AIProvider {
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
    const model = modelOverride ?? process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(supportsTemperature(model) ? { temperature: AI_TEMPERATURE } : {}),
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Claude API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };

    if (sink && data.usage) {
      // Anthropic reports cache reads separately from `input_tokens`, so add them back to get
      // the true prompt size — otherwise a well-cached prompt looks like it shrank.
      const cached = data.usage.cache_read_input_tokens ?? 0;
      sink.usage = {
        model,
        inputTokens: (data.usage.input_tokens ?? 0) + cached,
        outputTokens: data.usage.output_tokens ?? 0,
        cachedInputTokens: cached || undefined,
      };
    }

    return data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
  }
}
