// Thin compatibility shim — delegates to the AI abstraction layer.
// New code should import from "~/ai" and use aiService directly.
import { aiService } from "../ai";

export async function callAI(prompt: string, maxTokens = 2048): Promise<string> {
  return aiService.generate(prompt, { maxTokens });
}
