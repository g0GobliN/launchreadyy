import { describe, expect, it } from "vitest";
import { restrictWorkflowPermissions, workflowNeedsWriteAccess } from "./workflow-permissions";
import { pinActionsToSha, unpinnedActionRefs } from "./pin-actions";
import { addNonRootUser, baseImageFamily } from "./dockerfile-user";
import {
  checkWorkflowPermissions,
  checkUnpinnedActions,
} from "../../../scanner/security/workflow-security";
import { checkRunsAsRoot } from "../../../scanner/security/container-security";
import type { IssueInput } from "../../../scanner-rules";

/** The fix is only correct if the finding it closed stops firing. */
function findings(
  check: (files: Record<string, string>, out: IssueInput[]) => void,
  files: Record<string, string>,
) {
  const out: IssueInput[] = [];
  check(files, out);
  return out;
}

describe("restrictWorkflowPermissions", () => {
  const ci = [
    "name: CI",
    "",
    "on:",
    "  push:",
    "",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
  ].join("\n");

  it("adds a least-privilege block and closes the finding", () => {
    const fixed = restrictWorkflowPermissions(ci)!;
    expect(fixed).toContain("permissions:\n  contents: read");
    expect(findings(checkWorkflowPermissions, { ".github/workflows/ci.yml": fixed })).toHaveLength(
      0,
    );
  });

  it("keeps the rest of the file byte-identical apart from the inserted block", () => {
    const fixed = restrictWorkflowPermissions(ci)!;
    expect(fixed.replace("permissions:\n  contents: read\n", "")).toBe(ci);
    expect(fixed).not.toContain("\n\n\n");
  });

  it("narrows write-all in place, at whatever indentation it had", () => {
    const wf = "name: X\n\njobs:\n  b:\n    permissions: write-all\n    runs-on: ubuntu-latest\n";
    const fixed = restrictWorkflowPermissions(wf)!;
    expect(fixed).toContain("    permissions:\n      contents: read");
    expect(findings(checkWorkflowPermissions, { "w.yml": fixed })).toHaveLength(0);
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = restrictWorkflowPermissions(ci)!;
    expect(restrictWorkflowPermissions(once)).toBeNull();
  });

  it("leaves a workflow with no jobs: key alone rather than guessing", () => {
    expect(restrictWorkflowPermissions("name: reusable\non:\n  workflow_call:\n")).toBeNull();
  });

  it("preserves CRLF line endings", () => {
    const fixed = restrictWorkflowPermissions(ci.replace(/\n/g, "\r\n"))!;
    expect(fixed).toContain("\r\n");
    expect(fixed).not.toMatch(/[^\r]\n/);
  });

  it.each([
    ["git push", "      - run: git push origin main"],
    ["release action", "      - uses: softprops/action-gh-release@v2"],
    ["create-pull-request", "      - uses: peter-evans/create-pull-request@v6"],
    ["gh release create", "      - run: gh release create v1.0.0"],
    ["pages deploy", "      - uses: actions/deploy-pages@v4"],
  ])("refuses to restrict a workflow that writes back to the repo — %s", (_label, step) => {
    // `contents: read` would red their pipeline. One unfixed finding beats one broken CI.
    expect(workflowNeedsWriteAccess(`${ci}\n${step}\n`)).toBe(true);
  });

  it("does not mistake an ordinary build for one that needs write", () => {
    expect(workflowNeedsWriteAccess(ci)).toBe(false);
  });
});

describe("pinActionsToSha", () => {
  const wf = [
    "jobs:",
    "  b:",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: docker/build-push-action@v5",
    "      - uses: codecov/codecov-action@v4 # coverage",
    "      - uses: pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d",
  ].join("\n");

  it("lists only third-party actions that are not already pinned", () => {
    expect(unpinnedActionRefs(wf)).toEqual([
      "docker/build-push-action@v5",
      "codecov/codecov-action@v4",
    ]);
  });

  it("pins to the SHA and keeps the tag readable, closing the finding", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const fixed = pinActionsToSha(
      wf,
      new Map([
        ["docker/build-push-action@v5", sha],
        ["codecov/codecov-action@v4", sha],
      ]),
    )!;
    expect(fixed).toContain(`docker/build-push-action@${sha} # v5`);
    // An existing comment was written on purpose, so it survives instead of being overwritten.
    expect(fixed).toContain(`codecov/codecov-action@${sha} # coverage`);
    expect(fixed).toContain("actions/checkout@v4");
    expect(findings(checkUnpinnedActions, { "w.yml": fixed })).toHaveLength(0);
  });

  it("leaves an action alone when its tag could not be resolved", () => {
    const fixed = pinActionsToSha(wf, new Map([["docker/build-push-action@v5", "a".repeat(40)]]))!;
    expect(fixed).toContain("codecov/codecov-action@v4 # coverage");
  });

  it("returns null when there is nothing it can pin", () => {
    expect(pinActionsToSha(wf, new Map())).toBeNull();
  });
});

