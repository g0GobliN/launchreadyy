import {
  buildCsharpHealthWiring,
  buildCsharpMiddlewareWiring,
  detectCsharpFramework,
  patchCsharpContent,
  pickCsharpProgramPath,
} from "../../../backend-patch.server";
import { fetchFileContent } from "../../github";
import type { FixCtx } from "../shared/fix-ctx";

export async function wireCsharpEntry(fx: FixCtx) {
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
  // C# — wire ASP.NET middleware + health into Program.cs
  if (ctx.language === "csharp") {
    const csharpEntry = pickCsharpProgramPath(repoFilePaths);
    const middlewareFixes = ["helmet", "cors", "rate-limit", "logger"].filter((id) =>
      fixIds.includes(id),
    );
    const needsHealthWire = fixIds.includes("health-check");

    if (csharpEntry && (middlewareFixes.length > 0 || needsHealthWire)) {
      const entryContent =
        fileMap.get(csharpEntry) ?? (await fetchFileContent(token, fullName, csharpEntry));
      if (entryContent) {
        const csFw = detectCsharpFramework(entryContent);
        if (csFw !== "unknown") {
          let patched = entryContent;

          if (middlewareFixes.length > 0) {
            const plan = buildCsharpMiddlewareWiring(middlewareFixes, csFw);
            if (plan) {
              const next = patchCsharpContent(patched, plan);
              if (next) patched = next;
            }
          }
          if (needsHealthWire) {
            const healthPlan = buildCsharpHealthWiring(csFw);
            if (healthPlan) {
              const next = patchCsharpContent(patched, healthPlan);
              if (next) patched = next;
            }
          }

          if (patched !== entryContent) {
            add(csharpEntry, patched);
            if (middlewareFixes.length > 0) {
              for (const id of middlewareFixes) {
                note(id, "verified", `Middleware wired into ${csharpEntry}`);
              }
            }
            if (needsHealthWire) {
              note("health-check", "verified", `GET /health wired into ${csharpEntry}`);
            }
          } else {
            for (const id of middlewareFixes) {
              note(id, "warning", `Could not auto-wire into ${csharpEntry} — add it manually`);
            }
            if (needsHealthWire) {
              note(
                "health-check",
                "warning",
                `Could not auto-wire GET /health into ${csharpEntry} — add it manually`,
              );
            }
          }
        } else {
          for (const id of middlewareFixes) {
            note(
              id,
              "warning",
              `${csharpEntry} doesn't look like ASP.NET Core — add the middleware manually`,
            );
          }
          if (needsHealthWire) {
            note(
              "health-check",
              "warning",
              `${csharpEntry} doesn't look like ASP.NET Core — add a GET /health endpoint manually`,
            );
          }
        }
      }
    }
  }
}
