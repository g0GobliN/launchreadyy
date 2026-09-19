/**
 * The one list of paths that never reach production, shared by every whole-repo analyzer.
 *
 * This existed only inside the secret sweep, so analyzers scanned the entire checkout — including
 * test files whose whole purpose is to contain fake credentials. A scanner that reports its own
 * fixtures as launch blockers is worse than one that reports nothing: it buries the real findings
 * and teaches the user to ignore the report.
 *
 * Kept deliberately narrow. Only directories and file patterns that are unambiguously not shipped
 * belong here — dev tooling under `scripts/` is excluded from neither, because a credential or an
 * injection in a deploy script is a real risk.
 */

/**
 * Directories that never hold shipped source — and `node_modules` would dwarf the repo.
 *
 * The narrow list: generated output, dependencies, and tests. A credential sitting in any of
 * these is still worth reporting, which is why the secret sweep uses only this one.
 */
export const NON_SHIPPING_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
  "vendor",
  "coverage",
  ".turbo",
  ".cache",
  "__pycache__",
  "__tests__",
  "e2e",
  "fixtures",
  "fixture",
];

/**
 * Build scripts, examples and benchmarks: code that runs on a developer's machine or in CI, but
 * is never served to a user.
 *
 * Separate from the list above on purpose. "Your dev script talks to http://localhost" and "your
 * benchmark builds a RegExp from a variable" are not production risks, and reporting them as
 * `high` buries the findings that are. A leaked *credential* in a deploy script is a real leak,
 * though — which is why the secret sweep deliberately does not use this list.
 */
export const DEV_TOOLING_DIRS = [
  "scripts",
  "script",
  "examples",
  "example",
  "samples",
  "sample",
  "demo",
  "demos",
  "benchmark",
  "benchmarks",
  "bench",
  "testdata",
  "tools",
];

/** Everything an analyzer looking for production risk should ignore. */
export const NOT_DEPLOYED_DIRS = [...NON_SHIPPING_DIRS, ...DEV_TOOLING_DIRS];

/** Generated, vendored, or test files, by name pattern. */
export const NON_SHIPPING_GLOBS = [
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.lock",
  "*.svg",
  "*.test.ts",
  "*.test.tsx",
  "*.test.js",
  "*.test.jsx",
  "*.spec.ts",
  "*.spec.tsx",
  "*.spec.js",
  "*.spec.jsx",
];

/** `*.test.ts` → `/\.test\.ts$/`. Only the leading-star form used above needs supporting. */
const GLOB_MATCHERS = NON_SHIPPING_GLOBS.map(
  (glob) => new RegExp(`${glob.replace(/^\*/, "").replace(/\./g, "\\.")}$`),
);
const DIR_SET = new Set(NOT_DEPLOYED_DIRS);

/**
 * True for paths that are in the repo but never in production.
 *
 * Used by framework detection as well as the analyzers: a repo carrying sample apps under
 * `fixtures/` or `examples/` must not be classified by what those samples are built with. A
 * Django app vendored as a test fixture is not evidence that the product is a Django app.
 */
export function isNonShippingPath(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => DIR_SET.has(segment))) return true;
  const name = segments[segments.length - 1] ?? path;
  return GLOB_MATCHERS.some((re) => re.test(name));
}

/** The subset of a path→content map that actually ships. */
export function shippingContents(contents: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(contents).filter(([path]) => !isNonShippingPath(path)));
}

/**
 * `grep` wants the two kinds separated.
 *
 * Narrow list only: the secret sweep still reads `scripts/` and `examples/`, because a real
 * credential committed there is a real credential.
 */
export function grepExcludeArgs(): string {
  return [
    ...NON_SHIPPING_DIRS.map((d) => `--exclude-dir=${d}`),
    ...NON_SHIPPING_GLOBS.map((g) => `--exclude=${g}`),
  ].join(" ");
}
