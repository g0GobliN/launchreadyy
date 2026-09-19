// Split from fix-executor.server.ts — behavior-preserving.

import { githubContentsPath, githubHeadRefPath } from "../github.server";
import { snapshotFile } from "../repo-snapshot.server";
import { isSafeRepoPath } from "./safe-paths";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_GQL = "https://api.github.com/graphql";

// ─── GitHub API helpers ───────────────────────────────────────────────────────

export function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "LaunchReadyy/1.0",
  };
}

export function gqlHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "LaunchReadyy/1.0",
  };
}

export async function gqlRequest<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(GITHUB_GQL, {
    method: "POST",
    headers: gqlHeaders(token),
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub GraphQL request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string; type?: string }>;
  };
  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("GitHub GraphQL returned no data");
  return json.data;
}

/**
 * Transient conditions worth a second attempt: a network-level failure (undici surfaces these
 * as a bare "fetch failed" with the real reason on `cause`), GitHub's secondary rate limiter,
 * or a 5xx. Anything else — 401, 403 on scopes, 404, 422 — is a real answer and retrying it
 * only delays the error the caller needs to see.
 */
function isRetriableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && err.message === "fetch failed");
}

const GH_GET_ATTEMPTS = 3;

/**
 * Read helper with bounded retry.
 *
 * Opening a PR makes several reads before it writes anything (repo metadata, base ref, base
 * commit). None of them were protected, so a single transient blip aborted the whole fix job —
 * observed in the launch verification run, where 5 of 14 languages failed with "fetch failed"
 * purely from issuing requests back-to-back, and every one of them succeeded on a retry.
 *
 * Retry is deliberately confined to GET. The write paths (`createCommitOnBranch`, tree/commit
 * creation, the Contents API) are not idempotent — replaying one can duplicate a commit — and
 * they already have a three-way fallback chain of their own.
 */
