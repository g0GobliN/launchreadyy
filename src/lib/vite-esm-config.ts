/** Vite 5+ / Vitest 3+ require ESM config — CJS vite.config.js breaks in CI. */

export function majorVersion(range?: string): number | null {
  if (!range) return null;
  const m = range.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function usesEsmSyntax(content: string): boolean {
  return /^\s*import\s[\w{*]/m.test(content) || /^\s*export\s/m.test(content);
}

export function viteConfigNeedsEsmFix(
  configFileName: string,
  configContent: string,
  pkgType: string | undefined,
  devDeps: Record<string, string>,
): boolean {
  if (pkgType === "module") return false;
  if (!/^vite\.config\.(js|cjs)$/i.test(configFileName)) return false;
  const hasVitest =
    Boolean(devDeps.vitest) ||
    /from\s+['"]vitest(?:\/config)?['"]/.test(configContent) ||
    /require\s*\(\s*['"]vitest/.test(configContent);
  const viteMajor = majorVersion(devDeps.vite);
  if (hasVitest) return true;
  if (viteMajor !== null && viteMajor >= 5) return true;
  return false;
}

/** Minimal CJS → ESM for simple vite.config.js files. */
export function migrateViteConfigContentToEsm(content: string): string {
  let out = content;
  out = out.replace(/module\.exports\s*=\s*/, "export default ");
  out = out.replace(/const\s+(\w+)\s*=\s*require\((['"][^'"]+['"])\)/g, "import $1 from $2");
  out = out.replace(
    /const\s*{\s*([^}]+)\s*}\s*=\s*require\((['"][^'"]+['"])\)/g,
    "import { $1 } from $2",
  );
  return out;
}

export function patchPackageJsonTypeModule(pkgRaw: string): string | null {
  try {
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    if (pkg.type === "module") return null;
    pkg.type = "module";
    const indent = pkgRaw.match(/^(\s+)"/m)?.[1] ?? "  ";
    return JSON.stringify(pkg, null, indent === "  " ? 2 : undefined) + "\n";
  } catch {
    return null;
  }
}

export interface ViteEsmPatchResult {
  patched: number;
  paths: string[];
}

/** Fix vite.config.js + Vitest/Vite 5 ESM breakage in every workspace package. */
export async function patchViteEsmConfigs(opts: {
  filePaths: string[];
  fetchFile: (path: string) => Promise<string | null>;
  add: (path: string, content: string) => void;
  /**
   * Restrict patching to the app being fixed.
   *
   * This walks the whole file tree, which is right for a single-app repo and wrong for a
   * monorepo: fixing the Python API in `backend/` was also adding `"type": "module"` to
   * `frontend/package.json` — a different app, not the one the user asked about, and a change
   * that can break it if its own code is CommonJS.
   */
  appDir?: string | null;
}): Promise<ViteEsmPatchResult> {
  const prefix = opts.appDir ? `${opts.appDir}/` : null;
  const configs = opts.filePaths.filter(
    (p) =>
      /(^|\/)vite\.config\.(js|cjs)$/.test(p) &&
      !p.includes("node_modules") &&
      (!prefix || p.startsWith(prefix)),
  );
  const paths: string[] = [];

  for (const configPath of configs) {
    const fileName = configPath.split("/").pop() ?? configPath;
    const dir = configPath.includes("/")
      ? configPath.replace(/\/vite\.config\.(js|cjs)$/, "")
      : ".";
    const pkgPath = dir === "." ? "package.json" : `${dir}/package.json`;

    const [configContent, pkgRaw] = await Promise.all([
      opts.fetchFile(configPath),
      opts.fetchFile(pkgPath),
    ]);
    if (!configContent || !pkgRaw) continue;

    let devDeps: Record<string, string> = {};
    let pkgType: string | undefined;
    try {
      const pkg = JSON.parse(pkgRaw) as {
        type?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      pkgType = pkg.type;
      devDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {
      continue;
    }

    if (!viteConfigNeedsEsmFix(fileName, configContent, pkgType, devDeps)) continue;

    if (!usesEsmSyntax(configContent)) {
      const esmContent = migrateViteConfigContentToEsm(configContent);
      opts.add(configPath, esmContent.endsWith("\n") ? esmContent : `${esmContent}\n`);
      paths.push(configPath);
    }

    const pkgPatched = patchPackageJsonTypeModule(pkgRaw);
    if (pkgPatched) {
      opts.add(pkgPath, pkgPatched);
      paths.push(pkgPath);
    }
  }

  return { patched: paths.length > 0 ? new Set(paths).size : 0, paths };
}
