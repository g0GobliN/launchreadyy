/**
 * Fix for `workflow-unpinned-action`: rewrite third-party `uses: owner/action@v4` to the commit
 * SHA that tag currently points at, keeping the tag as a trailing comment.
 *
 * The rewrite itself is a pure string transform; resolving a tag to a SHA needs the GitHub API,
 * so the caller does that and passes the answers in. An action whose tag could not be resolved is
 * left exactly as it was — pinning to a SHA we guessed would be worse than not pinning at all.
 */

/** Matches the same `uses:` shape the scanner reports on, plus any trailing comment. */
const USES_LINE =
  /^([ \t]*(?:-[ \t]+)?uses:[ \t]*)([\w.-]+\/[\w.-]+(?:\/[\w.-]+)*)@([\w.-]+)([ \t]*)(#.*)?$/gm;

/** `owner/action@ref` exactly as `checkUnpinnedActions` keys its findings. */
export function unpinnedActionRefs(content: string): string[] {
  const refs = new Set<string>();
  for (const m of content.matchAll(USES_LINE)) {
    const [, , path, ref] = m;
    const owner = path!.split("/")[0]!;
    // GitHub's own namespaces are excluded by the finding, so the fix must not touch them either.
    if (owner === "actions" || owner === "github") continue;
    if (/^[a-f0-9]{40}$/i.test(ref!)) continue;
    refs.add(`${path}@${ref}`);
  }
  return [...refs];
}

/**
 * @param shas `owner/action@ref` → 40-character commit SHA. Refs absent from the map are skipped.
 * @returns the rewritten file, or `null` when nothing could be pinned.
 */
export function pinActionsToSha(content: string, shas: ReadonlyMap<string, string>): string | null {
  let changed = false;
  const next = content.replace(
    USES_LINE,
    (whole, prefix: string, path: string, ref: string, gap: string, comment?: string) => {
      const owner = path.split("/")[0]!;
      if (owner === "actions" || owner === "github") return whole;
      if (/^[a-f0-9]{40}$/i.test(ref)) return whole;
      const sha = shas.get(`${path}@${ref}`);
      if (!sha) return whole;
      changed = true;
      // The tag is what a human reads to know which version this is, so it has to survive the
      // rewrite. An existing comment is left alone — it was written deliberately and may say
      // something the tag does not.
      const trailing = comment ? `${gap}${comment}` : ` # ${ref}`;
      return `${prefix}${path}@${sha}${trailing}`;
    },
  );
  return changed ? next : null;
}
