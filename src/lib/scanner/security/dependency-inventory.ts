/**
 * What the repository actually installs, read from lockfiles.
 *
 * The previous inventory was `package.json`'s `dependencies` map, which is wrong in three ways at
 * once: it is npm-only, it lists direct dependencies while most advisories land on transitive
 * ones, and its values are *ranges*. `^4.17.20` was queried by stripping the caret, so OSV was
 * asked about 4.17.20 whatever the project had actually installed — a repo that had already
 * upgraded still reported the old advisory, and one that resolved forward into a vulnerable
 * release reported nothing.
 *
 * A lockfile answers the question the advisory database is actually asking: which exact versions
 * are on disk. Every parser here is deliberately tolerant — an unreadable or unfamiliar lockfile
 * yields nothing rather than throwing, because a dependency check that breaks the scan is worse
 * than one that misses a file.
 *
 * @see docs/reference/19-tool-licensing.md — why this is in-house rather than `osv-scanner`
 */

/** OSV ecosystem identifiers. These strings are the API's, not ours — do not "tidy" them. */
export type Ecosystem =
  | "npm"
  | "PyPI"
  | "Go"
  | "crates.io"
  | "RubyGems"
  | "Packagist"
  | "Hex"
  | "NuGet";

export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

/** Lockfiles we know how to read, in the order we prefer them within an ecosystem. */
export const LOCKFILE_PATHS = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "poetry.lock",
  "requirements.txt",
  "Gemfile.lock",
  "composer.lock",
  "Cargo.lock",
  "go.sum",
  "mix.lock",
  "packages.lock.json",
] as const;

export type LockfilePath = (typeof LOCKFILE_PATHS)[number];

const SEMVER_ISH = /^[0-9]+(\.[0-9]+)*([.-][0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** Reject the placeholders lockfiles use for local/linked packages — OSV has nothing to say. */
function usableVersion(version: string | undefined): version is string {
  if (!version) return false;
  const v = version.trim();
  if (!v || v.length > 64) return false;
  if (v.startsWith("file:") || v.startsWith("link:") || v.startsWith("workspace:")) return false;
  return SEMVER_ISH.test(v.replace(/^v/, ""));
}

function push(out: Dependency[], ecosystem: Ecosystem, name: string, version: string): void {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 214) return;
  if (!usableVersion(version)) return;
  out.push({ ecosystem, name: cleanName, version: version.trim().replace(/^v/, "") });
}

/* ------------------------------------------------------------------ npm */

interface NpmLockEntry {
  version?: string;
  link?: boolean;
  dependencies?: Record<string, NpmLockEntry>;
}

/**
 * `package-lock.json`, both layouts. v2/v3 key `packages` by install path
 * (`node_modules/a/node_modules/b`), where the package name is everything after the *last*
 * `node_modules/` — nested paths are how npm records a conflicting transitive version, and
 * splitting on the first separator would name it `a`.
 */
export function parsePackageLock(raw: string): Dependency[] {
  const out: Dependency[] = [];
  let doc: { packages?: Record<string, NpmLockEntry>; dependencies?: Record<string, NpmLockEntry> };
  try {
    doc = JSON.parse(raw);
  } catch {
    return out;
  }

  if (doc.packages) {
    for (const [path, entry] of Object.entries(doc.packages)) {
      // "" is the root project itself, and `link: true` is a workspace symlink, not a download.
      if (!path || entry?.link) continue;
      const marker = path.lastIndexOf("node_modules/");
      if (marker === -1) continue;
      push(out, "npm", path.slice(marker + "node_modules/".length), entry?.version ?? "");
    }
  }

  if (out.length === 0 && doc.dependencies) {
    const walk = (tree: Record<string, NpmLockEntry>, depth: number): void => {
      if (depth > 12) return;
      for (const [name, entry] of Object.entries(tree)) {
        push(out, "npm", name, entry?.version ?? "");
        if (entry?.dependencies) walk(entry.dependencies, depth + 1);
      }
    };
    walk(doc.dependencies, 0);
  }
  return out;
}

/**
 * `pnpm-lock.yaml`. Package keys changed shape across major versions — v5 wrote `/foo/1.2.3`,
 * v6+ writes `/foo@1.2.3`, v9 drops the leading slash — so match the version separator rather
 * than any one layout. Scoped names (`@scope/pkg`) keep a leading `@` that is not a separator.
 */
export function parsePnpmLock(raw: string): Dependency[] {
  const out: Dependency[] = [];
  for (const line of raw.split("\n")) {
    const m = /^ {2}'?\/?((?:@[^/'\s]+\/)?[^@/'\s]+)[@/]([0-9][^:'\s(]*)'?:/.exec(line);
    if (m) push(out, "npm", m[1]!, m[2]!);
  }
  return out;
}