export async function ghGet<T>(token: string, path: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= GH_GET_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${GITHUB_API}${path}`, { headers: ghHeaders(token) });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const error = new Error(`GitHub GET ${path} → ${res.status}: ${text.slice(0, 300)}`);
        if (attempt < GH_GET_ATTEMPTS && isRetriableStatus(res.status)) {
          lastError = error;
          await delayBeforeRetry(attempt, res.headers.get("retry-after"));
          continue;
        }
        throw error;
      }
      return (await res.json()) as T;
    } catch (err) {
      if (attempt < GH_GET_ATTEMPTS && isNetworkError(err)) {
        lastError = err;
        await delayBeforeRetry(attempt, null);
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`GitHub GET ${path} failed`);
}

/** Honour `Retry-After` when GitHub sends one; otherwise exponential backoff (500ms, 1s). */
async function delayBeforeRetry(attempt: number, retryAfter: string | null): Promise<void> {
  const headerSeconds = retryAfter ? Number(retryAfter) : NaN;
  const ms =
    Number.isFinite(headerSeconds) && headerSeconds > 0
      ? Math.min(headerSeconds * 1000, 10_000)
      : 500 * 2 ** (attempt - 1);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function gitWriteHint(
  status: number,
  path: string,
  scopes: string | null,
  committedCount = 0,
): string {
  if (status !== 404) return "";
  if (!path.includes("/git/") && !path.includes("/contents/")) return "";
  const scopeNote = scopes ? ` OAuth scopes: ${scopes}.` : "";
  const hasRepo = scopes?.split(",").some((s) => s.trim() === "repo");

  // Git object APIs (blobs/trees/commits) returning 404 means the repository itself
  // was not found — not a path issue. Contents API 404 can also be a missing branch.
  const isGitObjectApi =
    path.includes("/git/blobs") || path.includes("/git/trees") || path.includes("/git/commits");
  if (isGitObjectApi) {
    return (
      " Repository not found or access was revoked — the repo may have been deleted, renamed," +
      ` or your token no longer has write access.${scopeNote}`
    );
  }

  if (hasRepo || committedCount > 0) {
    return (
      " GitHub rejected this write — the branch may not exist yet or a nested directory path is invalid." +
      scopeNote
    );
  }
  return (
    " This usually means your GitHub token lacks write access — sign out and reconnect " +
    `with the "repo" scope.${scopeNote}`
  );
}

export async function ghPost<T>(
  token: string,
  path: string,
  body: unknown,
  opts?: { committedCount?: number },
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const hint = gitWriteHint(
      res.status,
      path,
      res.headers.get("x-oauth-scopes"),
      opts?.committedCount,
    );
    throw new Error(`GitHub POST ${path} → ${res.status}: ${text.slice(0, 300)}${hint}`);
  }
  return res.json() as Promise<T>;
}

export async function ghPut<T>(
  token: string,
  path: string,
  body: unknown,
  opts?: { committedCount?: number },
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: "PUT",
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const hint = gitWriteHint(
      res.status,
      path,
      res.headers.get("x-oauth-scopes"),
      opts?.committedCount,
    );
    throw new Error(`GitHub PUT ${path} → ${res.status}: ${text.slice(0, 300)}${hint}`);
  }
  return res.json() as Promise<T>;
}

export async function ghPatch<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: "PATCH",
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub PATCH ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export function contentsApiPath(filePath: string): string {
  return githubContentsPath(filePath);
}

export function headRefPath(fullName: string, branchName: string): string {
  return githubHeadRefPath(fullName, branchName);
}

export async function ensureBranch(
  token: string,
  fullName: string,
  branchName: string,
  baseSha: string,
): Promise<void> {
  const refPath = headRefPath(fullName, branchName);
  const checkRes = await fetch(`${GITHUB_API}${refPath}`, { headers: ghHeaders(token) });
  if (checkRes.ok) return;
  if (checkRes.status !== 404) {
    const text = await checkRes.text().catch(() => "");
    throw new Error(
      `Cannot access branch ${branchName} on ${fullName} (${checkRes.status}): ${text.slice(0, 200)}`,
    );
  }

  // Create the branch; 422 means it already exists from a previous attempt — that's fine.
  const createRes = await fetch(`${GITHUB_API}/repos/${fullName}/git/refs`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
  });
  if (!createRes.ok && createRes.status !== 422) {
    const text = await createRes.text().catch(() => "");
    throw new Error(
      `Failed to create branch ${branchName} on ${fullName} (${createRes.status}): ${text.slice(0, 200)}`,
    );
  }

  const verify = await fetch(`${GITHUB_API}${refPath}`, { headers: ghHeaders(token) });
  if (!verify.ok) {
    throw new Error(
      `Failed to create branch ${branchName} on ${fullName} — cannot commit files without it.`,
    );
  }
}

// ─── GraphQL commit (primary path) ───────────────────────────────────────────
// Uses createCommitOnBranch which goes through a different GitHub infrastructure
// path than the REST git objects API — works even when /git/trees returns 404.

export async function getRepoNodeId(token: string, owner: string, name: string): Promise<string> {
  const data = await gqlRequest<{ repository: { id: string } }>(
    token,
    `query($owner: String!, $name: String!) {
       repository(owner: $owner, name: $name) { id }
     }`,
    { owner, name },
  );
  return data.repository.id;
}

export async function ensureBranchGQL(
  token: string,
  repoId: string,
  branchName: string,
  baseSha: string,
): Promise<void> {
  const data = await gqlRequest<{
    createRef?: { ref?: { name: string } };
    errors?: Array<{ message: string; type?: string }>;
  }>(
    token,
    `mutation($repoId: ID!, $name: String!, $oid: GitObjectID!) {
       createRef(input: { repositoryId: $repoId, name: $name, oid: $oid }) {
         ref { name }
       }
     }`,
    { repoId, name: `refs/heads/${branchName}`, oid: baseSha },
  ).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    // "already exists" is fine — branch created in a prior attempt
    if (msg.includes("already exists") || msg.includes("UNPROCESSABLE")) return null;
    throw err;
  });
  void data;
}

export async function getBranchHeadOid(
  token: string,
  owner: string,
  name: string,
  branchName: string,
): Promise<string | null> {
  try {
    const data = await gqlRequest<{
      repository: { ref: { target: { oid: string } } | null };
    }>(
      token,
      `query($owner: String!, $name: String!, $ref: String!) {
         repository(owner: $owner, name: $name) {
           ref(qualifiedName: $ref) { target { oid } }
         }
       }`,
      { owner, name, ref: `refs/heads/${branchName}` },
    );
    return data.repository.ref?.target.oid ?? null;
  } catch {
    return null;
  }
}

/**
 * Last gate before bytes reach a user's repository.
 *
 * Throws rather than filtering: by this point the file list has been assembled, reviewed
 * and approved, so an unsafe path means something upstream is wrong and a partial commit
 * would be worse than a failed one. Producer-level filtering happens in safe-paths.ts.
 */
function assertCommittablePaths(files: { path: string }[]): void {
  for (const file of files) {
    if (!isSafeRepoPath(file.path)) {
      throw new Error(
        `Refusing to commit unsafe repository path: ${String(file.path).slice(0, 200)}`,
      );
    }
  }
}

export async function createCommitOnBranchGQL(
  token: string,
  owner: string,
  repoName: string,
  branchName: string,
  headOid: string,
  files: { path: string; content: string }[],
  message: string,
): Promise<void> {
  assertCommittablePaths(files);
  const additions = files.map((f) => ({
    path: f.path,
    contents: Buffer.from(f.content, "utf8").toString("base64"),
  }));
  await gqlRequest<{ createCommitOnBranch: { commit: { oid: string } } }>(
    token,
    `mutation($input: CreateCommitOnBranchInput!) {
       createCommitOnBranch(input: $input) {
         commit { oid }
       }
     }`,
    {
      input: {
        branch: { repositoryNameWithOwner: `${owner}/${repoName}`, branchName },
        message: { headline: message },
        fileChanges: { additions },
        expectedHeadOid: headOid,
      },
    },
  );
}

// ─── Git Trees API (REST fallback) ───────────────────────────────────────────

export async function createTree(
  token: string,
  fullName: string,
  baseTreeSha: string,
  files: { path: string; content: string }[],
): Promise<string> {
  assertCommittablePaths(files);
  // Pass content directly — GitHub creates blobs internally, no separate blob-creation round-trip needed.
  const entries = files.map((f) => ({
    path: f.path,
    mode: "100644" as const,
    type: "blob" as const,
    content: f.content,
  }));
  const data = await ghPost<{ sha: string }>(token, `/repos/${fullName}/git/trees`, {
    base_tree: baseTreeSha,
    tree: entries,
  });
  return data.sha;
}

export async function createCommit(
  token: string,
  fullName: string,
  message: string,
  treeSha: string,
  parentSha: string,
): Promise<string> {
  const data = await ghPost<{ sha: string }>(token, `/repos/${fullName}/git/commits`, {
    message,
    tree: treeSha,
    parents: [parentSha],
  });
  return data.sha;
}

export async function createOrUpdateBranch(
  token: string,
  fullName: string,
  branchName: string,
  commitSha: string,
): Promise<void> {
  const refPath = headRefPath(fullName, branchName);
  const checkRes = await fetch(`${GITHUB_API}${refPath}`, { headers: ghHeaders(token) });
  if (checkRes.ok) {
    await ghPatch(token, refPath, { sha: commitSha, force: true });
  } else {
    await ghPost(token, `/repos/${fullName}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: commitSha,
    });
  }
}

