import { describe, expect, it } from "vitest";
import { checkWorkflowSecurity, isWorkflowPath } from "./workflow-security";
import type { IssueInput } from "../../scanner-rules";

function run(files: Record<string, string>): IssueInput[] {
  const issues: IssueInput[] = [];
  checkWorkflowSecurity(files, issues);
  return issues;
}

function byFix(issues: IssueInput[], fixId: string): IssueInput | undefined {
  return issues.find((i) => i.fixId === fixId);
}

/** A workflow that does everything right, used as the baseline for "no finding". */
const SAFE = `name: CI
on: pull_request
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d
      - run: npm test
`;

describe("isWorkflowPath", () => {
  it("matches only workflow files", () => {
    expect(isWorkflowPath(".github/workflows/ci.yml")).toBe(true);
    expect(isWorkflowPath(".github/workflows/deploy.yaml")).toBe(true);
    expect(isWorkflowPath(".github/actions/thing/action.yml")).toBe(false);
    expect(isWorkflowPath("docker-compose.yml")).toBe(false);
  });
});

describe("script injection", () => {
  it("flags a PR title interpolated into a run block", () => {
    const issues = run({
      ".github/workflows/pr.yml": `on: pull_request_target
permissions:
  contents: read
jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - run: echo "PR: \${{ github.event.pull_request.title }}"
`,
    });
    const found = byFix(issues, "workflow-script-injection");
    expect(found).toBeDefined();
    expect(found!.severity).toBe("high");
    expect(found!.foundEvidence).toContain("github.event.pull_request.title");
  });

  it("flags github.head_ref inside a multi-line run block", () => {
    const issues = run({
      ".github/workflows/b.yml": `on: pull_request
permissions:
  contents: read
jobs:
  build:
    steps:
      - run: |
          echo building
          git checkout \${{ github.head_ref }}
      - uses: actions/checkout@v4
`,
    });
    expect(byFix(issues, "workflow-script-injection")).toBeDefined();
  });

  /**
   * The `env:` indirection is the documented fix, and it is safe because the shell — not the
   * template engine — expands `$TITLE`. Flagging it would train users to ignore the rule.
   */
  it("does not flag the same value passed through env", () => {
    const issues = run({
      ".github/workflows/c.yml": `on: pull_request
permissions:
  contents: read
jobs:
  build:
    steps:
      - env:
          TITLE: \${{ github.event.pull_request.title }}
        run: echo "$TITLE"
      - uses: actions/checkout@v4
`,
    });
    expect(byFix(issues, "workflow-script-injection")).toBeUndefined();
  });

  it("does not flag context values an outsider cannot set", () => {
    const issues = run({
      ".github/workflows/d.yml": `on: push
permissions:
  contents: read
jobs:
  build:
    steps:
      - run: echo "\${{ github.repository }} \${{ github.sha }} \${{ github.run_id }}"
      - uses: actions/checkout@v4
`,
    });
    expect(byFix(issues, "workflow-script-injection")).toBeUndefined();
  });

  it("finds nothing in a well-formed workflow", () => {
    expect(run({ ".github/workflows/ci.yml": SAFE })).toEqual([]);
  });
});

describe("pull_request_target", () => {
  it("flags checking out the PR head under a writable token", () => {
    const issues = run({
      ".github/workflows/e.yml": `on: pull_request_target
permissions:
  contents: read
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: npm run build
`,
    });
    const found = byFix(issues, "workflow-pr-target-checkout");
    expect(found).toBeDefined();
    expect(found!.severity).toBe("critical");
  });

  it("does not flag pull_request_target on its own", () => {
    const issues = run({
      ".github/workflows/f.yml": `on: pull_request_target
permissions:
  contents: read
jobs:
  label:
    steps:
      - uses: actions/labeler@v5
`,
    });
    expect(byFix(issues, "workflow-pr-target-checkout")).toBeUndefined();
  });

  it("does not flag a PR head checkout under the safe trigger", () => {
    const issues = run({
      ".github/workflows/g.yml": `on: pull_request
permissions:
  contents: read
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
`,
    });
    expect(byFix(issues, "workflow-pr-target-checkout")).toBeUndefined();
  });
});

describe("permissions", () => {
  it("flags write-all as high, naming it as the deliberate grant it is", () => {
    const issues = run({
      ".github/workflows/h.yml": `on: push
permissions: write-all
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
`,
    });
    const found = byFix(issues, "workflow-permissions");
    expect(found!.severity).toBe("high");
    expect(found!.foundEvidence).toContain("write-all");
  });

  /**
   * A missing block only *inherits* a default we cannot see from a file scan, so it is the weaker
   * claim and must not be reported at the same severity as an explicit write-all.
   */
  it("flags a missing block one level lower", () => {
    const issues = run({
      ".github/workflows/i.yml": `on: push
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
`,
    });
    const found = byFix(issues, "workflow-permissions");
    expect(found!.severity).toBe("medium");
    expect(found!.confidence).not.toBe("high");
  });

  it("accepts an explicit read-only grant", () => {
    expect(
      byFix(run({ ".github/workflows/ci.yml": SAFE }), "workflow-permissions"),
    ).toBeUndefined();
  });
});

describe("action pinning", () => {
  it("flags a third-party action on a movable tag", () => {
    const issues = run({
      ".github/workflows/j.yml": `on: push
permissions:
  contents: read
jobs:
  build:
    steps:
      - uses: some-vendor/deploy-action@v2
`,
    });
    const found = byFix(issues, "workflow-unpinned-action");
    expect(found).toBeDefined();
    expect(found!.foundEvidence).toContain("some-vendor/deploy-action@v2");
  });

  it("accepts a full commit SHA", () => {
    const issues = run({
      ".github/workflows/k.yml": `on: push
permissions:
  contents: read
jobs:
  build:
    steps:
      - uses: pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d
`,
    });
    expect(byFix(issues, "workflow-unpinned-action")).toBeUndefined();
  });

  /**
   * `actions/*` and `github/*` are GitHub's own namespaces. Demanding SHA pins there would fire
   * on essentially every repository, and a rule that always fires gets switched off.
   */
  it("does not flag GitHub's own actions on a tag", () => {
    const issues = run({
      ".github/workflows/l.yml": `on: push
permissions:
  contents: read
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: github/codeql-action/init@v3
`,
    });
    expect(byFix(issues, "workflow-unpinned-action")).toBeUndefined();
  });

  it("reports each distinct action once, however many workflows use it", () => {
    const step = `on: push
permissions:
  contents: read
jobs:
  build:
    steps:
      - uses: vendor/act@v1
`;
    const issues = run({ ".github/workflows/m.yml": step, ".github/workflows/n.yml": step });
    const found = byFix(issues, "workflow-unpinned-action");
    expect(found!.foundEvidence!.match(/vendor\/act@v1/g)).toHaveLength(1);
  });
});

describe("scope", () => {
  it("ignores non-workflow YAML", () => {
    expect(run({ "docker-compose.yml": "services:\n  db:\n    image: postgres" })).toEqual([]);
  });

  it("reports nothing when the repo has no workflows", () => {
    expect(run({ "src/index.ts": "export const a = 1;" })).toEqual([]);
  });
});
