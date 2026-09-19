import { describe, expect, it } from "vitest";
import { checkContainerSecurity, isDockerfilePath } from "./container-security";
import type { IssueInput } from "../../scanner-rules";

function run(files: Record<string, string>): IssueInput[] {
  const issues: IssueInput[] = [];
  checkContainerSecurity(files, issues);
  return issues;
}

function byFix(issues: IssueInput[], fixId: string): IssueInput | undefined {
  return issues.find((i) => i.fixId === fixId);
}

const SAFE = `FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN adduser --system --no-create-home app
USER app
CMD ["node", "server.js"]
`;

describe("isDockerfilePath", () => {
  it("matches Dockerfiles anywhere in the tree, including suffixed variants", () => {
    expect(isDockerfilePath("Dockerfile")).toBe(true);
    expect(isDockerfilePath("apps/api/Dockerfile")).toBe(true);
    expect(isDockerfilePath("Dockerfile.prod")).toBe(true);
    expect(isDockerfilePath("docker-compose.yml")).toBe(false);
    expect(isDockerfilePath("prod.Dockerfile")).toBe(true);
    // A TypeScript file about Dockerfiles is not one; parsing it would report on code that
    // never builds an image.
    expect(isDockerfilePath("src/Dockerfile.ts")).toBe(false);
    expect(isDockerfilePath("docs/Dockerfile.md")).toBe(false);
  });
});

describe("running as root", () => {
  it("flags a Dockerfile with no USER", () => {
    const issues = run({ Dockerfile: 'FROM node:22\nCOPY . .\nCMD ["node", "a.js"]\n' });
    expect(byFix(issues, "docker-root-user")).toBeDefined();
  });

  it("flags an explicit USER root", () => {
    const issues = run({ Dockerfile: 'FROM node:22\nUSER root\nCMD ["node", "a.js"]\n' });
    const found = byFix(issues, "docker-root-user");
    expect(found!.foundEvidence).toContain("USER root");
  });

  it("accepts an unprivileged user", () => {
    expect(byFix(run({ Dockerfile: SAFE }), "docker-root-user")).toBeUndefined();
  });

  /**
   * Only the last stage ships. A builder stage running as root is normal and unavoidable —
   * flagging it would fire on nearly every multi-stage Dockerfile and teach users to ignore this.
   */
  it("ignores root in an earlier build stage", () => {
    const issues = run({
      Dockerfile: `FROM node:22 AS build
USER root
RUN npm run build

FROM node:22-alpine
COPY --from=build /app/dist /app
USER app
CMD ["node", "/app/server.js"]
`,
    });
    expect(byFix(issues, "docker-root-user")).toBeUndefined();
  });

  /** The inverse: a safe builder stage must not excuse a root final stage. */
  it("still flags root in the final stage when an earlier stage set a user", () => {
    const issues = run({
      Dockerfile: `FROM node:22 AS build
USER app
RUN npm run build

FROM node:22-alpine
COPY --from=build /app/dist /app
CMD ["node", "/app/server.js"]
`,
    });
    expect(byFix(issues, "docker-root-user")).toBeDefined();
  });
});

describe("baked-in secrets", () => {
  it("flags a token given a value in ENV", () => {
    const issues = run({
      Dockerfile: "FROM node:22\nENV NPM_TOKEN=npm_realvalue123456\nUSER app\n",
    });
    const found = byFix(issues, "docker-baked-secret");
    expect(found).toBeDefined();
    expect(found!.severity).toBe("high");
  });

  it("flags a password default in ARG", () => {
    const issues = run({
      Dockerfile: "FROM postgres:16\nARG DB_PASSWORD=hunter2hunter2\nUSER app\n",
    });
    expect(byFix(issues, "docker-baked-secret")).toBeDefined();
  });

  /** `ARG NPM_TOKEN` with no value is how a build secret is *declared* — the correct pattern. */
  it("does not flag a valueless ARG declaration", () => {
    const issues = run({ Dockerfile: "FROM node:22\nARG NPM_TOKEN\nUSER app\n" });
    expect(byFix(issues, "docker-baked-secret")).toBeUndefined();
  });

  it("does not flag an obvious placeholder", () => {
    const issues = run({
      Dockerfile:
        "FROM node:22\nENV API_KEY=your-key-here\nENV DB_PASSWORD=${DB_PASSWORD}\nUSER app\n",
    });
    expect(byFix(issues, "docker-baked-secret")).toBeUndefined();
  });

  it("does not flag unrelated environment variables", () => {
    const issues = run({
      Dockerfile: "FROM node:22\nENV NODE_ENV=production\nENV PORT=3000\nUSER app\n",
    });
    expect(byFix(issues, "docker-baked-secret")).toBeUndefined();
  });
});

describe("piped installs", () => {
  it("flags curl piped into sh", () => {
    const issues = run({
      Dockerfile: "FROM ubuntu\nRUN curl -fsSL https://example.com/i.sh | sh\nUSER app\n",
    });
    expect(byFix(issues, "docker-piped-install")).toBeDefined();
  });

  /**
   * Continuation lines are one instruction. Matching per raw line saw only `RUN set -e`, and the
   * pipe on the following line went unread.
   */
  it("sees a pipe on a continuation line", () => {
    const issues = run({
      Dockerfile: `FROM ubuntu
RUN set -e && \\
    wget -qO- https://example.com/i.sh | bash
USER app
`,
    });
    expect(byFix(issues, "docker-piped-install")).toBeDefined();
  });

  it("does not flag curl writing to a file", () => {
    const issues = run({
      Dockerfile:
        "FROM ubuntu\nRUN curl -fsSL https://example.com/f.tar.gz -o /tmp/f.tar.gz\nUSER app\n",
    });
    expect(byFix(issues, "docker-piped-install")).toBeUndefined();
  });

  it("does not read a commented-out instruction", () => {
    const issues = run({
      Dockerfile: "FROM ubuntu\n# RUN curl https://example.com/i.sh | sh\nUSER app\n",
    });
    expect(byFix(issues, "docker-piped-install")).toBeUndefined();
  });
});

describe("scope", () => {
  it("finds nothing in a well-formed Dockerfile", () => {
    expect(run({ Dockerfile: SAFE })).toEqual([]);
  });

  it("reports nothing when the repo has no Dockerfile", () => {
    expect(run({ "src/index.ts": "export const a = 1;" })).toEqual([]);
  });
});