/** Contents API fallback — one commit per file; used only if Trees API fails. */
export async function commitFilesViaContentsApi(
  token: string,
  fullName: string,
  branchName: string,
  files: { path: string; content: string }[],
  commitMessage: string,
): Promise<void> {
  let committedCount = 0;
  for (const file of files) {
    // Leading slashes are stripped first — this path shape has always been tolerated here,
    // so validate what actually gets written rather than the raw input.
    const path = file.path.replace(/^\/+/, "");
    assertCommittablePaths([{ path }]);
    const apiPath = `/repos/${fullName}/contents/${contentsApiPath(path)}`;

    let sha: string | undefined;
    try {
      const existing = await ghGet<{ sha: string }>(
        token,
        `${apiPath}?ref=${encodeURIComponent(branchName)}`,
      );
      sha = existing.sha;
    } catch {
      // new file
    }

    try {
      await ghPut(
        token,
        apiPath,
        {
          message: commitMessage,
          content: Buffer.from(file.content, "utf8").toString("base64"),
          branch: branchName,
          ...(sha ? { sha } : {}),
        },
        { committedCount },
      );
      committedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404") && msg.includes("/contents/")) {
        const partial =
          committedCount > 0
            ? ` Branch ${branchName} may have a partial commit (${committedCount} file(s) written).`
            : "";
        throw new Error(`Failed writing ${path} on branch ${branchName}.${partial} ${msg}`);
      }
      throw err;
    }
  }
}

