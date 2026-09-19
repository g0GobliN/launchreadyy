import { createHash } from "crypto";
import { aiService } from "../ai";
import { githubContentsPath } from "./github.server";
import type { GeneratedFileHash } from "./data-store.types";

const GITHUB_API = "https://api.github.com";
const MAX_ERROR_LOG = 10_000;
const MAX_AI_LOG = 2000;
const RECOVERY_AI_EFFORT = 1;
const MAX_RECOVERY_ATTEMPTS = 2;

export type RecoveryTier = 1 | 2 | 3;
export type DriftLevel = "pristine" | "moderate" | "heavy";
export type ResolutionType = "auto_patched" | "suggested" | "checklist" | "diagnosis" | "escalated";

export interface GeneratedFileRecord {
  path: string;
  hash: string;
  content: string;
}

export interface PatchSuggestion {
  path: string;
  content: string;
}

export interface PatternMatchResult {
  errorSignature: string;
  rootCause: string;
  resolutionType: "patch" | "checklist" | "manual";
  checklist?: string[];
  patch?: PatchSuggestion;
  suggestedTier?: RecoveryTier;
}

export interface DiagnosisOutput {
  recoveryId: string;
  rootCause: string;
  errorSignature: string;
  tier: RecoveryTier;
  driftLevel: DriftLevel;
  resolutionType: ResolutionType;
  attemptCount: number;
  aiEffort: number;
  patchOffer: "auto" | "suggested" | null;
  patch?: PatchSuggestion;
  checklist?: string[];
  driftMessage?: string;
  failingPath?: string;
  /** Set when a deterministic CI patch was opened automatically during diagnose */
  appliedPrUrl?: string;
  /** True when the full fix PR was recreated (branch was deleted) */
  recreatedPr?: boolean;
}

interface AiRecoveryResponse {
  rootCause: string;
  resolutionType: "patch" | "checklist" | "manual";
  checklist?: string[];
  patchPath?: string;
  patchContent?: string;
}

const TIER1_PATTERNS: RegExp[] = [
  /^\.github\/workflows\//,
  /^Dockerfile$/i,
  /^\.eslintrc/i,
  /^eslint\.config\./i,
  /^\.prettierrc/i,
  /^prettier\.config\./i,
  /^vitest\.config\./i,
  /^playwright\.config\./i,
];

const TIER2_PATTERNS: RegExp[] = [/^\.env\.example$/i, /sentry/i, /winston/i, /logger/i];

export function hashFileContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function buildGeneratedFileRecords(
  files: { path: string; content: string }[],
): GeneratedFileRecord[] {
  return files.map((f) => ({
    path: f.path.replace(/^\/+/, ""),
    hash: hashFileContent(f.content),
    content: f.content,
  }));
}

export function toStoredHashes(records: GeneratedFileRecord[]): GeneratedFileHash[] {
  return records.map(({ path, hash, content }) => ({ path, hash, content }));
}

export function parseStoredHashes(raw: unknown): GeneratedFileRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is GeneratedFileHash => typeof r === "object" && r !== null && "path" in r)
    .map((r) => ({
      path: r.path,
      hash: r.hash,
      content: r.content ?? "",
    }));
}

export function classifyTier(path: string): RecoveryTier {
  const normalized = path.replace(/^\/+/, "");
  if (TIER1_PATTERNS.some((p) => p.test(normalized))) return 1;
  if (TIER2_PATTERNS.some((p) => p.test(normalized))) return 2;
  if (normalized.startsWith("src/")) return 3;
  return 3;
}

export function contentSimilarity(original: string, current: string): number {
  if (original === current) return 1;
  const maxLen = Math.max(original.length, current.length);
  if (maxLen === 0) return 1;
  if (maxLen > 20_000) return lineSimilarity(original, current);

  const distance = levenshtein(original, current);
  return 1 - distance / maxLen;
}

