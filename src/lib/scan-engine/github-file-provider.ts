import {
  getRepoSnapshot,
  peekRepoSnapshot,
  snapshotFile,
  warmRepoSnapshot,
} from "../repo-snapshot.server";
import type { FileProvider, FileProviderMeta, RichFileProvider } from "./file-provider";

const GITHUB_API = "https://api.github.com";

async function ghFetch(token: string, path: string): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "LaunchReadyy/1.0",
    },
  });
}

async function fetchFileContentViaApi(
  token: string,
  fullName: string,
  filePath: string,
): Promise<string | null> {
  const res = await ghFetch(token, `/repos/${fullName}/contents/${filePath}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { content?: string; encoding?: string };
  if (!data.content || data.encoding !== "base64") return null;
  return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
}

interface TreeNode {
  path: string;
  type: string;
  size?: number;
  sha?: string;
}

export interface GitHubFileProviderOptions {
  /**
   * Don't block on the repo tarball.
   *
   * The tarball is the right call for the scanner, which reads hundreds of files. A caller that
   * reads a handful — the sandbox job needs the file list, `package.json` and maybe `.nvmrc` to
   * plan its build — would otherwise sit through a whole-repo download first, which on a slow
   * connection is ~90 seconds of a run that looks frozen. With this set, the file list comes from
   * the git tree, individual reads go through the contents API until the tarball arrives, and the
   * download still runs in the background for whatever bulk read comes later.
   */
  deferSnapshot?: boolean;
}

export class GitHubFileProvider implements RichFileProvider {
  treeTruncated = false;
  private readonly sizes = new Map<string, number>();
  private readonly hashes = new Map<string, string>();
  private rootTreeSha: string | undefined;
  private paths: string[] | null = null;
  private readonly deferSnapshot: boolean;

  constructor(
    private readonly token: string,
    private readonly fullName: string,
    private readonly defaultBranch: string,
    opts: GitHubFileProviderOptions = {},
  ) {
    this.deferSnapshot = opts.deferSnapshot === true;
  }

  async listFiles(): Promise<string[]> {
    if (this.paths) return this.paths;

    const treePromise = ghFetch(
      this.token,
      `/repos/${this.fullName}/git/trees/${this.defaultBranch}?recursive=1`,
    );
    // Deferred: kick the download off but keep going. Otherwise the tarball is what we answer from.
    const snapPromise = this.deferSnapshot
      ? null
      : getRepoSnapshot(this.token, this.fullName).catch(() => null);
    if (this.deferSnapshot) warmRepoSnapshot(this.token, this.fullName);

    const treeRes = await treePromise;
    let treePaths: string[] | null = null;

    if (treeRes.ok) {
      const data = (await treeRes.json()) as {
        sha?: string;
        tree: TreeNode[];
        truncated?: boolean;
      };
      this.treeTruncated = data.truncated === true;
      this.rootTreeSha = data.sha;
      const blobs: string[] = [];
      for (const n of data.tree) {
        if (n.type !== "blob") continue;
        blobs.push(n.path);
        if (n.size != null) this.sizes.set(n.path, n.size);
        if (n.sha) this.hashes.set(n.path, n.sha);
      }
      // A truncated tree is missing paths, so it cannot stand in for the tarball's listing.
      if (!this.treeTruncated) treePaths = blobs;
    }

    if (this.deferSnapshot && treePaths) {
      this.paths = treePaths;
      return this.paths;
    }

    const snap = await (snapPromise ?? getRepoSnapshot(this.token, this.fullName));
    this.paths = snap?.filePaths ?? treePaths ?? [];
    return this.paths;
  }

  async readFile(path: string): Promise<string | null> {
    if (this.deferSnapshot) {
      // Use the tarball once it has landed; until then one file is one cheap request.
      const ready = peekRepoSnapshot(this.fullName);
      if (ready) return ready.files.get(path) ?? null;
      return fetchFileContentViaApi(this.token, this.fullName, path);
    }
    return snapshotFile(this.token, this.fullName, path, fetchFileContentViaApi);
  }

  fileSize(path: string): number | undefined {
    return this.sizes.get(path);
  }

  /** Git blob SHA per path — the content hash the incremental scanner (Phase 3) diffs against. */
  fileHashes(): Record<string, string> {
    return Object.fromEntries(this.hashes);
  }

  /** The tree SHA identifying overall repo state at scan time (Phase 3). */
  treeSha(): string | undefined {
    return this.rootTreeSha;
  }
}

/** @deprecated prefer GitHubFileProvider — kept for tests that import a plain FileProvider factory. */
export function createGitHubFileProvider(
  token: string,
  fullName: string,
  defaultBranch: string,
): FileProvider {
  return new GitHubFileProvider(token, fullName, defaultBranch);
}