export async function fetchFileContentViaApi(
  token: string,
  fullName: string,
  path: string,
): Promise<string | null> {
  try {
    const data = await ghGet<{ content?: string; encoding?: string }>(
      token,
      `/repos/${fullName}/contents/${contentsApiPath(path)}`,
    );
    if (!data.content || data.encoding !== "base64") return null;
    return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
  } catch {
    return null;
  }
}

export async function fetchFileContent(
  token: string,
  fullName: string,
  path: string,
): Promise<string | null> {
  return snapshotFile(token, fullName, path, fetchFileContentViaApi);
}

export async function openPullRequest(
  token: string,
  fullName: string,
  head: string,
  base: string,
  title: string,
  body: string,
): Promise<{ number: number; html_url: string }> {
  const owner = fullName.split("/")[0];
  const existing = await ghGet<Array<{ number: number; html_url: string }>>(
    token,
    `/repos/${fullName}/pulls?head=${encodeURIComponent(`${owner}:${head}`)}&state=open`,
  );
  if (existing.length > 0) return existing[0];
  return ghPost(token, `/repos/${fullName}/pulls`, { title, body, head, base });
}

// ─── Package.json patching ────────────────────────────────────────────────────

export interface PkgMods {
  scripts: Record<string, string>;
  deps: Record<string, string>;
  devDeps: Record<string, string>;
}

/**
 * `appDir` targets the app's own manifest. Scripts and dependencies were derived from the app's
 * `package.json` (see `buildProjectContext`), so writing them into a workspace *root* manifest
 * would add an app's devDependency to the coordinator and leave the app itself unchanged.
 */
export async function patchPackageJson(
  token: string,
  fullName: string,
  mods: PkgMods,
  appDir: string | null = null,
): Promise<string | null> {
  const hasChanges =
    Object.keys(mods.scripts).length +
      Object.keys(mods.deps).length +
      Object.keys(mods.devDeps).length >
    0;
  if (!hasChanges) return null;

  const content = await fetchFileContent(
    token,
    fullName,
    appDir ? `${appDir}/package.json` : "package.json",
  );
  if (!content) return null;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (Object.keys(mods.scripts).length) {
    pkg.scripts = {
      ...((pkg.scripts as Record<string, string> | undefined) ?? {}),
      ...mods.scripts,
    };
  }
  if (Object.keys(mods.deps).length) {
    pkg.dependencies = {
      ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
      ...mods.deps,
    };
  }
  if (Object.keys(mods.devDeps).length) {
    pkg.devDependencies = {
      ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
      ...mods.devDeps,
    };
  }

  return JSON.stringify(pkg, null, 2) + "\n";
}

// ─── Source file patching ─────────────────────────────────────────────────────

