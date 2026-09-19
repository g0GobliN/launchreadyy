import { fetchFileContent, type PkgMods } from "../../github";
import { projectUsesTypeScript } from "../../../project-ci.server";
import {
  EXPRESS_ENTRY_CANDIDATES,
  REACT_VITE_ENTRY_CANDIDATES,
  BACKEND_DEPS,
  ENV_VAR_SCAN_FILES,
  ENV_VAR_BUILTINS,
} from "../shared/constants";
import { PackageJsonMeta } from "../shared/types";

export async function detectEntryPoint(
  token: string,
  fullName: string,
  framework: string,
): Promise<string | null> {
  const candidates =
    framework === "Express" ? EXPRESS_ENTRY_CANDIDATES : REACT_VITE_ENTRY_CANDIDATES;
  for (const candidate of candidates) {
    const content = await fetchFileContent(token, fullName, candidate);
    if (content !== null) return candidate;
  }
  return null;
}

export async function detectPackageManager(
  token: string,
  fullName: string,
): Promise<"npm" | "pnpm" | "yarn" | "bun"> {
  const [pnpm, yarn, bun] = await Promise.all([
    fetchFileContent(token, fullName, "pnpm-lock.yaml"),
    fetchFileContent(token, fullName, "yarn.lock"),
    fetchFileContent(token, fullName, "bun.lockb"),
  ]);
  if (pnpm) return "pnpm";
  if (yarn) return "yarn";
  if (bun) return "bun";
  return "npm";
}

/**
 * The Node version the generated CI should pin.
 *
 * `.nvmrc` wins over `engines.node`, matching `resolveSandboxNodeVersion` — the sandbox already
 * preferred it, so the two halves of the product disagreed: a repo pinned the ordinary nvm way
 * (no `engines` field) sandbox-verified on its real version but got a CI workflow hardcoded to
 * the "20" fallback. Observed on a real PR: an Astro repo with `.nvmrc` = 22.23.1 got Node 20 in
 * CI and every job died on `Node.js v20.20.2 is not supported by Astro! … requires >=22.12.0`.
 * Reduced to the major, which is what `actions/setup-node` wants and what this always returned.
 */
export function pickCiNodeVersion(nvmrc: string | null, enginesNode: string | undefined): string {
  const fromNvmrc = nvmrc?.trim().replace(/^v/i, "").match(/^\d+/)?.[0];
  if (fromNvmrc) return fromNvmrc;
  return enginesNode?.match(/\d+/)?.[0] ?? "20";
}

export async function fetchPackageJsonMeta(
  token: string,
  fullName: string,
): Promise<PackageJsonMeta> {
  const [content, nvmrc] = await Promise.all([
    fetchFileContent(token, fullName, "package.json"),
    fetchFileContent(token, fullName, ".nvmrc").catch(() => null),
  ]);
  if (!content) {
    return {
      scripts: {},
      nodeVersion: pickCiNodeVersion(nvmrc, undefined),
      hasBackend: false,
      dependencies: {},
      devDependencies: {},
    };
  }
  try {
    const pkg = JSON.parse(content) as {
      scripts?: Record<string, string>;
      engines?: { node?: string };
      packageManager?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const nodeVersion = pickCiNodeVersion(nvmrc, pkg.engines?.node);
    const dependencies = pkg.dependencies ?? {};
    const devDependencies = pkg.devDependencies ?? {};
    const allDeps = { ...dependencies, ...devDependencies };
    const hasBackend = BACKEND_DEPS.some((d) => d in allDeps);
    return {
      scripts: pkg.scripts ?? {},
      nodeVersion,
      hasBackend,
      packageManager: pkg.packageManager,
      dependencies,
      devDependencies,
    };
  } catch {
    return {
      scripts: {},
      nodeVersion: pickCiNodeVersion(nvmrc, undefined),
      hasBackend: false,
      dependencies: {},
      devDependencies: {},
    };
  }
}

export function ensureTypecheckScript(
  pkgMeta: PackageJsonMeta,
  pkgMods: PkgMods,
  filePaths: string[],
): boolean {
  if (!projectUsesTypeScript(pkgMeta, filePaths)) return false;
  const hasTypecheck = "typecheck" in pkgMeta.scripts;
  if (!hasTypecheck) {
    pkgMods.scripts.typecheck = "tsc --noEmit";
    const allDeps = { ...pkgMeta.dependencies, ...pkgMeta.devDependencies };
    if (!("typescript" in allDeps)) {
      pkgMods.devDeps.typescript = "^5.0.0";
    }
  }
  return hasTypecheck;
}

export async function detectEnvVars(token: string, fullName: string): Promise<string[]> {
  const contents = await Promise.all(
    ENV_VAR_SCAN_FILES.map((p) => fetchFileContent(token, fullName, p)),
  );
  const vars = new Set<string>();
  for (const content of contents) {
    if (!content) continue;
    for (const m of content.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) vars.add(m[1]);
    for (const m of content.matchAll(/process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]]/g)) vars.add(m[1]);
    for (const m of content.matchAll(/import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g)) vars.add(m[1]);
  }
  return [...vars].filter((v) => !ENV_VAR_BUILTINS.has(v)).sort();
}

export function needsReactPlugin(framework: string, deps: Record<string, string>): boolean {
  if (framework === "Express" || framework === "unknown") return false;
  if (framework === "Vite") return !!deps["react"];
  return true; // Next.js, "React" label
}
