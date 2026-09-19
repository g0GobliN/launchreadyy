import type { AIProvider, AIUsageSink, RouterContext, TaskType } from "./types";
import { clampAiMaxTokens } from "./max-tokens";
import { DeepSeekProvider } from "./providers/deepseek";
import { ClaudeProvider } from "./providers/claude";
import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { CursorProvider } from "./providers/cursor";
import { ensureAiProviderCache, getConfiguredAiProvider } from "./provider-config.server";

// ─── Provider singletons ──────────────────────────────────────────────────────

let _deepseek: DeepSeekProvider | null = null;
let _claude: ClaudeProvider | null = null;
let _openai: OpenAIProvider | null = null;
let _gemini: GeminiProvider | null = null;
let _cursor: CursorProvider | null = null;

function getProvider(name: string): AIProvider {
  switch (name) {
    case "deepseek": {
      const key = process.env.DEEPSEEK_API_KEY;
      if (!key) throw new Error("DEEPSEEK_API_KEY is not set in your .env file.");
      return (_deepseek ??= new DeepSeekProvider(key));
    }
    case "claude": {
      const key = process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY;
      if (!key) {
        throw new Error("CLAUDE_API_KEY (or ANTHROPIC_API_KEY) is not set in your .env file.");
      }
      return (_claude ??= new ClaudeProvider(key));
    }
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is not set in your .env file.");
      return (_openai ??= new OpenAIProvider(key));
    }
    case "gemini": {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY is not set in your .env file.");
      return (_gemini ??= new GeminiProvider(key));
    }
    case "cursor": {
      const key = process.env.CURSOR_API_KEY;
      if (!key) throw new Error("CURSOR_API_KEY is not set in your .env file.");
      return (_cursor ??= new CursorProvider(key));
    }
    default:
      throw new Error(
        `Unknown AI provider: "${name}". Valid options: deepseek, claude, openai, gemini, cursor.`,
      );
  }
}

// ─── Task → provider routing ──────────────────────────────────────────────────

const FAST_GENERATION_TASKS = new Set<TaskType>([
  "vitest_generation",
  "playwright_generation",
  "api_test_generation",
  "readme_improvements",
  "ci_generation",
  "env_example_generation",
  "fix_recovery",
]);

// Tasks where Haiku/V3-chat is sufficient — structured short outputs, no reasoning required.
// ci_generation is intentionally NOT here: the CI prompt is the largest and most instruction-dense
// prompt we have, and getting the job graph wrong produces a broken workflow file.
const DEEP_ANALYSIS_TASKS = new Set<TaskType>([
  "architecture_analysis",
  "refactoring_suggestions",
  "security_deep_analysis",
]);

const SIMPLE_FILL_TASKS = new Set<TaskType>([
  "readme_improvements",
  "env_example_generation",
  "fix_recovery",
  "security_explanation",
]);

// Tasks that need strong code generation — routed to R1 on DeepSeek, Sonnet on Claude.
const DEEP_CODE_TASKS = new Set<TaskType>([
  "vitest_generation",
  "playwright_generation",
  "api_test_generation",
  "ci_generation",
  "code",
]);

const HAIKU_MODEL = process.env.CLAUDE_FAST_MODEL ?? "claude-haiku-4-5-20251001";
const SONNET_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";
const OPUS_MODEL = process.env.CLAUDE_OPUS_MODEL ?? "claude-opus-4-8";

const DEEPSEEK_CHAT_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
const DEEPSEEK_REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-reasoner";

function hasProviderKey(name: string): boolean {
  switch (name) {
    case "deepseek":
      return Boolean(process.env.DEEPSEEK_API_KEY);
    case "claude":
      return Boolean(process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY);
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY);
    case "gemini":
      return Boolean(process.env.GEMINI_API_KEY);
    case "cursor":
      return Boolean(process.env.CURSOR_API_KEY);
    default:
      return false;
  }
}

// Cloud Agents need minutes to boot; chat APIs finish test generation in seconds.
function fastGenerationProvider(): string {
  if (hasProviderKey("claude")) return "claude";
  if (hasProviderKey("deepseek")) return "deepseek";
  if (hasProviderKey("openai")) return "openai";
  throw new Error(
    "AI test generation needs a chat provider (Claude/DeepSeek/OpenAI). " +
      "Set ANTHROPIC_API_KEY or DEEPSEEK_API_KEY.",
  );
}

