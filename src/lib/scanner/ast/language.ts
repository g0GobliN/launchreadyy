/**
 * Per-file AST language detection by extension. Complements the repo-level `detectLanguage()` /
 * `detectFramework()` in scanner-rules.ts, which decide the *project's* language from manifests;
 * this decides which parser backend can read a *single* file.
 *
 * @see docs/README.md  (Phase 1)
 */

import type { AstLanguage } from "./types";

/** Extension (lowercase, no dot) → AstLanguage. */
const EXT_TO_LANGUAGE: Record<string, AstLanguage> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  go: "go",
  py: "python",
  pyi: "python",
  rb: "ruby",
  php: "php",
  java: "java",
  rs: "rust",
};

/** Files that are never source we want to parse, even if the extension matches. */
const SKIP = /\.(min|bundle)\.[cm]?jsx?$|\.d\.ts$|\.(test|spec)\.[cm]?[jt]sx?$/i;

/**
 * Return the AST language for a file path, or null if no backend targets it (regex fallback).
 * Test/spec/declaration/minified files return null on purpose — they're not scanned for findings.
 */
export function detectAstLanguage(path: string): AstLanguage | null {
  if (SKIP.test(path)) return null;
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return null;
  const ext = path.slice(lastDot + 1).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? null;
}

/** All languages the detector currently recognizes — useful for metrics and tests. */
export function knownAstLanguages(): AstLanguage[] {
  return [...new Set(Object.values(EXT_TO_LANGUAGE))];
}
