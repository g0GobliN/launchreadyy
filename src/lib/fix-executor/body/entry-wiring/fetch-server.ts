import {
  buildRequestPipelineContent,
  fetchServerEntryPath,
  isFetchBasedServer,
  patchFetchServerFile,
} from "../../../fetch-server-patch.server";
import { fetchFileContent } from "../../github";
import type { FixCtx } from "../shared/fix-ctx";

export async function wireFetchServerMiddleware(fx: FixCtx) {
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
  // Fetch-based server (TanStack Start) — wire middleware pipeline
  const fetchMiddlewareFixes = [
    "helmet",
    "rate-limit",
    "cors",
    "logger",
    "security-cookie-flags",
    "https-redirect",
  ].filter((id) => fixIds.includes(id) && !ctx.hasExpress);
  if (fetchMiddlewareFixes.length > 0 && isFetchBasedServer(ctx)) {
    add("src/lib/request-pipeline.ts", buildRequestPipelineContent(fetchMiddlewareFixes));
    const serverPath = fetchServerEntryPath(ctx);
    if (serverPath) {
      const existing = fileMap.get(serverPath);
      const serverContent = existing ?? (await fetchFileContent(token, fullName, serverPath));
      if (serverContent) {
        const patched = patchFetchServerFile(serverContent);
        if (patched) {
          add(serverPath, patched);
          for (const id of fetchMiddlewareFixes) {
            note(id, "verified", `Request pipeline wired into ${serverPath}`);
          }
        } else {
          for (const id of fetchMiddlewareFixes) {
            note(
              id,
              "warning",
              `Helpers added in src/lib/ — import runRequestPipeline from ./lib/request-pipeline in ${serverPath}`,
            );
          }
        }
      }
    }
  }
}
