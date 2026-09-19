/**
 * Semantic scanner AST layer — public façade.
 *
 * `parseSource()` is the single entry point rules use. It picks a backend by the file's language and
 * returns a {@link ParseResult}; `available: false` means "no AST here — use the regex fallback". It
 * never throws for expected conditions, honoring the graceful-degradation contract.
 *
 * @see docs/README.md  (Phase 1)
 */

import { detectAstLanguage } from "./language";
import { defaultRegistry, ParserRegistry } from "./registry";
import type { AstTree, ParseResult } from "./types";

export type {
  AstLanguage,
  AstNode,
  AstTree,
  NormalizedKind,
  ParseResult,
  ParserBackend,
} from "./types";
export { detectAstLanguage, knownAstLanguages } from "./language";
export { ParserRegistry, defaultRegistry } from "./registry";
export { walk, findAll, findCalls, findNew, findImports, findJsxAttributes } from "./query";

/**
 * Parse a source file into a normalized AST, or report that no backend can serve it.
 *
 * @param path     file path (drives language detection)
 * @param source   file contents
 * @param registry backend registry (defaults to the shared {@link defaultRegistry})
 */
export async function parseSource(
  path: string,
  source: string,
  registry: ParserRegistry = defaultRegistry,
): Promise<ParseResult> {
  const language = detectAstLanguage(path);
  if (!language) return { available: false, language: null };

  const backend = registry.get(language);
  if (!backend) return { available: false, language };

  try {
    const root = await backend.parse(language, path, source);
    if (!root) return { available: false, language };
    const tree: AstTree = { language, path, source, root };
    return { available: true, language, tree };
  } catch (err) {
    return {
      available: false,
      language,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