function lineSimilarity(a: string, b: string): number {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const maxLines = Math.max(aLines.length, bLines.length);
  if (maxLines === 0) return 1;
  const freq = new Map<string, number>();
  for (const line of aLines) freq.set(line, (freq.get(line) ?? 0) + 1);
  let matched = 0;
  for (const line of bLines) {
    const n = freq.get(line) ?? 0;
    if (n > 0) {
      matched++;
      freq.set(line, n - 1);
    }
  }
  return matched / maxLines;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

export function driftFromSimilarity(similarity: number): DriftLevel {
  if (similarity > 0.9) return "pristine";
  if (similarity >= 0.5) return "moderate";
  return "heavy";
}

export function extractFailingPath(errorLog: string, generatedPaths: string[]): string | null {
  for (const p of generatedPaths) {
    if (errorLog.includes(p)) return p;
  }
  if (/\.github\/workflows|workflow/i.test(errorLog)) {
    const wf = generatedPaths.find((p) => p.startsWith(".github/workflows/"));
    if (wf) return wf;
  }
  if (/Dockerfile/i.test(errorLog)) {
    const df = generatedPaths.find((p) => /dockerfile/i.test(p));
    if (df) return df;
  }
  if (/eslint/i.test(errorLog)) {
    return generatedPaths.find((p) => /eslint/i.test(p)) ?? null;
  }
  if (/vitest/i.test(errorLog)) {
    return generatedPaths.find((p) => /vitest\.config/i.test(p)) ?? null;
  }
  if (/playwright/i.test(errorLog)) {
    return generatedPaths.find((p) => /playwright\.config/i.test(p)) ?? null;
  }
  return generatedPaths[0] ?? null;
}

/**
 * Who a failure belongs to.
 *
 * `ours`   — a defect in what we generated. Repair it, free, no questions.
 * `theirs` — a real gap in the user's repo that our files did not cause. Report it with the
 *            evidence; never silently "repair" someone else's code to make a check go green.
 * `unknown`— can't attribute it. Diagnose rather than guess.
 *
 * Only claim `theirs` when the failing paths can be named and shown to sit outside our diff —
 * a confident "probably your code" with no evidence is the worst output this can produce.
 */
export type FailureScope = "ours" | "theirs" | "unknown";

const ERROR_PATTERNS: Array<{
  id: string;
  test: (log: string) => boolean;
  rootCause: string;
  resolutionType: "patch" | "checklist" | "manual";
  checklist?: string[];
  suggestedTier?: RecoveryTier;
  scope?: FailureScope;
  patch?: (records: GeneratedFileRecord[], log: string) => PatchSuggestion | undefined;
}> = [
  // ── Seeded from four real CI failures observed on a live PR (2026-08-03). Each one shipped
  //    to users and none was visible to the unit suite or the Docker harness. ──────────────
  {
    // GitHub rejects the workflow at startup: 0 jobs, no logs, just a failed run.
    id: "workflow-invalid-yaml",
    test: (l) =>
      /mapping values are not allowed here|could not parse|Invalid workflow file/i.test(l) &&
      /\.github\/workflows|workflow/i.test(l),
    rootCause:
      "The workflow file isn't valid YAML, so GitHub couldn't load it — no jobs ran at all. Re-emitting it from the generator.",
    resolutionType: "patch",
    suggestedTier: 1,
    scope: "ours",
    patch: (records) => {
      const ci = records.find((r) => r.path.startsWith(".github/workflows/"));
      return ci ? { path: ci.path, content: ci.content } : undefined;
    },
  },
  {
    // Their lint script is `prettier --check .`, and our added file isn't formatted.
    id: "prettier-check-our-file",
    test: (l) =>
      /Code style issues found|Forgot to run Prettier/i.test(l) &&
      /\.github\/workflows|Dockerfile|\.eslintrc|prettier/i.test(l),
    rootCause:
      "Your lint script runs Prettier over the whole repo, and the file we added isn't formatted to your config — so our own file failed your check.",
    resolutionType: "patch",
    suggestedTier: 1,
    scope: "ours",
    patch: (records) => {
      const ci = records.find((r) => r.path.startsWith(".github/workflows/"));
      return ci ? { path: ci.path, content: ci.content } : undefined;
    },
  },
  {
    // We pinned a Node major the repo's own tooling rejects.
    id: "node-version-unsupported",
    test: (l) =>
      /is not supported by|requires Node|Please upgrade Node/i.test(l) &&
      /node/i.test(l) &&
      />=?\s*\d+/.test(l),
    rootCause:
      "The CI workflow pins a Node version your tooling doesn't support. Re-reading the version from your .nvmrc / engines field.",
    resolutionType: "patch",
    suggestedTier: 1,
    scope: "ours",
    patch: (records, log) => {
      const ci = records.find((r) => r.path.startsWith(".github/workflows/"));
      if (!ci) return undefined;
      // "requires: \">=22.12.0\"" -> 22. Take the highest demanded major in the log, since a
      // range like ">=20.19 || >=22.12" is satisfied by the newest one mentioned.
      const majors = [...log.matchAll(/>=?\s*v?(\d+)(?:\.\d+)*/g)].map((m) => Number(m[1]));
      const required = majors.length ? Math.max(...majors) : null;
      if (!required) return undefined;
      const content = ci.content.replace(
        /node-version:\s*['"]?\d+(?:\.\d+)*['"]?/g,
        `node-version: "${required}"`,
      );
      return content === ci.content ? undefined : { path: ci.path, content };
    },
  },
  {
    // We added a step for a script the repo doesn't have.
    id: "missing-npm-script",
    test: (l) => /Missing script:|npm ERR! missing script/i.test(l),
    rootCause:
      "The workflow runs a script your package.json doesn't define. Dropping that step — an absent script is a fact about the project, not a defect in it.",
    resolutionType: "patch",
    suggestedTier: 1,
    scope: "ours",
    patch: (records) => {
      const ci = records.find((r) => r.path.startsWith(".github/workflows/"));
      return ci ? { path: ci.path, content: ci.content } : undefined;
    },
  },
  {
    id: "workflow-expression-syntax",
    test: (l) =>
      /Unexpected symbol|Invalid workflow file/i.test(l) && /\.github\/workflows/i.test(l),
    rootCause:
      "GitHub Actions workflow has an invalid expression — restoring the original generated workflow",
    resolutionType: "patch",
    suggestedTier: 1,
    patch: (records) => {
      const ci = records.find((r) => r.path.startsWith(".github/workflows/"));
      if (!ci) return undefined;
      return { path: ci.path, content: ci.content };
    },
  },
  {
    id: "npm-ci-lockfile-sync",
    test: (l) =>
      /not in sync|Missing:.*from lock file/i.test(l) ||
      (/npm ci/i.test(l) && /EUSAGE/i.test(l) && /Missing:/i.test(l)) ||
      (/lockfile|lock.?file|package-lock/i.test(l) &&
        /(out of sync|outdated|missing|not in sync)/i.test(l) &&
        /package\.json|devdependency|devDependency/i.test(l)) ||
      (/playwright/i.test(l) &&
        /lockfile|lock.?file|package-lock/i.test(l) &&
        /(sync|outdated|missing|devdependency|devDependency)/i.test(l)) ||
      (/composer\.lock/i.test(l) && /(out of sync|does not match|not present|changed)/i.test(l)) ||
      (/gemfile\.lock/i.test(l) && /(changed|outdated|could not find gem)/i.test(l)) ||
      (/go\.sum/i.test(l) && /(missing|outdated|does not match)/i.test(l)) ||
      (/cargo\.lock/i.test(l) && /(out of date|needs to be updated|lock file)/i.test(l)),
    rootCause:
      "Lock file out of sync with package.json — we'll patch CI to use npm install until the lockfile is updated",
    resolutionType: "patch",
    suggestedTier: 1,
    checklist: [
      "Optional: run npm install locally and commit package-lock.json for stricter npm ci",
    ],
    patch: (records) => patchCiWorkflow(records, relaxCiInstallCommand),
  },
  {
    id: "npm-ci-lockfile",
    test: (l) =>
      /lock.?file is not found|Dependencies lock file/i.test(l) ||
      (/npm ci/i.test(l) && /lock.?file|package-lock/i.test(l)),
    rootCause:
      "Lock file missing or invalid — we'll patch CI to use npm install so dependencies can resolve",
    resolutionType: "patch",
    suggestedTier: 1,
    checklist: ["Optional: run npm install locally and commit package-lock.json"],
    patch: (records) => patchCiWorkflow(records, relaxCiInstallCommand),
  },
  {
    id: "tsc-not-found",
    test: (l) => /tsc: not found|Cannot find module ['"]typescript/i.test(l),
    rootCause: "TypeScript not installed — add typescript to devDependencies",
    resolutionType: "checklist",
    checklist: ["Run npm install -D typescript", "Commit package.json and lockfile", "Re-run CI"],
  },
  {
    id: "corepack-yarn",
    // require explicit corepack/berry signals — "yarn" alone matches "yarn.lock" in unrelated errors
    test: (l) =>
      /corepack/i.test(l) ||
      /yarn berry|\.yarnrc\.yml/i.test(l) ||
      (/yarn/i.test(l) && /immutable/i.test(l)),
    rootCause: "Yarn Berry requires corepack — enable it in CI before setup-node",
    resolutionType: "patch",
    suggestedTier: 1,
    patch: (records) => patchCiWorkflow(records, addCorepackStep),
  },
  {
    id: "missing-secrets",
    test: (l) => /SENTRY_DSN|environment variable|secret is not set|missing.*secret/i.test(l),
    rootCause: "Required secrets or environment variables are not configured",
    resolutionType: "checklist",
    suggestedTier: 2,
    checklist: [
      "Open GitHub repo Settings → Secrets and variables → Actions",
      "Add the missing environment variables referenced in the error",
      "Re-run the failed workflow",
    ],
  },
  {
    id: "workflow-permission",
    test: (l) => /permission denied|403|workflow scope|Resource not accessible/i.test(l),
    rootCause: "GitHub token missing workflow scope — reconnect GitHub",
    resolutionType: "checklist",
    checklist: [
      "Disconnect and reconnect GitHub in LaunchReadyy settings",
      "Ensure the OAuth app has the workflow scope",
      "Re-run the fix job",
    ],
  },
  {
    id: "missing-module",
    test: (l) => /Cannot find module/i.test(l),
    rootCause: "Dependency missing — run the install command and commit lockfile",
    resolutionType: "checklist",
    checklist: [
      "Run your package manager install locally",
      "Verify the missing package is in package.json",
      "Commit lockfile and push",
    ],
  },
  {
    id: "no-package-json",
    test: (l) => /ENOENT.*package\.json|Could not read package\.json/i.test(l),
    rootCause: "No package.json found at repo root",
    resolutionType: "manual",
    checklist: [
      "Ensure package.json exists at the repository root",
      "For monorepos, configure CI to run in the correct workspace directory",
    ],
  },
  {
    id: "playwright-browsers",
    test: (l) => /playwright/i.test(l) && /browser|executable|npx playwright install/i.test(l),
    rootCause: "Playwright browsers not installed — add npx playwright install to CI",
    resolutionType: "patch",
    suggestedTier: 1,
    patch: (records) => patchCiWorkflow(records, addPlaywrightInstallStep),
  },
  {
    id: "vitest-missing-plugin",
    test: (l) => /vitest/i.test(l) && /cannot find|failed to load config/i.test(l),
    rootCause: "Vitest config references a missing plugin or dependency",
    resolutionType: "manual",
    checklist: [
      "Check vitest.config for plugins listed in the error",
      "Install missing devDependencies",
      "Re-run CI",
    ],
  },
  {
    id: "npm-test-placeholder",
    test: (l) => /exit code 1/i.test(l) && /no test specified/i.test(l),
    rootCause: "npm test placeholder — no tests defined yet",
    resolutionType: "checklist",
    checklist: [
      "Add a real test script in package.json",
      "Or remove/skip the test step in CI until tests exist",
    ],
  },
];

/** Manifest files LaunchReadyy may change paired with ecosystem lockfiles. */
export const MANIFEST_LOCK_PAIRS: Array<{
  manifests: RegExp[];
  locks: RegExp[];
}> = [
  {
    manifests: [/^package\.json$/i],
    locks: [/^package-lock\.json$/i, /^yarn\.lock$/i, /^pnpm-lock\.yaml$/i, /^bun\.lockb?$/i],
  },
  { manifests: [/^pyproject\.toml$/i], locks: [/^poetry\.lock$/i] },
  { manifests: [/^Pipfile$/i], locks: [/^Pipfile\.lock$/i] },
  { manifests: [/^Gemfile$/i], locks: [/^Gemfile\.lock$/i] },
  { manifests: [/^go\.mod$/i], locks: [/^go\.sum$/i] },
  { manifests: [/^Cargo\.toml$/i], locks: [/^Cargo\.lock$/i] },
  { manifests: [/^composer\.json$/i], locks: [/^composer\.lock$/i] },
  { manifests: [/^pubspec\.yaml$/i], locks: [/^pubspec\.lock$/i] },
  { manifests: [/^mix\.exs$/i], locks: [/^mix\.lock$/i] },
];

function normalizeRepoPath(path: string): string {
  return path.replace(/^\/+/, "");
}

export function isManifestPath(path: string): boolean {
  const n = normalizeRepoPath(path);
  return MANIFEST_LOCK_PAIRS.some((p) => p.manifests.some((re) => re.test(n)));
}

export function needsCiInstallRelax(repoFilePaths: string[], prPaths: Iterable<string>): boolean {
  const prSet = new Set([...prPaths].map(normalizeRepoPath));
  const repoNorm = repoFilePaths.map(normalizeRepoPath);

  for (const { manifests, locks } of MANIFEST_LOCK_PAIRS) {
    const manifestInPr = [...prSet].some((p) => manifests.some((re) => re.test(p)));
    if (!manifestInPr) continue;
    const repoLocks = repoNorm.filter((p) => locks.some((re) => re.test(p)));
    if (repoLocks.length === 0) continue;
    const lockInPr = repoLocks.some((lock) => prSet.has(lock));
    if (!lockInPr) return true;
  }
  return false;
}

export function relaxCiInstallCommand(content: string): string {
  let next = content;
  // Node
  next = next.replace(/\bnpm ci\b/g, "npm install");
  next = next.replace(/install=npm ci/g, "install=npm install");
  next = next.replace(/pnpm install --frozen-lockfile/g, "pnpm install");
  next = next.replace(/install=pnpm install --frozen-lockfile/g, "install=pnpm install");
  next = next.replace(/yarn install --immutable/g, "yarn install");
  next = next.replace(/install=yarn install --immutable/g, "install=yarn install");
  next = next.replace(/yarn install --frozen-lockfile/g, "yarn install");
  next = next.replace(/install=yarn install --frozen-lockfile/g, "install=yarn install");
  next = next.replace(/bun install --frozen-lockfile/g, "bun install");
  next = next.replace(/install=bun install --frozen-lockfile/g, "install=bun install");
  // Python
  next = next.replace(/pipenv sync\b/g, "pipenv install --dev --skip-lock");
  next = next.replace(
    /pipenv install --dev\b(?!.*--skip-lock)/g,
    "pipenv install --dev --skip-lock",
  );
  next = next.replace(/poetry install --sync/g, "poetry install");
  // Ruby
  next = next.replace(/bundler-cache: true/g, "bundler-cache: false");
  if (/ruby\/setup-ruby@v1/.test(next) && !/bundle install/.test(next)) {
    next = next.replace(
      /(ruby\/setup-ruby@v1[\s\S]*?\n)( {6}- name:)/,
      "$1      - name: Install gems\n        run: bundle install\n$2",
    );
  }
  // PHP
  next = next.replace(
    /composer install\b(?![^\n]*composer update)/g,
    "composer update --no-interaction --prefer-dist",
  );
  // Go
  next = next.replace(/\brun: go vet/g, "run: go mod tidy && go vet");
  next = next.replace(/\brun: go test/g, "run: go mod tidy && go test");
  next = next.replace(/\brun: go build/g, "run: go mod tidy && go build");
  // Rust / .NET
  next = next.replace(/\s--locked\b/g, "");
  return next;
}

export async function patchCiWorkflowsForManifestDrift(opts: {
  token: string;
  repoFullName: string;
  repoFilePaths: string[];
  fileMap: Map<string, string>;
  add: (path: string, content: string) => void;
}): Promise<boolean> {
  if (!needsCiInstallRelax(opts.repoFilePaths, opts.fileMap.keys())) return false;

  for (const [path, content] of opts.fileMap.entries()) {
    if (!path.startsWith(".github/workflows/")) continue;
    const next = relaxCiInstallCommand(content);
    if (next !== content) opts.fileMap.set(path, next);
  }

  for (const wfPath of opts.repoFilePaths) {
    if (!wfPath.startsWith(".github/workflows/") || !/\.ya?ml$/i.test(wfPath)) continue;
    if (opts.fileMap.has(wfPath)) continue;
    const current = await fetchRepoFile(opts.token, opts.repoFullName, wfPath);
    if (!current) continue;
    const next = relaxCiInstallCommand(current);
    if (next === current) continue;
    opts.add(wfPath, next);
  }

  return true;
}

const DETERMINISTIC_CI_PATCH_SIGNATURES = [
  "lockfile",
  "corepack-yarn",
  "playwright-browsers",
  "workflow-expression-syntax",
] as const;

export function isDeterministicCiPatch(errorSignature: string): boolean {
  return DETERMINISTIC_CI_PATCH_SIGNATURES.some((s) => errorSignature.includes(s));
}

export function isLockfileCiError(log: string): boolean {
  const l = log.toLowerCase();
  return (
    (/(lockfile|lock file|package-lock|gemfile\.lock|composer\.lock|cargo\.lock|go\.sum|poetry\.lock|pipfile\.lock)/.test(
      l,
    ) &&
      /(out of sync|not in sync|outdated|missing|does not match|not found)/.test(l)) ||
    (/npm ci/.test(l) && /(lockfile|lock file|package-lock|eusage|missing:)/.test(l)) ||
    (/composer install/.test(l) && /lock file|composer\.lock/i.test(l)) ||
    (/bundle install/.test(l) && /gemfile\.lock|could not find gem/i.test(l)) ||
    (/go mod/.test(l) && /go\.sum|missing go\.sum/i.test(l)) ||
    (/cargo build|cargo test/.test(l) && /cargo\.lock/i.test(l))
  );
}

const CI_WORKFLOW_CANDIDATES = [
  ".github/workflows/ci.yml",
  ".github/workflows/main.yml",
  ".github/workflows/test.yml",
  ".github/workflows/build.yml",
];

async function listWorkflowFiles(
  token: string,
  repoFullName: string,
  ref: string,
): Promise<string[]> {
  const res = await fetch(
    `${GITHUB_API}/repos/${repoFullName}/contents/.github/workflows?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "LaunchReadyy/1.0",
      },
    },
  );
  if (!res.ok) return CI_WORKFLOW_CANDIDATES;
  const data = (await res.json()) as Array<{ type?: string; name?: string }>;
  if (!Array.isArray(data)) return CI_WORKFLOW_CANDIDATES;
  const paths = data
    .filter((f) => f.type === "file" && /\.ya?ml$/i.test(f.name ?? ""))
    .map((f) => `.github/workflows/${f.name}`);
  return paths.length > 0 ? paths : CI_WORKFLOW_CANDIDATES;
}

export async function ensureCiWorkflowInRecords(
  records: GeneratedFileRecord[],
  token: string,
  repoFullName: string,
  branch: string,
): Promise<GeneratedFileRecord[]> {
  const paths = records.some((r) => r.path.startsWith(".github/workflows/"))
    ? records.filter((r) => r.path.startsWith(".github/workflows/")).map((r) => r.path)
    : await listWorkflowFiles(token, repoFullName, branch);

  const byPath = new Map(records.map((r) => [r.path, r]));
  for (const path of paths) {
    const live = await fetchRepoFile(token, repoFullName, path, branch);
    if (live) {
      byPath.set(path, { path, content: live, hash: hashFileContent(live) });
    }
  }
  const workflowPaths = new Set(paths);
  const rest = records.filter((r) => !r.path.startsWith(".github/workflows/"));
  const workflows = [...byPath.values()].filter((r) => workflowPaths.has(r.path));
  return workflows.length > 0 ? [...rest, ...workflows] : records;
}

function buildLockfileCiPatch(records: GeneratedFileRecord[]): PatternMatchResult | null {
  const patch = patchCiWorkflow(records, relaxCiInstallCommand);
  if (!patch) return null;
  return {
    errorSignature: "npm-ci-lockfile-sync",
    rootCause:
      "Lock file out of sync with package.json — we'll patch CI to use npm install until the lockfile is updated",
    resolutionType: "patch",
    patch,
    suggestedTier: 1,
    checklist: [
      "Optional: run npm install locally and commit package-lock.json for stricter npm ci",
    ],
  };
}

export function buildRecoveryFileSet(
  records: GeneratedFileRecord[],
  patch?: PatchSuggestion,
): { path: string; content: string }[] {
  const byPath = new Map<string, string>();
  for (const r of records) {
    byPath.set(r.path.replace(/^\/+/, ""), r.content);
  }
  if (patch) {
    byPath.set(patch.path.replace(/^\/+/, ""), patch.content);
  }
  for (const [path, content] of [...byPath.entries()]) {
    if (!path.startsWith(".github/workflows/")) continue;
    const next = relaxCiInstallCommand(content);
    if (next !== content) byPath.set(path, next);
  }
  return [...byPath.entries()].map(([path, content]) => ({ path, content }));
}

export async function gitBranchExists(
  token: string,
  repoFullName: string,
  branch: string,
): Promise<boolean> {
  const res = await fetch(
    `${GITHUB_API}/repos/${repoFullName}/git/ref/heads/${encodeURIComponent(branch)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "LaunchReadyy/1.0",
      },
    },
  );
  return res.ok;
}

export async function fetchRepoFile(
  token: string,
  repoFullName: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  const encoded = githubContentsPath(path);
  const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await fetch(`${GITHUB_API}/repos/${repoFullName}/contents/${encoded}${refParam}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "LaunchReadyy/1.0",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { content?: string; encoding?: string };
  if (!data.content || data.encoding !== "base64") return null;
  return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
}

function addCorepackStep(content: string): string {
  if (content.includes("corepack enable")) return content;
  const marker = "      - name: Install dependencies";
  const step = `      - if: steps.pm.outputs.berry == 'true'
        name: Enable Corepack
        run: corepack enable

`;
  if (content.includes(marker)) {
    return content.replace(marker, step + marker);
  }
  return content;
}

function addPlaywrightInstallStep(content: string): string {
  if (content.includes("playwright install")) return content;
  const marker = "      - name: Test";
  const step = `      - name: Install Playwright browsers
        run: npx playwright install --with-deps

`;
  if (content.includes(marker)) {
    return content.replace(marker, step + marker);
  }
  return content;
}

function patchCiWorkflow(
  records: GeneratedFileRecord[],
  transform: (content: string) => string,
): PatchSuggestion | undefined {
  const ci = records.find((r) => r.path.startsWith(".github/workflows/"));
  if (!ci) return undefined;
  const content = transform(ci.content);
  if (content === ci.content) return undefined;
  return { path: ci.path, content };
}

/** Source files named in a log — `src/x.ts`, `app/y.tsx:12:3`, `lib/z.py`. */
const SOURCE_PATH_RE = /(?:^|[\s"'(])((?:\.\/)?(?:[\w.-]+\/)+[\w.-]+\.\w{1,5})(?=[\s:")']|$)/gm;

/**
 * Files a log blames that we did not write.
 *
 * The point is evidence. A failure is only called the user's when we can *name* the files and
 * show none of them is ours — otherwise we say "unknown" and diagnose. Deps and build output are
 * excluded because a stack frame through node_modules says nothing about whose code is at fault.
 */
export function foreignFailingPaths(errorLog: string, ourPaths: string[]): string[] {
  const ours = new Set(ourPaths.map((p) => p.replace(/^\.?\/+/, "")));
  const seen = new Set<string>();
  for (const m of errorLog.matchAll(SOURCE_PATH_RE)) {
    const path = m[1].replace(/^\.?\/+/, "");
    if (ours.has(path)) continue;
    if (/^(node_modules|dist|build|\.next|out|coverage|vendor|target)\//.test(path)) continue;
    seen.add(path);
  }
  return [...seen];
}

/**
 * True when a log looks like the user's own test suite failing, on files we never touched.
 * Reported rather than repaired — that is a real readiness gap, which is the product's job to
 * surface, not something to paper over so a check turns green.
 */
export function isForeignTestFailure(errorLog: string, ourPaths: string[]): string[] | null {
  const looksLikeTests =
    /\d+\s+(?:tests?|specs?|examples?)\s+failed|FAIL\s+\S|✕|✗|AssertionError|Expected .* received|test suite failed/i.test(
      errorLog,
    );
  if (!looksLikeTests) return null;
  const foreign = foreignFailingPaths(errorLog, ourPaths);
  // Naming nothing is not evidence. Say nothing rather than guess.
  if (foreign.length === 0) return null;
  // If any of our own files is implicated, treat it as ours and keep repairing.
  if (ourPaths.some((p) => errorLog.includes(p))) return null;
  return foreign.slice(0, 8);
}

export function matchErrorPattern(
  errorLog: string,
  generatedRecords: GeneratedFileRecord[],
): PatternMatchResult | null {
  const normalized = errorLog.slice(0, MAX_ERROR_LOG);

  // Checked before the repair table: a failing suite in the user's own files must never be
  // "fixed" by rewriting one of our config files until the check goes green.
  const foreign = isForeignTestFailure(
    normalized,
    generatedRecords.map((r) => r.path),
  );
  if (foreign) {
    return {
      errorSignature: "foreign-test-failure",
      rootCause: `Your test suite is failing in ${foreign.length === 1 ? "a file" : "files"} we didn't touch: ${foreign.join(", ")}. That's a real gap in the repo rather than a problem with this PR.`,
      resolutionType: "manual",
      checklist: foreign.map((p) => `Review the failing assertions in ${p}`),
      suggestedTier: 3,
    };
  }

  for (const pattern of ERROR_PATTERNS) {
    if (!pattern.test(normalized)) continue;
    const patch = pattern.patch?.(generatedRecords, normalized);
    return {
      errorSignature: pattern.id,
      rootCause: pattern.rootCause,
      resolutionType: patch ? "patch" : pattern.resolutionType,
      checklist: pattern.checklist,
      patch,
      suggestedTier: pattern.suggestedTier,
    };
  }
  return null;
}

/** Attribution for a matched signature — drives whether the loop repairs or reports. */
export function scopeForSignature(errorSignature: string): FailureScope {
  if (errorSignature === "foreign-test-failure") return "theirs";
  return ERROR_PATTERNS.find((p) => p.id === errorSignature)?.scope ?? "unknown";
}

/**
 * Plain-English cause for a stored signature, for reading a past attempt back.
 *
 * The attempt timeline replays history from `fix_recoveries`, where only the signature id is
 * kept — the log itself is far too large to store per row and far too noisy to show. Looking the
 * wording up here means the timeline says "your lint script runs Prettier over the whole repo"
 * rather than "prettier-check-our-file", which is the difference between an explanation and a
 * database key.
 */
export function rootCauseForSignature(errorSignature: string): string {
  if (errorSignature === "foreign-test-failure") {
    return "Tests failed in files this PR didn't touch — a gap in the repo rather than a problem with the fix.";
  }
  return (
    ERROR_PATTERNS.find((p) => p.id === errorSignature)?.rootCause ??
    "CI failed for a reason we don't recognise yet."
  );
}

export function resolveOffer(
  tier: RecoveryTier,
  drift: DriftLevel,
  hasPatch: boolean,
  escalated: boolean,
  errorSignature?: string,
): { resolutionType: ResolutionType; patchOffer: "auto" | "suggested" | null } {
  const deterministic = errorSignature ? isDeterministicCiPatch(errorSignature) : false;
  if (deterministic && hasPatch) {
    return {
      resolutionType: "suggested",
      patchOffer: "auto",
    };
  }
  if (escalated) return { resolutionType: "escalated", patchOffer: null };
  const lockfileFix = Boolean(errorSignature?.includes("lockfile"));
  if (lockfileFix && hasPatch) {
    return {
      resolutionType: "suggested",
      patchOffer: drift === "pristine" ? "auto" : "suggested",
    };
  }
  if (tier === 2) return { resolutionType: "checklist", patchOffer: null };
  if (tier === 3) return { resolutionType: "diagnosis", patchOffer: null };
  if (tier === 1 && drift === "heavy") return { resolutionType: "diagnosis", patchOffer: null };
  if (tier === 1 && drift === "moderate" && hasPatch) {
    return { resolutionType: "suggested", patchOffer: "suggested" };
  }
  if (tier === 1 && drift === "pristine" && hasPatch) {
    return { resolutionType: "suggested", patchOffer: "auto" };
  }
  return { resolutionType: "diagnosis", patchOffer: null };
}

export async function checkDrift(
  token: string,
  repoFullName: string,
  branch: string,
  record: GeneratedFileRecord,
): Promise<{ drift: DriftLevel; similarity: number; current: string | null }> {
  const current = await fetchRepoFile(token, repoFullName, record.path, branch);
  if (current === null) return { drift: "heavy", similarity: 0, current: null };
  if (hashFileContent(current) === record.hash) {
    return { drift: "pristine", similarity: 1, current };
  }
  const original = record.content;
  if (!original) return { drift: "heavy", similarity: 0, current };
  const similarity = contentSimilarity(original, current);
  return { drift: driftFromSimilarity(similarity), similarity, current };
}

function parseAiRecoveryResponse(text: string): AiRecoveryResponse | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as AiRecoveryResponse;
    if (!parsed.rootCause || !parsed.resolutionType) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function aiDiagnoseRecovery(opts: {
  errorLog: string;
  generatedRecords: GeneratedFileRecord[];
  failingPath: string | null;
  tier: RecoveryTier;
  fixIds: string[];
}): Promise<PatternMatchResult> {
  const fileSnippets = opts.generatedRecords
    .slice(0, 5)
    .map((r) => `--- ${r.path} ---\n${r.content.slice(0, 1500)}`)
    .join("\n\n");

  const prompt = `You are diagnosing a CI/build failure for a LaunchReadyy-generated fix PR.

Fix IDs: ${opts.fixIds.join(", ")}
Tier: ${opts.tier} (1=config auto-fix eligible, 2=checklist only, 3=manual only)
Failing file hint: ${opts.failingPath ?? "unknown"}

Error log (trimmed):
${opts.errorLog.slice(0, MAX_AI_LOG)}

Generated files:
${fileSnippets}

Rules for patchContent when patching a GitHub Actions workflow (.github/workflows/*.yml):
- NEVER use optional chaining (?.) — GitHub Actions expressions do not support JavaScript syntax
- NEVER use nullish coalescing (??) inside ${{}} expressions
- Node versions must be plain strings like '20', not dynamic fromJson expressions
- Use simple shell conditionals in "run:" steps for any dynamic logic
- For lockfile / npm ci sync errors: prefer resolutionType "patch" — change npm ci to npm install (or relax frozen-lockfile flags) in the workflow; do NOT tell the user to delete package-lock.json

Respond with ONLY valid JSON:
{
  "rootCause": "one sentence",
  "resolutionType": "patch" | "checklist" | "manual",
  "checklist": ["step 1", "step 2"],
  "patchPath": "path/if patch",
  "patchContent": "full file content if patch"
}`;

  const text = await aiService.fix(prompt, {
    taskType: "fix_recovery",
    maxTokens: 2048,
  });

  const parsed = parseAiRecoveryResponse(text);
  if (!parsed) {
    return {
      errorSignature: "ai",
      rootCause: "Could not determine root cause — review the error log manually",
      resolutionType: "manual",
      checklist: ["Review the CI log on GitHub", "Check if generated config files were modified"],
    };
  }

  const patch =
    parsed.resolutionType === "patch" && parsed.patchPath && parsed.patchContent
      ? { path: parsed.patchPath, content: parsed.patchContent }
      : undefined;

  return {
    errorSignature: "ai",
    rootCause: parsed.rootCause,
    resolutionType: parsed.resolutionType,
    checklist: parsed.checklist,
    patch,
  };
}

export async function runDiagnosis(opts: {
  errorLog: string;
  generatedRecords: GeneratedFileRecord[];
  fixIds: string[];
  branchName: string;
  attemptCount: number;
  token: string;
  repoFullName: string;
}): Promise<Omit<DiagnosisOutput, "recoveryId">> {
  const log = opts.errorLog.slice(0, MAX_ERROR_LOG);
  const escalated = opts.attemptCount > MAX_RECOVERY_ATTEMPTS;

  const generatedPaths = opts.generatedRecords.map((r) => r.path);
  const failingPath = extractFailingPath(log, generatedPaths);

  let tier: RecoveryTier = failingPath ? classifyTier(failingPath) : 3;

  let driftLevel: DriftLevel = "heavy";
  let driftMessage: string | undefined;
  if (failingPath) {
    const record = opts.generatedRecords.find((r) => r.path === failingPath);
    if (record) {
      const drift = await checkDrift(opts.token, opts.repoFullName, opts.branchName, record);
      driftLevel = drift.drift;
      if (drift.drift === "heavy") {
        driftMessage =
          "This file has been modified since we generated it — we won't auto-change it";
      }
    }
  } else if (opts.generatedRecords.length > 0) {
    const drift = await checkDrift(
      opts.token,
      opts.repoFullName,
      opts.branchName,
      opts.generatedRecords[0],
    );
    driftLevel = drift.drift;
  }

  const records = await ensureCiWorkflowInRecords(
    opts.generatedRecords,
    opts.token,
    opts.repoFullName,
    opts.branchName,
  );

  let match = matchErrorPattern(log, records);
  if (!match && isLockfileCiError(log)) {
    match = buildLockfileCiPatch(records);
  }
  if (!match) {
    match = await aiDiagnoseRecovery({
      errorLog: log,
      generatedRecords: records,
      failingPath,
      tier,
      fixIds: opts.fixIds,
    });
    if (match.resolutionType === "checklist" && isLockfileCiError(log)) {
      const lockfilePatch = buildLockfileCiPatch(records);
      if (lockfilePatch) match = lockfilePatch;
    }
  }

  if (match.suggestedTier) tier = match.suggestedTier;

  if (match.resolutionType === "checklist") {
    return {
      rootCause: match.rootCause,
      errorSignature: match.errorSignature,
      tier,
      driftLevel,
      resolutionType: escalated ? "escalated" : "checklist",
      attemptCount: opts.attemptCount,
      aiEffort: 0,
      patchOffer: null,
      checklist: escalated
        ? [
            "We've tried twice — here's our diagnosis, please fix manually or contact support.",
            match.rootCause,
            ...(match.checklist ?? []),
          ]
        : match.checklist,
      driftMessage,
      failingPath: failingPath ?? undefined,
    };
  }

  if (match.resolutionType === "manual") {
    return {
      rootCause: match.rootCause,
      errorSignature: match.errorSignature,
      tier: 3,
      driftLevel,
      resolutionType: escalated ? "escalated" : "diagnosis",
      attemptCount: opts.attemptCount,
      aiEffort: 0,
      patchOffer: null,
      checklist: match.checklist,
      driftMessage,
      failingPath: failingPath ?? undefined,
    };
  }

  const hasPatch = Boolean(match.patch);
  const { resolutionType, patchOffer } = resolveOffer(
    tier,
    driftLevel,
    hasPatch,
    escalated,
    match.errorSignature,
  );

  let checklist = match.checklist;
  if (
    resolutionType === "escalated" &&
    !(hasPatch && isDeterministicCiPatch(match.errorSignature))
  ) {
    return {
      rootCause: match.rootCause,
      errorSignature: match.errorSignature,
      tier,
      driftLevel,
      resolutionType: "escalated",
      attemptCount: opts.attemptCount,
      aiEffort: 0,
      patchOffer: null,
      checklist: [
        "We've tried twice — here's our diagnosis, please fix manually or contact support.",
        match.rootCause,
        ...(match.checklist ?? []),
      ],
      driftMessage,
      failingPath: failingPath ?? undefined,
    };
  }

  if (resolutionType === "checklist" && !checklist?.length) {
    checklist = match.checklist ?? ["Review the error and apply the suggested fix manually"];
  }

  const aiEffort = patchOffer === "auto" || patchOffer === "suggested" ? RECOVERY_AI_EFFORT : 0;

  return {
    rootCause: match.rootCause,
    errorSignature: match.errorSignature,
    tier,
    driftLevel,
    resolutionType,
    attemptCount: opts.attemptCount,
    aiEffort,
    patchOffer,
    patch: hasPatch ? match.patch : undefined,
    checklist,
    driftMessage,
    failingPath: failingPath ?? undefined,
  };
}

export { MAX_ERROR_LOG, RECOVERY_AI_EFFORT, MAX_RECOVERY_ATTEMPTS };
