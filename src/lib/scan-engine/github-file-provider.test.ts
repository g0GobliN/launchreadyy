/**
 * The sandbox job plans its build from the file list and two or three manifests. It used to get
 * those through the repo tarball, so every run began with a whole-repo download — ~90 seconds of
 * a sandbox that had already booted and cloned, showing an empty terminal. `deferSnapshot` is
 * what keeps that download off the critical path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubFileProvider } from "./github-file-provider";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function treeResponse(paths: string[], truncated = false) {
  return new Response(
    JSON.stringify({
      sha: "tree-sha",
      truncated,
      tree: paths.map((p) => ({ path: p, type: "blob", size: 10, sha: `sha-${p}` })),
    }),
    { status: 200 },
  );
}

/** Records which endpoints were hit; the tarball never resolves, standing in for a slow download. */
function stubGitHub(files: Record<string, string> = {}) {
  const hits: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    hits.push(url);
    if (url.includes("/git/trees/")) return treeResponse(["package.json", "src/app.ts"]);
    if (url.includes("/tarball")) return new Promise<Response>(() => {}); // never settles
    if (url.includes("/contents/")) {
      const path = decodeURIComponent(url.split("/contents/")[1]!);
      const body = files[path];
      if (body === undefined) return new Response("nope", { status: 404 });
      return new Response(
        JSON.stringify({
          content: Buffer.from(body, "utf-8").toString("base64"),
          encoding: "base64",
        }),
        { status: 200 },
      );
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  return hits;
}

describe("GitHubFileProvider with deferSnapshot", () => {
  it("lists files from the git tree without waiting for the tarball", async () => {
    stubGitHub();
    const provider = new GitHubFileProvider("tok", "o/r", "main", { deferSnapshot: true });

    // Would hang forever if it awaited the tarball.
    const files = await provider.listFiles();
    expect(files).toEqual(["package.json", "src/app.ts"]);
  });

  it("reads a single file through the contents API while the tarball is still downloading", async () => {
    const hits = stubGitHub({ "package.json": '{"name":"app"}' });
    const provider = new GitHubFileProvider("tok", "o/r", "main", { deferSnapshot: true });

    await provider.listFiles();
    expect(await provider.readFile("package.json")).toBe('{"name":"app"}');
    expect(hits.some((h) => h.includes("/contents/package.json"))).toBe(true);
  });

  it("still exposes sizes and the tree sha for incremental scans", async () => {
    stubGitHub();
    const provider = new GitHubFileProvider("tok", "o/r", "main", { deferSnapshot: true });

    await provider.listFiles();
    expect(provider.fileSize("package.json")).toBe(10);
    expect(provider.treeSha()).toBe("tree-sha");
    expect(provider.treeTruncated).toBe(false);
  });
});
