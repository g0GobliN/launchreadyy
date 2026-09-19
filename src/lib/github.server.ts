const GITHUB_API = "https://api.github.com";

export class GitHubApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  private: boolean;
  owner: { login: string };
  default_branch: string;
  visibility: string;
}

export async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "LaunchReadyy/1.0",
    },
  });
  if (!res.ok) throw new Error("Failed to fetch GitHub user");
  return res.json() as Promise<GitHubUser>;
}

export async function fetchGitHubRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${GITHUB_API}/user/repos?per_page=100&sort=updated&page=${page}&affiliation=owner,collaborator`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "LaunchReadyy/1.0",
        },
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new GitHubApiError(res.status, `GitHub repos API ${res.status}: ${body}`);
    }
    const batch = (await res.json()) as GitHubRepo[];
    repos.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

/** Encode a repo file path for the Contents API (slashes stay as path segments). */
export function githubContentsPath(filePath: string): string {
  return filePath
    .replace(/^\/+/, "")
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/** Ref path for a branch head. Encodes the branch name but keeps the heads/ prefix as a literal path segment. */
export function githubHeadRefPath(fullName: string, branchName: string): string {
  return `/repos/${fullName}/git/refs/${encodeURIComponent("heads/" + branchName)}`;
}

/** Tip commit SHA for a branch (or other ref). Returns null on any GitHub failure. */
export async function resolveBranchHeadSha(
  token: string,
  fullName: string,
  branch: string,
): Promise<string | null> {
  const res = await fetch(`${GITHUB_API}/repos/${fullName}/commits/${encodeURIComponent(branch)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "LaunchReadyy/1.0",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { sha?: string };
  return typeof data.sha === "string" && data.sha.length > 0 ? data.sha : null;
}

/** Verifies the token can perform git writes (blob + ephemeral ref). */
export async function probeGitHubGitWrite(token: string, fullName: string): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "LaunchReadyy/1.0",
  };

  const blobRes = await fetch(`${GITHUB_API}/repos/${fullName}/git/blobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: Buffer.from("lr-probe").toString("base64"),
      encoding: "base64",
    }),
  });
  if (!blobRes.ok) {
    const body = await blobRes.text().catch(() => "");
    const scopes = blobRes.headers.get("x-oauth-scopes") ?? "unknown";
    throw new GitHubApiError(
      blobRes.status,
      `GitHub git write probe failed for ${fullName} (${blobRes.status}). OAuth scopes: ${scopes}. ${body.slice(0, 200)}`,
    );
  }

  const repoRes = await fetch(`${GITHUB_API}/repos/${fullName}`, { headers });
  if (!repoRes.ok) {
    throw new GitHubApiError(repoRes.status, `Cannot load repo ${fullName} for write probe`);
  }
  const repo = (await repoRes.json()) as { default_branch?: string };
  const baseBranch = repo.default_branch ?? "main";

  const refRes = await fetch(`${GITHUB_API}/repos/${fullName}/git/ref/heads/${baseBranch}`, {
    headers,
  });
  if (!refRes.ok) {
    throw new GitHubApiError(refRes.status, `Cannot read base ref for write probe on ${fullName}`);
  }
  const ref = (await refRes.json()) as { object: { sha: string } };
  const probeBranch = `lr-write-probe-${Date.now()}`;

  const createRes = await fetch(`${GITHUB_API}/repos/${fullName}/git/refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref: `refs/heads/${probeBranch}`, sha: ref.object.sha }),
  });
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new GitHubApiError(
      createRes.status,
      `GitHub ref write probe failed for ${fullName} (${createRes.status}): ${body.slice(0, 200)}`,
    );
  }

  await fetch(`${GITHUB_API}${githubHeadRefPath(fullName, probeBranch)}`, {
    method: "DELETE",
    headers,
  });
}

/** GitHub returns 404 (not 403) when the token cannot write to a private repo. */
export async function assertGitHubRepoWriteAccess(token: string, fullName: string): Promise<void> {
  const res = await fetch(`${GITHUB_API}/repos/${fullName}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "LaunchReadyy/1.0",
    },
  });
  const scopes = res.headers.get("x-oauth-scopes") ?? "unknown";
  const body = await res.text().catch(() => "");

  if (!res.ok) {
    throw new GitHubApiError(
      res.status,
      `Cannot access ${fullName} (${res.status}). Sign out and reconnect GitHub with the "repo" scope. OAuth scopes: ${scopes}`,
    );
  }

  const repo = JSON.parse(body) as { permissions?: { push?: boolean }; private?: boolean };
  if (!repo.permissions?.push) {
    throw new GitHubApiError(
      403,
      `GitHub token cannot push to ${fullName}${repo.private ? " (private repo)" : ""}. ` +
        `Sign out and reconnect GitHub — the "repo" scope is required to open fix PRs. ` +
        `OAuth scopes: ${scopes}`,
    );
  }
}
