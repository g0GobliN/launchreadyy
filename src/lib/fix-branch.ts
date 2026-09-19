/** Default readable branch name for a production-setup PR. */
export function defaultFixBranchName(date = new Date()): string {
  return `launchreadyy-production-ready-${date.toISOString().slice(0, 10)}`;
}

/** Validate and normalize a user-supplied fix branch name. */
export function sanitizeFixBranchName(raw: string): string {
  const name = raw.trim().slice(0, 120);
  if (!name || !/^[\w.\-/]+$/.test(name) || name.includes("//") || name.endsWith("/")) {
    throw new Error(
      "Invalid branch name. Use letters, numbers, dots, hyphens, underscores, or single slashes.",
    );
  }
  return name;
}