export function selectProviderName(ctx: RouterContext): string {
  const configured = getConfiguredAiProvider();

  // Cursor Cloud Agents need minutes to boot — too slow for fast-generation tasks that need a
  // synchronous chat-API response in seconds, so use whichever chat provider has a key instead.
  // This is the only case where the configured provider is overridden; every other task type
  // and every other configured provider is respected as set.
  if (configured === "cursor" && FAST_GENERATION_TASKS.has(ctx.taskType)) {
    return fastGenerationProvider();
  }

  return configured;
}

export function selectModel(providerName: string, taskType: TaskType): string | undefined {
  if (providerName === "claude") {
    if (SIMPLE_FILL_TASKS.has(taskType)) return HAIKU_MODEL;
    if (DEEP_ANALYSIS_TASKS.has(taskType)) return OPUS_MODEL;
    return SONNET_MODEL;
  }
  if (providerName === "deepseek") {
    return DEEP_ANALYSIS_TASKS.has(taskType) ? DEEPSEEK_REASONER_MODEL : DEEPSEEK_CHAT_MODEL;
  }
  return undefined;
}

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Bounded LRU-ish: Map preserves insertion order, so the oldest entry is always
// first. Without a cap this grows unbounded — harmless on short-lived processes
// isolates, but a slow leak under a long-lived Node process (dev, self-hosting).
const RESPONSE_CACHE_MAX = 500;
const responseCache = new Map<string, string>();

function cacheSet(key: string, value: string): void {
  // Refresh recency: delete-then-set moves an existing key to the newest slot.
  if (responseCache.has(key)) responseCache.delete(key);
  responseCache.set(key, value);
  while (responseCache.size > RESPONSE_CACHE_MAX) {
    const oldest = responseCache.keys().next().value;
    if (oldest === undefined) break;
    responseCache.delete(oldest);
  }
}

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function buildCacheKey(
  providerName: string,
  method: string,
  prompt: string,
  model?: string,
): string {
  return `${providerName}:${model ?? "default"}:${method}:${djb2(prompt)}`;
}

// ─── Public router ────────────────────────────────────────────────────────────

export type RouterMethod = "generate" | "analyze";

/**
 * Ordered providers to try for a request. Primary first; never silently bills
 * OpenAI/Gemini when the live config is deepseek/claude/cursor.
 */
export function fallbackProvidersFor(primary: string): string[] {
  const configured = getConfiguredAiProvider();
  const allowedFallbacks =
    configured === "openai" || configured === "gemini"
      ? ["openai", "gemini", "deepseek", "claude"]
      : ["deepseek", "claude"];
  const order: string[] = [primary];
  for (const name of allowedFallbacks) {
    if (name !== primary && hasProviderKey(name)) order.push(name);
  }
  return order;
}

export async function route(
  ctx: RouterContext,
  method: RouterMethod,
  prompt: string,
  maxTokens?: number,
  explicitCacheKey?: string,
  repoUrl?: string,
): Promise<string> {
  await ensureAiProviderCache();
  const providerName = selectProviderName(ctx);
  const model = selectModel(providerName, ctx.taskType);
  const cacheKey = explicitCacheKey ?? buildCacheKey(providerName, method, prompt, model);

  const cached = responseCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const tokens = clampAiMaxTokens(maxTokens);
  const fallbackOrder = fallbackProvidersFor(providerName);

  let lastErr: unknown;
  for (const name of fallbackOrder) {
    try {
      const provider = getProvider(name);
      const fallbackModel = name === providerName ? model : selectModel(name, ctx.taskType);
      const sink: AIUsageSink = {};
      const result =
        method === "analyze"
          ? await provider.analyze(prompt, tokens, repoUrl, fallbackModel, sink)
          : await provider.generate(prompt, tokens, repoUrl, fallbackModel, sink);

      // Only calls that actually reached a provider are recorded — a cache hit returns above
      // and costs nothing, and a failed attempt falls through to the catch without a sink.
      if (sink.usage) {
        const { recordAiUsage } = await import("../lib/ai-usage.server");
        await recordAiUsage({
          usage: sink.usage,
          provider: name,
          taskType: ctx.taskType,
          method,
          githubLogin: ctx.githubLogin,
        });
      }

      if (name !== providerName) {
        console.warn(
          `[ai-router] primary provider "${providerName}" failed, used fallback "${name}"`,
        );
      }
      // Don't cache empty/blank results — a provider occasionally returns nothing for a prompt
      // it would answer fine on retry (seen on reasoning-model routes), and caching that means
      // every subsequent identical-prompt call (including a user's "try again") gets the same
      // blank result back instead of a fresh attempt.
      if (result.trim()) cacheSet(cacheKey, result);
      return result;
    } catch (err) {
      lastErr = err;
      console.error(
        `[ai-router] provider "${name}" failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  throw lastErr ?? new Error("All AI providers failed");
}
