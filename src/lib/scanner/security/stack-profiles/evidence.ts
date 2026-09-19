/**
 * Structural evidence helpers for framework detection.
 *
 * Several profiles used to match on a bare word anywhere in the sampled file contents — the
 * Django profile fired on `/django/i` against every file joined together. Any repo that merely
 * *mentions* a framework (a comparison page, a comment, a scanner rule about that framework) was
 * then handed that framework's advice, so a TanStack app got told to enable Django middleware.
 *
 * Detection keys off two things that cannot appear by accident: what the dependency manifests
 * declare, and which files exist. Where source content is unavoidable, it is scoped to files of
 * the right language and to an import/definition form, never to prose.
 */
import type { SecurityScanProfileCtx } from "./types";

/** Dependency manifests, matched on basename so a monorepo subdirectory still counts. */
const MANIFEST_NAMES = new Set([
  "requirements.txt",
  "requirements-dev.txt",
  "dev-requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "setup.py",
  "setup.cfg",
  "Gemfile",
  "gems.rb",
  "composer.json",
  "go.mod",
  "package.json",
]);

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Text of the dependency manifests only — never the whole repo. */
export function manifestText(ctx: SecurityScanProfileCtx): string {
  return Object.entries(ctx.fileContents)
    .filter(([path]) => MANIFEST_NAMES.has(basename(path)))
    .map(([, text]) => text)
    .join("\n");
}

/** True when a dependency manifest declares something matching `re`. */
export function manifestDeclares(ctx: SecurityScanProfileCtx, re: RegExp): boolean {
  return re.test(manifestText(ctx));
}

/** True when any path in the repo matches `re`. */
export function hasFileMatching(ctx: SecurityScanProfileCtx, re: RegExp): boolean {
  return ctx.files.some((f) => re.test(f));
}

/**
 * Content match restricted to files of the given extensions. A sentence about Django in a
 * TypeScript comment cannot satisfy a Python-only matcher.
 */
export function sourceOfTypeMatches(
  ctx: SecurityScanProfileCtx,
  extensions: string[],
  re: RegExp,
): boolean {
  return Object.entries(ctx.fileContents).some(
    ([path, text]) => extensions.some((ext) => path.endsWith(ext)) && re.test(text),
  );
}
