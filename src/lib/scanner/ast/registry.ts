/**
 * Parser registry — maps each {@link AstLanguage} to the backend that serves it. Designed so future
 * languages/backends (native Tree-sitter in the sandbox) register without touching call sites.
 *
 * @see docs/README.md  (Phase 1)
 */

import type { AstLanguage, ParserBackend } from "./types";
import { typescriptBackend } from "./backends/typescript-backend";

export class ParserRegistry {
  private readonly byLanguage = new Map<AstLanguage, ParserBackend>();

  /** Register a backend for all languages it declares. Later registrations win (override). */
  register(backend: ParserBackend): this {
    for (const lang of backend.languages) {
      this.byLanguage.set(lang, backend);
    }
    return this;
  }

  /** The backend for a language, or null when none is registered (→ regex fallback). */
  get(language: AstLanguage): ParserBackend | null {
    return this.byLanguage.get(language) ?? null;
  }

  /** Languages with a registered backend. */
  supportedLanguages(): AstLanguage[] {
    return [...this.byLanguage.keys()];
  }
}

/**
 * The default registry. Currently only the TypeScript-compiler backend is registered (TS/JS/JSX/TSX);
 * native Tree-sitter backends for Go/Python/Ruby/PHP/Java/Rust register here when the deep tier lands.
 */
export const defaultRegistry = new ParserRegistry().register(typescriptBackend);
