/**
 * AI integration adapter — business code should call through aiService,
 * not provider SDKs directly.
 */
export { aiService } from "../../ai";
export type { TaskType, AICallOptions, RouterContext } from "../../ai";

/** Compatibility alias used by older call sites. */
export { callAI } from "../ai-client.server";
