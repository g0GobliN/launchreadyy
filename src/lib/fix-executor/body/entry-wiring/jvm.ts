import type { FixCtx } from "../shared/fix-ctx";

export function wireJvmEntry(fx: FixCtx) {
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
  // Java — Spring Boot component scan picks up filters/controllers in app package tree
  if (ctx.language === "java" && javaApplicationPath) {
    for (const id of ["helmet", "cors", "rate-limit", "logger"] as const) {
      if (!fixIds.includes(id)) continue;
      note(
        id,
        "verified",
        `${id} components under ${javaBasePackage} — auto-scanned from ${javaApplicationPath}`,
      );
    }
  }
}