describe("addNonRootUser", () => {
  it.each([
    ["node:22-slim", "node"],
    ["node:22-alpine", "alpine"],
    ["python:3.12-alpine", "alpine"],
    ["python:3.12-slim", "debian"],
    ["gcr.io/distroless/static", "distroless"],
    ["scratch", "scratch"],
  ])("reads the base image family of %s", (image, expected) => {
    expect(baseImageFamily(`FROM ${image}`)).toBe(expected);
  });

  it("adds a user before CMD and closes the finding", () => {
    const df = 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nCMD ["python", "main.py"]\n';
    const out = addNonRootUser("Dockerfile", df)!;
    expect(out.content).toMatch(/useradd[\s\S]*chown -R app:app \/app\nUSER app\nCMD/);
    expect(findings(checkRunsAsRoot, { Dockerfile: out.content })).toHaveLength(0);
  });

  it("uses Alpine's adduser on an Alpine base", () => {
    const df = 'FROM python:3.12-alpine\nWORKDIR /srv\nCMD ["python", "m.py"]\n';
    expect(addNonRootUser("Dockerfile", df)!.content).toContain("addgroup -S app && adduser -S");
  });

  it("reuses the node user the official image already ships", () => {
    const df = 'FROM node:22-slim\nWORKDIR /app\nCMD ["node", "server.js"]\n';
    const out = addNonRootUser("Dockerfile", df)!;
    expect(out.content).toContain("USER node");
    expect(out.content).toContain("chown -R node:node /app");
    expect(out.content).not.toContain("useradd");
  });

  it("uses the built-in nonroot user on distroless, which has no shell to create one", () => {
    const df = 'FROM gcr.io/distroless/static\nCOPY app /app\nCMD ["/app"]\n';
    const out = addNonRootUser("Dockerfile", df)!;
    expect(out.content).toContain("USER nonroot:nonroot");
    expect(out.content).not.toContain("RUN");
  });

  it("only edits the final stage of a multi-stage build", () => {
    const df = [
      "FROM golang:1.23 AS build",
      "WORKDIR /src",
      "RUN go build -o /out/app",
      "",
      "FROM debian:bookworm-slim",
      "WORKDIR /app",
      "COPY --from=build /out/app /app/app",
      'CMD ["/app/app"]',
    ].join("\n");
    const out = addNonRootUser("Dockerfile", df)!;
    expect(out.content.indexOf("USER app")).toBeGreaterThan(out.content.indexOf("bookworm-slim"));
    expect(out.content.split("USER app")).toHaveLength(2);
    expect(findings(checkRunsAsRoot, { Dockerfile: out.content })).toHaveLength(0);
  });

  it("replaces an explicit USER root instead of leaving it above the new one", () => {
    const df = 'FROM debian:bookworm-slim\nWORKDIR /app\nUSER root\nCMD ["/app/x"]\n';
    const out = addNonRootUser("Dockerfile", df)!;
    expect(out.content).not.toMatch(/^USER root$/m);
    expect(findings(checkRunsAsRoot, { Dockerfile: out.content })).toHaveLength(0);
  });

  it("warns when the container exposes a port a non-root process cannot bind", () => {
    const df = 'FROM debian:bookworm-slim\nWORKDIR /app\nEXPOSE 80\nCMD ["/app/x"]\n';
    expect(addNonRootUser("Dockerfile", df)!.warning).toMatch(/port 80/);
  });

  it("stays quiet about ports above 1024", () => {
    const df = 'FROM debian:bookworm-slim\nWORKDIR /app\nEXPOSE 8080\nCMD ["/app/x"]\n';
    expect(addNonRootUser("Dockerfile", df)!.warning).toBeUndefined();
  });

  it("refuses a scratch image, which cannot hold a user account", () => {
    expect(addNonRootUser("Dockerfile", 'FROM scratch\nCOPY app /app\nCMD ["/app"]\n')).toBeNull();
  });

  it("does nothing when the container already runs as a non-root user", () => {
    const df = 'FROM debian:bookworm-slim\nUSER svc\nCMD ["/app/x"]\n';
    expect(addNonRootUser("Dockerfile", df)).toBeNull();
  });

  it("is idempotent", () => {
    const df = 'FROM python:3.12-slim\nWORKDIR /app\nCMD ["python", "m.py"]\n';
    const once = addNonRootUser("Dockerfile", df)!.content;
    expect(addNonRootUser("Dockerfile", once)).toBeNull();
  });
});