// Inserts importLines after the last existing `import` statement.
// Then for each usageLines entry, inserts lines after the first line containing `after`.
/** Lines that may precede the import block without ending it. */
function isPrologueLine(trimmed: string): boolean {
  return (
    trimmed === "" ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("#!") ||
    /^["']use \w+["'];?$/.test(trimmed)
  );
}

/**
 * Where new import lines belong: the index to splice at, i.e. one past the last line of the
 * leading import block.
 *
 * Counting braces matters. Scanning for the last line that merely *starts with* `import ` picked
 * the opening line of a multi-line import — so for
 *
 *     import express from "express";
 *     import {
 *       json,
 *     } from "body-parser";
 *
 * the new import landed between `import {` and `json,`, splitting a statement in half and leaving
 * the user's entry point syntactically invalid. Brackets still balanced afterwards, so
 * validateBalancedSyntax passed it and the broken file shipped in the PR.
 *
 * Only the leading block is considered: a line further down that starts with `import ` is far more
 * likely to sit inside a template literal or a comment than to be a real statement.
 */
export function importInsertionIndex(lines: string[]): number {
  let lastImportEnd = -1;
  let prologueEnd = 0;
  let depth = 0;
  let inImport = false;

  const countBraces = (line: string) => {
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
  };
  // A statement is finished once its braces are closed and it has named a source (or ended).
  const statementEnds = (line: string, trimmed: string) =>
    depth <= 0 &&
    (/\bfrom\s*['"]/.test(line) || /^import\s*['"]/.test(trimmed) || /;\s*$/.test(line));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (inImport) {
      countBraces(line);
      if (statementEnds(line, trimmed)) {
        lastImportEnd = i;
        inImport = false;
        depth = 0;
      }
      continue;
    }

    if (isPrologueLine(trimmed)) {
      // Track the prologue so a file with no imports still gets them below its shebang.
      if (trimmed.startsWith("#!") || /^["']use \w+["'];?$/.test(trimmed)) prologueEnd = i + 1;
      continue;
    }

    if (line.startsWith("import ")) {
      depth = 0;
      countBraces(line);
      if (statementEnds(line, trimmed)) lastImportEnd = i;
      else inImport = true;
      continue;
    }

    break; // first real statement — the import block is over
  }

  return lastImportEnd >= 0 ? lastImportEnd + 1 : prologueEnd;
}

/** Where an Express app is constructed, and what the user called it.
 *
 * Callers used to anchor middleware on the literal string `"const app = express()"`. Real repos
 * do not all write that: `var app = express();` (stripe-server), `let app`, and TypeScript's
 * `const app: Application = express();` all miss. A miss was silent — the import was still added,
 * the usage line was not, and the caller reported "verified" for a fix that wired nothing. For a
 * security fix that is the worst possible failure: the PR looks complete and the app is unchanged.
 *
 * Returns the exact declaration line to anchor on plus the identifier the user chose, so generated
 * calls reference their variable rather than assuming `app`.
 */
export function findExpressApp(lines: string[]): { line: string; varName: string } | null {
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*express\s*\(\s*\)/;
  for (const line of lines) {
    const m = re.exec(line);
    if (m?.[1]) return { line, varName: m[1] };
  }
  return null;
}

export interface PatchedSource {
  content: string;
  /** Anchors that matched nothing, so their lines were never inserted. Non-empty means the patch
   * is incomplete and callers must not report success. */
  missed: string[];
}

export async function patchSourceFile(
  token: string,
  fullName: string,
  filePath: string,
  importLines: string[],
  usageLines: { after: string; lines: string[] }[],
): Promise<PatchedSource | null> {
  const content = await fetchFileContent(token, fullName, filePath);
  if (!content) return null;

  let lines = content.split("\n");

  if (importLines.length) {
    const at = importInsertionIndex(lines);
    lines = [...lines.slice(0, at), ...importLines, ...lines.slice(at)];
  }

  const missed: string[] = [];
  for (const { after, lines: toAdd } of usageLines) {
    const idx = lines.findIndex((l) => l.includes(after));
    if (idx !== -1) {
      lines = [...lines.slice(0, idx + 1), ...toAdd, ...lines.slice(idx + 1)];
    } else {
      missed.push(after);
    }
  }

  return { content: lines.join("\n"), missed };
}
