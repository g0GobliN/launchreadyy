import { ERROR_BOUNDARY_TSX } from "../react/error-boundary";
import { DB_POOL } from "../node/db";
import type { FixCtx } from "../shared/fix-ctx";

export function handleGitignoreEnv(fx: FixCtx) {
  const {
    token,
    fullName,
    fixIds,
    effectiveFixIds,
    opts,
    framework,
    repoName,
    aiFiles,
    fileMap,
    pkgMods,
    gitignoreAppends,
    readmeSections,
    verificationNotes,
    add,
    note,
    ctx,
    pkgMeta,
    pm,
    repoFilePaths,
    mergedDeps,
    fw,
    javaBasePackage,
    javaApplicationPath,
    addJava,
    kotlinBasePackage,
    kotlinApplicationPath,
    addKotlin,
    ciProfileInput,
    buildCiYaml,
    phpFw,
    rustFwHint,
    rustMiddlewareSrc,
    bundled,
  } = fx;
  // We can only stop FUTURE commits — the secret is already in git history and must be
  // rotated by the user. Make that unmissable in the verification note.
  gitignoreAppends.push(".env", ".env.local", ".env.*.local");
  note(
    "gitignore-env",
    "warning",
    "Added .env patterns to .gitignore so this stops happening going forward. This does NOT remove the already-committed secret from git history — rotate every credential in that file immediately, then consider scrubbing history (git filter-repo / BFG) if the repo is public.",
  );
}

export function handleErrorBoundary(fx: FixCtx) {
  const {
    token,
    fullName,
    fixIds,
    effectiveFixIds,
    opts,
    framework,
    repoName,
    aiFiles,
    fileMap,
    pkgMods,
    gitignoreAppends,
    readmeSections,
    verificationNotes,
    add,
    note,
    ctx,
    pkgMeta,
    pm,
    repoFilePaths,
    mergedDeps,
    fw,
    javaBasePackage,
    javaApplicationPath,
    addJava,
    kotlinBasePackage,
    kotlinApplicationPath,
    addKotlin,
    ciProfileInput,
    buildCiYaml,
    phpFw,
    rustFwHint,
    rustMiddlewareSrc,
    bundled,
  } = fx;
  const usesSrcAppDir = repoFilePaths.some((p) => p === "src/app" || p.startsWith("src/app/"));
  add(`${usesSrcAppDir ? "src/app" : "app"}/error.tsx`, ERROR_BOUNDARY_TSX);
  note("error-boundary", "verified", "Next.js app router error boundary");
}

export function handleDbPool(fx: FixCtx) {
  const {
    token,
    fullName,
    fixIds,
    effectiveFixIds,
    opts,
    framework,
    repoName,
    aiFiles,
    fileMap,
    pkgMods,
    gitignoreAppends,
    readmeSections,
    verificationNotes,
    add,
    note,
    ctx,
    pkgMeta,
    pm,
    repoFilePaths,
    mergedDeps,
    fw,
    javaBasePackage,
    javaApplicationPath,
    addJava,
    kotlinBasePackage,
    kotlinApplicationPath,
    addKotlin,
    ciProfileInput,
    buildCiYaml,
    phpFw,
    rustFwHint,
    rustMiddlewareSrc,
    bundled,
  } = fx;
  add("src/lib/db.ts", DB_POOL);
  // Confirmed against a real tsc run: `pg-pool` ships no bundled types of its own, and
  // @types/pg only covers the separate `pg` package — without @types/pg-pool (a distinct
  // package), this fails to compile with TS7016 ("Could not find a declaration file for
  // module 'pg-pool'") the moment a project actually runs typecheck.
  Object.assign(pkgMods.deps, { "pg-pool": "^3.7.0", "@types/pg-pool": "^2.0.0" });
  note(
    "db-pool",
    "warning",
    "SSL is set to rejectUnauthorized: true (safe default). If your DB uses a self-signed cert, you may need to set it to false — but only after confirming your cert setup.",
  );
}
