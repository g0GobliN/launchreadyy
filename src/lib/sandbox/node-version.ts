/**
 * Best-effort Node version to request inside the sandbox — mirrors what the repo's
 * own tooling (.nvmrc, package.json engines.node) declares, instead of always running
 * whatever Node ships in the sandbox image. That mismatch is what produces a wall of
 * npm EBADENGINE warnings that have nothing to do with the repo's actual health.
 */
export function resolveSandboxNodeVersion(input: {
  nvmrc?: string | null;
  enginesNode?: string | null;
}): string | undefined {
  return sanitizeVersion(input.nvmrc) ?? sanitizeVersion(pickHighestVersion(input.enginesNode));
}

/** Only bare `major[.minor[.patch]]` survives — anything else (including shell metacharacters
 *  a malicious repo could stuff into package.json) is dropped rather than risk interpolation. */
function sanitizeVersion(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const cleaned = v.trim().replace(/^v/i, "");
  return /^\d+(\.\d+){0,2}$/.test(cleaned) ? cleaned : undefined;
}

/** "^20.19.0 || >=22.12.0" → "22.12.0" — picks the newest version mentioned in the range,
 *  which satisfies an OR'd range without needing a full semver solver.
 *  Pure lower-bounds like ">=18" must NOT pin major 18 (that would downgrade the image Node). */
function pickHighestVersion(range: string | null | undefined): string | undefined {
  if (!range) return undefined;
  const trimmed = range.trim();
  if (/^>=?\s*\d+(\.\d+){0,2}\s*$/.test(trimmed)) return undefined;
  const matches = range.match(/\d+(?:\.\d+){0,2}/g);
  if (!matches) return undefined;
  return matches
    .map((text) => {
      const [major, minor = "0", patch = "0"] = text.split(".");
      return { text, major: Number(major), minor: Number(minor), patch: Number(patch) };
    })
    .sort((a, b) => b.major - a.major || b.minor - a.minor || b.patch - a.patch)[0].text;
}

/**
 * The sandbox needs a full major.minor.patch to download an exact tarball from
 * nodejs.org — `.nvmrc`/`engines.node` often only name a bare major (e.g. "22").
 * Resolves against nodejs.org's own release index; returns undefined (never throws)
 * if the lookup fails or nothing matches, so callers can just skip switching.
 */
export async function resolveExactNodeVersion(candidate: string): Promise<string | undefined> {
  if (/^\d+\.\d+\.\d+$/.test(candidate)) return candidate;

  const wantParts = candidate.split(".").map(Number);
  try {
    const res = await fetch("https://nodejs.org/dist/index.json");
    if (!res.ok) return undefined;
    const releases = (await res.json()) as Array<{ version: string }>;
    for (const release of releases) {
      const v = release.version.replace(/^v/, "");
      const parts = v.split(".").map(Number);
      if (wantParts.every((p, i) => parts[i] === p)) return v;
    }
  } catch {
    /* best-effort — sandbox just runs its default Node instead */
  }
  return undefined;
}