/** `yarn.lock` (v1 and berry): a spec header, then an indented `version` line. */
export function parseYarnLock(raw: string): Dependency[] {
  const out: Dependency[] = [];
  let name = "";
  for (const line of raw.split("\n")) {
    if (line.trim().startsWith("#")) continue;
    if (/^["a-zA-Z@]/.test(line)) {
      // A header may list several specs for one resolution; they share a name.
      const first = line.split(",")[0]!.trim().replace(/^"/, "").replace(/":?$/, "");
      const at = first.lastIndexOf("@");
      name = at > 0 ? first.slice(0, at) : "";
      continue;
    }
    const m = /^\s+"?version"?:?\s+"?([^"\s]+)"?/.exec(line);
    if (m && name) {
      push(out, "npm", name, m[1]!);
      name = "";
    }
  }
  return out;
}

/* --------------------------------------------------------------- generic */

/**
 * TOML `[[package]]` blocks — the shape `Cargo.lock` and `poetry.lock` share.
 *
 * Names are matched only at the start of a line so that a `name =` inside a nested table (such as
 * poetry's `[package.source]`) cannot overwrite the package's own name.
 */
function parseTomlPackageBlocks(raw: string, ecosystem: Ecosystem): Dependency[] {
  const out: Dependency[] = [];
  let name = "";
  let version = "";
  const flush = () => {
    if (name && version) push(out, ecosystem, name, version);
    name = "";
    version = "";
  };
  for (const line of raw.split("\n")) {
    if (line.startsWith("[[package]]")) {
      flush();
      continue;
    }
    // Any other table header ends the block's own key/value pairs.
    if (line.startsWith("[") && !line.startsWith("[[package]]")) {
      if (name && version) flush();
      continue;
    }
    const n = /^name\s*=\s*"([^"]+)"/.exec(line);
    if (n) name = n[1]!;
    const v = /^version\s*=\s*"([^"]+)"/.exec(line);
    if (v) version = v[1]!;
  }
  flush();
  return out;
}

export function parseCargoLock(raw: string): Dependency[] {
  return parseTomlPackageBlocks(raw, "crates.io");
}

export function parsePoetryLock(raw: string): Dependency[] {
  return parseTomlPackageBlocks(raw, "PyPI");
}

/** `requirements.txt` — only `==` pins are usable; a range tells us nothing about what installed. */
export function parseRequirementsTxt(raw: string): Dependency[] {
  const out: Dependency[] = [];
  for (const line of raw.split("\n")) {
    const text = line.split("#")[0]!.trim();
    if (!text || text.startsWith("-")) continue;
    const m = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*==\s*([0-9][^\s;,]*)/.exec(text);
    if (m) push(out, "PyPI", m[1]!, m[2]!);
  }
  return out;
}

/** `Gemfile.lock` — `    name (1.2.3)` under GEM/specs, indented deeper for transitives. */
export function parseGemfileLock(raw: string): Dependency[] {
  const out: Dependency[] = [];
  let inSpecs = false;
  for (const line of raw.split("\n")) {
    if (/^\s{2}specs:/.test(line)) {
      inSpecs = true;
      continue;
    }
    // A column-0 heading (PLATFORMS, DEPENDENCIES, …) ends the spec list.
    if (/^\S/.test(line)) {
      inSpecs = false;
      continue;
    }
    if (!inSpecs) continue;
    const m = /^\s{4}([A-Za-z0-9._-]+) \(([0-9][^)]*)\)/.exec(line);
    if (m) push(out, "RubyGems", m[1]!, m[2]!);
  }
  return out;
}

