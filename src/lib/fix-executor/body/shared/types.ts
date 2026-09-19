export type NodePm = "npm" | "pnpm" | "yarn" | "bun";

export interface PmDockerCommands {
  /** Manifest + lockfile globs to COPY — one entry per file, so a --from= copy can prefix each. */
  lockfileFiles: string[];
  setupLine: string;
  install: string;
  installProd: string;
  run: (script: string) => string;
  startCmd: string;
}

export interface PackageJsonMeta {
  scripts: Record<string, string>;
  nodeVersion: string;
  hasBackend: boolean;
  packageManager?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}
