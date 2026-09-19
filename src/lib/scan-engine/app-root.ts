/**
 * Where does the application actually live?
 *
 * Scanning assumed the repository root *is* the app — true for a single-app repo, false for
 * every monorepo and for the very common `backend/` + `frontend/` split. When it was false the
 * consequences were not cosmetic: language detection returned "unknown", which selected the
 * Node source-extension filter, which matched no files, which left the Production Security
 * checks scanning an empty file set. A repo with hardcoded credentials in `backend/app/main.py`
 * reported zero security findings and a *higher* score than the same file at the root.
 *
 * This module answers the question from the file list alone — no I/O, fully deterministic, so
 * the choice is testable and reproducible. Callers rebase the scan onto the returned directory.
 */

/** Manifests that mark a directory as a real application/service root. */
const MANIFESTS: Record<string, string> = {
  "package.json": "node",
  "go.mod": "go",
  "requirements.txt": "python",
  "pyproject.toml": "python",
  "setup.py": "python",
  Pipfile: "python",
  Gemfile: "ruby",
  "composer.json": "php",
  "Cargo.toml": "rust",
  "pom.xml": "java",
  "build.gradle": "java",
  "build.gradle.kts": "java",
  "mix.exs": "elixir",
  "pubspec.yaml": "flutter",
  "Package.swift": "swift",
};

/** Marks the root as a workspace coordinator rather than an app in its own right. */
const WORKSPACE_MARKERS = ["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json"];

/** Directories that are never the product, even when they carry a manifest. */
const NON_APP_SEGMENTS = new Set([
  "node_modules",
  "vendor",
  "example",
  "examples",
  "sample",
  "samples",
  "demo",
  "demos",
  "test",
  "tests",
  "e2e",
  "fixture",
  "fixtures",
  "template",
  "templates",
  "docs",
  "doc",
  "website",
  "scripts",
  "tools",
  "build",
  "dist",
  "target",
  "__tests__",
  ".github",
]);

/** Conventional homes for deployables — ranked above an arbitrary directory of the same depth. */
const APP_PARENTS = new Set(["apps", "services", "packages", "cmd", "projects"]);

/**
 * Server-side names outrank client-side ones. When a repo ships both an API and a web app,
 * either is a defensible "primary" — but this product's job is production readiness and
 * security, and that is overwhelmingly a property of the server: auth, rate limiting, CORS,
 * webhook verification, security headers. Auditing `apps/web` and staying silent about
 * `apps/api` is the more expensive mistake, so the tie breaks toward the backend.
 */
const BACKEND_NAMES = new Set(["backend", "api", "server", "service", "worker"]);
const FRONTEND_NAMES = new Set(["web", "frontend", "client", "site", "www", "ui", "docs"]);
const APP_NAMES = new Set([...BACKEND_NAMES, ...FRONTEND_NAMES, "app"]);

const SOURCE_EXT =
  /\.(tsx?|jsx?|mts|mjs|py|go|rb|php|rs|java|kt|kts|cs|ex|exs|swift|dart|vue|svelte)$/;

export interface AppRootCandidate {
  /** Repo-relative directory, "." for the repository root. */
  dir: string;
  /** Ecosystem implied by the manifest found there. */
  language: string;
  /** Manifest filenames present in that directory. */
  manifests: string[];
  /** Path segments below the root — 0 for the root itself. */
  depth: number;
  /** Source files beneath the directory (bounded scan signal, not a build input). */
  sourceFiles: number;
}

function dirOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i === -1 ? "." : filePath.slice(0, i);
}

/**
 * A workspace member is exempt from the name blocklist. `docs`, `tools` and `website` are all
 * legitimate deployable apps when they sit under `apps/` or `services/` — Turborepo's own
 * starter ships `apps/docs`. The blocklist exists to skip a repo's *supporting* directories,
 * so it only applies where the name is not explicitly a workspace member.
 */
function isExcluded(dir: string): boolean {
  if (dir === ".") return false;
  const segments = dir.split("/");
  return segments.some((seg, i) => {
    if (!NON_APP_SEGMENTS.has(seg.toLowerCase())) return false;
    const parent = i > 0 ? segments[i - 1]!.toLowerCase() : "";
    return !APP_PARENTS.has(parent);
  });
}

