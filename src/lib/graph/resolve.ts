/**
 * Import resolution for the dependency graph (v2 Phase 4). Pure path logic — resolve a relative
 * import specifier against the repo's file set, or classify it as an external module.
 *
 * @see docs/README.md  (Phase 4)
 */

const RESOLVE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];

/** Normalize a POSIX-style path, collapsing `.` and `..` segments. */
export function normalizePath(path: string): string {
  const isAbs = path.startsWith("/");
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!isAbs) out.push("..");
    } else {
      out.push(seg);
    }
  }
  return (isAbs ? "/" : "") + out.join("/");
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/**
 * Resolve `specifier` imported from `fromPath` to a file in `fileSet`, or `null` if it's external
 * (bare specifier) or unresolvable. Tries the literal path, common source extensions, and
 * `index.*` for directory imports — mirroring bundler/Node resolution closely enough for graphing.
 */
export function resolveImport(
  fromPath: string,
  specifier: string,
  fileSet: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith(".")) return null; // bare = external module
  const base = normalizePath(`${dirname(fromPath)}/${specifier}`);

  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((e) => `${base}.${e}`),
    ...RESOLVE_EXTENSIONS.map((e) => `${base}/index.${e}`),
  ];
  for (const c of candidates) {
    if (fileSet.has(c)) return c;
  }
  return null;
}

/** The package name of a bare specifier: `@scope/pkg/sub` → `@scope/pkg`, `lodash/fp` → `lodash`. */
export function packageOf(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}
