/**
 * Handlers for the three hardening findings that edit files the repository already has, rather
 * than adding new ones: workflow permissions, action pinning and the Dockerfile's runtime user.
 *
 * Each one re-derives its targets with the scanner's own path predicates, so the fix can only
 * touch files the finding could have reported. Where a file cannot be edited safely it is skipped
 * with a note — a fix that half-lands and says nothing is how an operator loses time and their
 * trust in the same click.
 */

import { fetchFileContent, ghGet } from "../../github";
import { isDockerfilePath } from "../../../scanner/security";
import { addNonRootUser } from "../hardening/dockerfile-user";
import { pinActionsToSha, unpinnedActionRefs } from "../hardening/pin-actions";
import {
  restrictWorkflowPermissions,
  workflowNeedsWriteAccess,
} from "../hardening/workflow-permissions";
import type { FixCtx } from "../shared/fix-ctx";

/** Same scope the scan used: repo-root workflows, capped the same way. */
function workflowPaths(repoFilePaths: string[]): string[] {
  return repoFilePaths
    .filter(
      (f) => f.startsWith(".github/workflows/") && (f.endsWith(".yml") || f.endsWith(".yaml")),
    )
    .slice(0, 8);
}

function dockerfilePaths(repoFilePaths: string[]): string[] {
  return repoFilePaths.filter(isDockerfilePath).slice(0, 5);
}

export async function handleWorkflowPermissions(fx: FixCtx) {
  const { token, fullName, repoFilePaths, add, note } = fx;
  const paths = workflowPaths(repoFilePaths);
  const edited: string[] = [];
  const skipped: string[] = [];

  for (const path of paths) {
    const content = await fetchFileContent(token, fullName, path);
    if (content === null) continue;
    if (workflowNeedsWriteAccess(content)) {
      skipped.push(path);
      continue;
    }
    const next = restrictWorkflowPermissions(content);
    if (next === null) continue;
    add(path, next);
    edited.push(path);
  }

  if (edited.length === 0 && skipped.length === 0) {
    note("workflow-permissions", "warning", "No workflow needed a permissions block.");
    return;
  }
  if (edited.length > 0) {
    note(
      "workflow-permissions",
      "verified",
      `Set \`permissions: contents: read\` on ${edited.length} workflow${edited.length === 1 ? "" : "s"}: ${edited.join(", ")}. Grant more on the individual job that needs it.`,
    );
  }
  if (skipped.length > 0) {
    note(
      "workflow-permissions",
      "warning",
      `Left ${skipped.join(", ")} unchanged — ${skipped.length === 1 ? "it pushes commits, publishes releases or opens pull requests" : "they push commits, publish releases or open pull requests"}, which a read-only token cannot do. Set the narrowest \`permissions\` these need by hand.`,
    );
  }
}

/** Resolve a tag or branch to the commit it currently points at. */
async function resolveSha(token: string, action: string, ref: string): Promise<string | null> {
  // `owner/repo/path/to/sub-action` — only the first two segments are the repository.
  const repo = action.split("/").slice(0, 2).join("/");
  try {
    const data = await ghGet<{ sha?: string }>(
      token,
      `/repos/${repo}/commits/${encodeURIComponent(ref)}`,
    );
    return typeof data.sha === "string" && /^[a-f0-9]{40}$/i.test(data.sha) ? data.sha : null;
  } catch {
    // A deleted action, a private one, or a tag that no longer exists. The caller reports it.
    return null;
  }
}

export async function handleWorkflowUnpinnedAction(fx: FixCtx) {
  const { token, fullName, repoFilePaths, add, note } = fx;
  const paths = workflowPaths(repoFilePaths);

  const contents = new Map<string, string>();
  const wanted = new Set<string>();
  for (const path of paths) {
    const content = await fetchFileContent(token, fullName, path);
    if (content === null) continue;
    contents.set(path, content);
    for (const ref of unpinnedActionRefs(content)) wanted.add(ref);
  }

  if (wanted.size === 0) {
    note("workflow-unpinned-action", "warning", "Every third-party action is already pinned.");
    return;
  }

  // One lookup per distinct action, not per occurrence — the same action pinned in four
  // workflows is one question.
  const shas = new Map<string, string>();
  const unresolved: string[] = [];
  for (const key of wanted) {
    const at = key.lastIndexOf("@");
    const sha = await resolveSha(token, key.slice(0, at), key.slice(at + 1));
    if (sha) shas.set(key, sha);
    else unresolved.push(key);
  }

  const edited: string[] = [];
  for (const [path, content] of contents) {
    const next = pinActionsToSha(content, shas);
    if (next === null) continue;
    add(path, next);
    edited.push(path);
  }

  if (edited.length > 0) {
    note(
      "workflow-unpinned-action",
      "verified",
      `Pinned ${shas.size} third-party action${shas.size === 1 ? "" : "s"} to a commit SHA across ${edited.join(", ")}. The version tag is kept as a comment, and Dependabot updates SHA pins like any other dependency.`,
    );
  }
  if (unresolved.length > 0) {
    note(
      "workflow-unpinned-action",
      "warning",
      `Could not resolve ${unresolved.join(", ")} to a commit — left unpinned rather than pinned to a guess. Pin ${unresolved.length === 1 ? "it" : "them"} by hand from the action's releases page.`,
    );
  }
}

export async function handleDockerRootUser(fx: FixCtx) {
  const { token, fullName, repoFilePaths, add, note } = fx;
  const paths = dockerfilePaths(repoFilePaths);
  const edited: string[] = [];
  const warnings: string[] = [];

  for (const path of paths) {
    const content = await fetchFileContent(token, fullName, path);
    if (content === null) continue;
    const result = addNonRootUser(path, content);
    if (result === null) continue;
    add(path, result.content);
    edited.push(path);
    if (result.warning) warnings.push(result.warning);
  }

  if (edited.length === 0) {
    note(
      "docker-root-user",
      "warning",
      "No Dockerfile could be switched to a non-root user — each one either already sets USER, or builds from a base image (`scratch`) that cannot hold a user account.",
    );
    return;
  }

  note(
    "docker-root-user",
    "verified",
    `Added an unprivileged USER to ${edited.join(", ")}, with ownership of the working directory so the app can still write.`,
  );
  for (const warning of warnings) note("docker-root-user", "warning", warning);
}