/**
 * Every directory holding a recognised manifest, ranked best-first.
 *
 * `maxDepth` keeps a deeply vendored manifest (a Go module four levels down inside a
 * test-data tree) from outranking the obvious app — the conventional layouts this exists
 * to serve (`apps/web`, `services/api`, `backend`) all sit at depth 1–2.
 */
export function findAppRoots(files: string[], maxDepth = 3): AppRootCandidate[] {
  const byDir = new Map<string, Set<string>>();

  for (const file of files) {
    if (file.includes("node_modules/")) continue;
    const base = file.includes("/") ? file.slice(file.lastIndexOf("/") + 1) : file;
    if (!(base in MANIFESTS) && !/\.csproj$/i.test(base)) continue;
    const dir = dirOf(file);
    if (isExcluded(dir)) continue;
    const depth = dir === "." ? 0 : dir.split("/").length;
    if (depth > maxDepth) continue;
    const set = byDir.get(dir) ?? new Set<string>();
    set.add(base);
    byDir.set(dir, set);
  }

  const sourceCounts = new Map<string, number>();
  for (const file of files) {
    if (file.includes("node_modules/") || !SOURCE_EXT.test(file)) continue;
    for (const dir of byDir.keys()) {
      if (dir === "." || file.startsWith(`${dir}/`)) {
        sourceCounts.set(dir, (sourceCounts.get(dir) ?? 0) + 1);
      }
    }
  }

  const candidates: AppRootCandidate[] = [];
  for (const [dir, manifestSet] of byDir) {
    const manifests = [...manifestSet].sort();
    const primary = manifests.find((m) => m in MANIFESTS);
    const language = primary
      ? MANIFESTS[primary]
      : manifests.some((m) => /\.csproj$/i.test(m))
        ? "csharp"
        : "unknown";
    candidates.push({
      dir,
      language,
      manifests,
      depth: dir === "." ? 0 : dir.split("/").length,
      sourceFiles: sourceCounts.get(dir) ?? 0,
    });
  }

  return candidates.sort((a, b) => rank(b) - rank(a) || a.depth - b.depth || cmp(a.dir, b.dir));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Higher is more likely to be the thing the user deploys. A non-Node manifest is a stronger
 * signal than `package.json`, which also appears on every shared UI library in a workspace.
 */
function rank(c: AppRootCandidate): number {
  let score = 0;
  const name = c.dir === "." ? "" : (c.dir.split("/").pop() ?? "");
  const parent = c.dir.includes("/") ? c.dir.split("/").slice(-2)[0] : "";

  if (c.language !== "node" && c.language !== "unknown") score += 40;
  else if (c.manifests.includes("package.json")) score += 20;

  const lower = name.toLowerCase();
  if (BACKEND_NAMES.has(lower)) score += 22;
  else if (APP_NAMES.has(lower)) score += 15;
  if (APP_PARENTS.has(parent.toLowerCase())) score += 10;

  // Substance beats naming: an "apps/web" with three files loses to a real service.
  // Capped below the backend/frontend gap so file count cannot flip that deliberate tie-break.
  score += Math.min(6, c.sourceFiles);
  score -= c.depth * 5;
  return score;
}

/** True when the repo root coordinates workspaces instead of being an app itself. */
export function isWorkspaceRoot(files: string[], rootPackageJson: string | null): boolean {
  if (WORKSPACE_MARKERS.some((m) => files.includes(m))) return true;
  if (!rootPackageJson) return false;
  try {
    const pkg = JSON.parse(rootPackageJson) as { workspaces?: unknown };
    const ws = pkg.workspaces;
    if (Array.isArray(ws) && ws.length > 0) return true;
    if (ws && typeof ws === "object" && Array.isArray((ws as { packages?: unknown }).packages)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export interface AppRootDecision {
  /** Directory to rebase the scan onto, or null to scan the repository root as before. */
  appDir: string | null;
  /** Other application roots found — surfaced so the user knows what was not scanned. */
  others: string[];
  language: string;
}

/**
 * Decide where to scan. Only ever called once root-level detection has already come back
 * "unknown", so a repo we classify correctly today keeps its exact current behaviour.
 */
export function decideAppRoot(files: string[]): AppRootDecision {
  const candidates = findAppRoots(files).filter((c) => c.dir !== ".");
  if (candidates.length === 0) return { appDir: null, others: [], language: "unknown" };

  const [primary, ...rest] = candidates;
  return {
    appDir: primary.dir,
    others: rest.map((c) => c.dir),
    language: primary.language,
  };
}
