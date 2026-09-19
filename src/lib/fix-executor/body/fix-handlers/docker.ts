import { getRepoSnapshot } from "../../../repo-snapshot.server";
import { buildProjectContext } from "../../../project-context.server";
import { fetchFileContent } from "../../github";
import { dockerfileNode, dockerfileNodeRuntime, DOCKER_IGNORE } from "../node/docker";
import { nginxConf } from "../node/nginx";
import {
  NEXT_CONFIG_STANDALONE,
  NEXT_CONFIG_STANDALONE_PATH,
  patchNextConfigStandalone,
} from "../next/config";
import { dockerfile } from "../docker/index";
import { fetchCsprojContent } from "../languages/csharp/docker";
import type { FixCtx } from "../shared/fix-ctx";

export async function handleDockerfile(fx: FixCtx) {
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
  const expressDockerfile = (pkgMeta.scripts.build ?? "").includes("tsc")
    ? dockerfileNode(pm)
    : dockerfileNodeRuntime(pm);
  const csprojContent = fw === "C#" ? await fetchCsprojContent(token, fullName, repoFilePaths) : "";
  // Real content search instead of path-guessing for the entry point — the tarball
  // snapshot already has full file content in memory (see repo-snapshot.server.ts), so
  // this is a cache hit, not a new fetch, in the overwhelmingly common case where
  // buildProjectContext already pulled the snapshot earlier in this same request.
  let dockerfileGetContent: ((path: string) => string | undefined) | undefined;
  if (fw === "Python") {
    try {
      const snap = await getRepoSnapshot(token, fullName);
      dockerfileGetContent = (path) => snap.files.get(path);
    } catch {
      dockerfileGetContent = undefined;
    }
  }
  add(
    "Dockerfile",
    fw === "Express" || (fw === "unknown" && ctx.isNodeProject)
      ? expressDockerfile
      : dockerfile(fw, pm, ctx.filePaths, ctx.manifests, csprojContent, dockerfileGetContent),
  );
  add(".dockerignore", DOCKER_IGNORE);

  if (framework === "Next.js") {
    // Standalone Dockerfile requires output: "standalone" in next.config — patch or create it
    let configPatched = false;
    for (const configPath of ["next.config.ts", "next.config.js", "next.config.mjs"]) {
      const existing = await fetchFileContent(token, fullName, configPath);
      if (existing !== null) {
        const patched = patchNextConfigStandalone(existing);
        if (patched !== null) {
          add(configPath, patched);
          note("dockerfile", "verified", `${configPath} patched: output: "standalone" added`);
        } else {
          note("dockerfile", "verified", `${configPath} already has output: "standalone"`);
        }
        configPatched = true;
        break;
      }
    }
    if (!configPatched) {
      add(NEXT_CONFIG_STANDALONE_PATH, NEXT_CONFIG_STANDALONE);
      note(
        "dockerfile",
        "verified",
        `${NEXT_CONFIG_STANDALONE_PATH} created with output: "standalone"`,
      );
    }
  } else if (fw === "Vite" || fw === "React") {
    add("nginx.conf", nginxConf(pkgMeta.hasBackend));
    note(
      "dockerfile",
      "verified",
      `nginx Dockerfile added${pkgMeta.hasBackend ? " with /api/ proxy" : ""}`,
    );
  } else {
    note("dockerfile", "verified", "Node.js server Dockerfile added");
  }
}
