/**
 * Reusable, backend-agnostic AST API for the semantic scanner (v2 Phase 1).
 *
 * Rules query this normalized shape instead of raw strings. The same API is served by different
 * backends per execution tier: the TypeScript-compiler backend for TS/JS and native Tree-sitter
 * backends for languages supported by sandbox analysis.
 * When no backend can serve a file's language, callers fall back to the existing regex scanner.
 *
 * @see docs/README.md  (Phase 1)
 */

/** Languages the AST layer is designed to serve. Extend this union to add a language. */
export type AstLanguage =
  | "typescript"
  | "javascript"
  | "tsx"
  | "jsx"
  | "go"
  | "python"
  | "ruby"
  | "php"
  | "java"
  | "rust";

/**
 * Backend-neutral node classification. Backends map their native node kinds onto this small set so
 * rules never depend on a specific parser's taxonomy. `other` is the escape hatch — the raw kind is
 * always preserved in {@link AstNode.rawKind} for backend-specific refinement.
 */
export type NormalizedKind =
  | "program"
  | "import"
  | "call"
  | "new"
  | "function"
  | "class"
  | "jsx-attribute"
  | "string"
  | "identifier"
  | "member"
  | "other";

/** One node in the normalized tree. */
export interface AstNode {
  kind: NormalizedKind;
  /** The backend's native node kind name (e.g. TS `CallExpression`), for refinement. */
  rawKind: string;
  /** Source text of the node. */
  text: string;
  /**
   * Kind-dependent convenience label:
   * - `call` / `new`: the callee/constructor text (e.g. `eval`, `cp.exec`, `require`).
   * - `import`: the module specifier, unquoted (e.g. `child_process`).
   * - `jsx-attribute`: the attribute name (e.g. `dangerouslySetInnerHTML`).
   */
  name?: string;
  /** For `string` nodes: the literal value with surrounding quotes removed. */
  value?: string;
  /** 1-based line where the node starts. */
  line: number;
  /** Absolute start/end character offsets in the source. */
  start: number;
  end: number;
  children: AstNode[];
}

/** A parsed tree plus the source metadata needed to report findings. */
export interface AstTree {
  language: AstLanguage;
  path: string;
  source: string;
  root: AstNode;
}

/** Result of a parse attempt. Never throws — absence is signalled, so callers can fall back. */
export interface ParseResult {
  /** True when a backend produced a tree. False means the caller should use the regex fallback. */
  available: boolean;
  language: AstLanguage | null;
  tree?: AstTree;
  /** Populated when a backend was chosen but parsing/loading failed (still `available: false`). */
  error?: string;
}

/** A parser backend for one or more languages. Backends register into the {@link ParserRegistry}. */
export interface ParserBackend {
  /** Human-readable id for metrics/logging (e.g. `typescript-compiler`). */
  readonly id: string;
  /** Languages this backend can parse. */
  readonly languages: readonly AstLanguage[];
  /**
   * Parse source into a normalized tree, or return null if this backend can't serve it in the
   * current runtime (e.g. the underlying parser couldn't load). Must never throw for expected
   * "can't parse here" conditions.
   */
  parse(language: AstLanguage, path: string, source: string): Promise<AstNode | null>;
}