/** `composer.lock` — JSON with `packages` and `packages-dev`. */
export function parseComposerLock(raw: string): Dependency[] {
  const out: Dependency[] = [];
  try {
    const doc = JSON.parse(raw) as {
      packages?: { name?: string; version?: string }[];
      "packages-dev"?: { name?: string; version?: string }[];
    };
    for (const list of [doc.packages, doc["packages-dev"]]) {
      for (const p of list ?? []) push(out, "Packagist", p.name ?? "", p.version ?? "");
    }
  } catch {
    /* unreadable lockfile contributes nothing */
  }
  return out;
}

/**
 * `go.sum` — two lines per module, the second suffixed `/go.mod`. Both name the same version, so
 * the `/go.mod` line is skipped rather than deduped later.
 */
export function parseGoSum(raw: string): Dependency[] {
  const out: Dependency[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    const m = /^(\S+)\s+v(\S+?)(\/go\.mod)?\s+h1:/.exec(line);
    if (!m || m[3]) continue;
    const key = `${m[1]}@${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    push(out, "Go", m[1]!, m[2]!);
  }
  return out;
}

/** `mix.lock` — `"name": {:hex, :name, "1.2.3", …}`. */
export function parseMixLock(raw: string): Dependency[] {
  const out: Dependency[] = [];
  const re = /"([a-z0-9_]+)":\s*\{:hex,\s*:[a-z0-9_]+,\s*"([^"]+)"/g;
  for (const m of raw.matchAll(re)) push(out, "Hex", m[1]!, m[2]!);
  return out;
}

/** NuGet `packages.lock.json` — `dependencies` keyed by target framework. */
export function parseNugetLock(raw: string): Dependency[] {
  const out: Dependency[] = [];
  try {
    const doc = JSON.parse(raw) as {
      dependencies?: Record<string, Record<string, { resolved?: string }>>;
    };
    for (const framework of Object.values(doc.dependencies ?? {})) {
      for (const [name, entry] of Object.entries(framework)) {
        push(out, "NuGet", name, entry?.resolved ?? "");
      }
    }
  } catch {
    /* unreadable lockfile contributes nothing */
  }
  return out;
}

const PARSERS: Record<LockfilePath, (raw: string) => Dependency[]> = {
  "package-lock.json": parsePackageLock,
  "pnpm-lock.yaml": parsePnpmLock,
  "yarn.lock": parseYarnLock,
  "poetry.lock": parsePoetryLock,
  "requirements.txt": parseRequirementsTxt,
  "Gemfile.lock": parseGemfileLock,
  "composer.lock": parseComposerLock,
  "Cargo.lock": parseCargoLock,
  "go.sum": parseGoSum,
  "mix.lock": parseMixLock,
  "packages.lock.json": parseNugetLock,
};

export function parseLockfile(path: LockfilePath, raw: string): Dependency[] {
  try {
    return PARSERS[path](raw);
  } catch {
    return [];
  }
}

/** Same package at the same version from two lockfiles is one query. */
export function dedupeDependencies(deps: Dependency[]): Dependency[] {
  const seen = new Set<string>();
  const out: Dependency[] = [];
  for (const dep of deps) {
    const key = `${dep.ecosystem}|${dep.name}|${dep.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dep);
  }
  return out;
}

/**
 * Read every lockfile the repository has and merge the results.
 *
 * A polyglot repo legitimately has several — a Go API beside a Next front end — so this reads all
 * of them rather than stopping at the first hit. `readFile` returning null (missing, too large to
 * fetch, or a network failure) is normal and simply contributes nothing.
 */
export async function collectDependencies(
  readFile: (path: string) => Promise<string | null>,
  paths: readonly string[],
): Promise<Dependency[]> {
  const present = LOCKFILE_PATHS.filter((lock) =>
    paths.some((p) => p === lock || p.endsWith(`/${lock}`)),
  );

  const found = await Promise.all(
    present.map(async (lock) => {
      // The tree may hold several copies in a monorepo; the root-most one is the informative one.
      const candidates = paths
        .filter((p) => p === lock || p.endsWith(`/${lock}`))
        .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
        .slice(0, 3);
      const parsed = await Promise.all(
        candidates.map(async (path) => {
          const raw = await readFile(path).catch(() => null);
          return raw ? parseLockfile(lock, raw) : [];
        }),
      );
      return parsed.flat();
    }),
  );

  return dedupeDependencies(found.flat());
}
