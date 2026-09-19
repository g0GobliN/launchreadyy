/**
 * Handler-level cover: the transforms are tested next to themselves; what these pin down is the
 * wiring — which files each handler is allowed to touch, what it tells the user when it declines,
 * and that a repository whose app sits in a subdirectory still gets its root workflows hardened.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const files: Record<string, string> = {};
const commits: Record<string, string> = {};

vi.mock("../../github", () => ({
  fetchFileContent: vi.fn(async (_t: string, _f: string, path: string) => files[path] ?? null),
  ghGet: vi.fn(async (_t: string, path: string) => {
    const m = /^\/repos\/(.+)\/commits\/(.+)$/.exec(path);
    const key = `${m![1]}@${decodeURIComponent(m![2]!)}`;
    if (!commits[key]) throw new Error("404");
    return { sha: commits[key] };
  }),
}));

import {
  handleDockerRootUser,
  handleWorkflowPermissions,
  handleWorkflowUnpinnedAction,
} from "./hardening";
import type { FixCtx } from "../shared/fix-ctx";

function ctxFor(repoFilePaths: string[]) {
  const added = new Map<string, string>();
  const notes: { fixId: string; status: string; text: string }[] = [];
  const fx = {
    token: "t",
    fullName: "acme/app",
    repoFilePaths,
    add: (path: string, content: string) => added.set(path, content),
    note: (fixId: string, status: string, text: string) => notes.push({ fixId, status, text }),
  } as unknown as FixCtx;
  return { fx, added, notes };
}

const PLAIN_CI =
  "name: CI\n\non:\n  push:\n\njobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n";
const RELEASE_CI =
  "name: Release\n\non:\n  push:\n\njobs:\n  r:\n    steps:\n      - uses: softprops/action-gh-release@v2\n";

beforeEach(() => {
  for (const k of Object.keys(files)) delete files[k];
  for (const k of Object.keys(commits)) delete commits[k];
});

describe("handleWorkflowPermissions", () => {
  it("hardens every workflow it can and names the ones it would not touch", async () => {
    files[".github/workflows/ci.yml"] = PLAIN_CI;
    files[".github/workflows/release.yml"] = RELEASE_CI;
    const { fx, added, notes } = ctxFor([
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
      "src/index.ts",
    ]);

    await handleWorkflowPermissions(fx);

    expect([...added.keys()]).toEqual([".github/workflows/ci.yml"]);
    expect(added.get(".github/workflows/ci.yml")).toContain("contents: read");
    // The release workflow must be reported, not silently left behind.
    expect(notes.find((n) => n.status === "warning")?.text).toContain("release.yml");
  });

  it("hardens root workflows even when the app lives in a subdirectory", async () => {
    files[".github/workflows/ci.yml"] = PLAIN_CI;
    const { fx, added } = ctxFor([".github/workflows/ci.yml", "backend/main.py"]);

    await handleWorkflowPermissions(fx);

    expect(added.has(".github/workflows/ci.yml")).toBe(true);
  });

  it("ignores YAML that is not a workflow", async () => {
    files["deploy/compose.yml"] = PLAIN_CI;
    const { fx, added } = ctxFor(["deploy/compose.yml"]);
    await handleWorkflowPermissions(fx);
    expect(added.size).toBe(0);
  });
});

describe("handleWorkflowUnpinnedAction", () => {
  it("resolves each action once and pins it, keeping the tag", async () => {
    const sha = "1".repeat(40);
    files[".github/workflows/a.yml"] =
      "jobs:\n  x:\n    steps:\n      - uses: docker/setup-buildx-action@v3\n";
    files[".github/workflows/b.yml"] =
      "jobs:\n  y:\n    steps:\n      - uses: docker/setup-buildx-action@v3\n";
    commits["docker/setup-buildx-action@v3"] = sha;
    const { fx, added, notes } = ctxFor([".github/workflows/a.yml", ".github/workflows/b.yml"]);

    await handleWorkflowUnpinnedAction(fx);

    expect(added.size).toBe(2);
    expect(added.get(".github/workflows/a.yml")).toContain(`@${sha} # v3`);
    expect(notes.some((n) => n.status === "verified")).toBe(true);
  });

  it("leaves an action it cannot resolve unpinned, and says which", async () => {
    files[".github/workflows/a.yml"] = "jobs:\n  x:\n    steps:\n      - uses: gone/action@v1\n";
    const { fx, added, notes } = ctxFor([".github/workflows/a.yml"]);

    await handleWorkflowUnpinnedAction(fx);

    expect(added.size).toBe(0);
    expect(notes.find((n) => n.status === "warning")?.text).toContain("gone/action@v1");
  });
});

describe("handleDockerRootUser", () => {
  it("edits a Dockerfile in place wherever it lives in the repo", async () => {
    files["backend/Dockerfile"] = 'FROM python:3.12-slim\nWORKDIR /app\nCMD ["python", "m.py"]\n';
    const { fx, added, notes } = ctxFor(["backend/Dockerfile", "backend/m.py"]);

    await handleDockerRootUser(fx);

    expect(added.get("backend/Dockerfile")).toContain("USER app");
    expect(notes.find((n) => n.status === "verified")?.text).toContain("backend/Dockerfile");
  });

  it("explains itself when no Dockerfile can be changed", async () => {
    files["Dockerfile"] = 'FROM scratch\nCOPY app /app\nCMD ["/app"]\n';
    const { fx, added, notes } = ctxFor(["Dockerfile"]);

    await handleDockerRootUser(fx);

    expect(added.size).toBe(0);
    expect(notes[0]!.status).toBe("warning");
    expect(notes[0]!.text).toContain("scratch");
  });

  it("passes the privileged-port warning through to the user", async () => {
    files["Dockerfile"] = 'FROM debian:bookworm-slim\nWORKDIR /app\nEXPOSE 443\nCMD ["/app/x"]\n';
    const { fx, notes } = ctxFor(["Dockerfile"]);

    await handleDockerRootUser(fx);

    expect(notes.some((n) => n.status === "warning" && n.text.includes("port 443"))).toBe(true);
  });
});
