import {
  buildElixirHealthWiring,
  buildElixirPlugWiring,
  detectElixirFramework,
  patchElixirContent,
  pickElixirEndpointPath,
  pickElixirRouterPath,
} from "../../../backend-patch.server";
import { fetchFileContent } from "../../github";
import type { FixCtx } from "../shared/fix-ctx";

export async function wireElixirEntry(fx: FixCtx) {
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
  // Elixir — wire Phoenix plugs + health route
  if (ctx.language === "elixir") {
    const exFw = detectElixirFramework(ctx.manifests.mixExs);
    const middlewareFixes = ["helmet", "cors", "rate-limit", "logger"].filter((id) =>
      fixIds.includes(id),
    );
    const needsHealthWire = fixIds.includes("health-check");
    const endpointPath = pickElixirEndpointPath(repoFilePaths);
    const routerPath = pickElixirRouterPath(repoFilePaths);

    if (middlewareFixes.length > 0) {
      let wired = false;
      if (exFw === "phoenix" && endpointPath) {
        const endpointContent =
          fileMap.get(endpointPath) ?? (await fetchFileContent(token, fullName, endpointPath));
        if (endpointContent) {
          const plan = buildElixirPlugWiring(middlewareFixes, exFw, endpointPath);
          if (plan && plan.path === endpointPath) {
            const next = patchElixirContent(endpointContent, plan);
            if (next) {
              add(endpointPath, next);
              wired = true;
              for (const id of middlewareFixes) {
                note(id, "verified", `Plugs wired into ${endpointPath}`);
              }
            }
          }
        }
      }
      if (!wired) {
        for (const id of middlewareFixes) {
          note(
            id,
            "warning",
            exFw === "phoenix"
              ? `Could not auto-wire into ${endpointPath ?? "*_web/endpoint.ex"} — add the plug manually`
              : `Phoenix not detected — add the plug to your endpoint manually`,
          );
        }
      }
    }

    if (needsHealthWire) {
      let wired = false;
      if (exFw === "phoenix" && routerPath) {
        const routerContent =
          fileMap.get(routerPath) ?? (await fetchFileContent(token, fullName, routerPath));
        if (routerContent) {
          const plan = buildElixirHealthWiring(exFw, routerPath);
          if (plan) {
            const next = patchElixirContent(routerContent, plan);
            if (next) {
              add(routerPath, next);
              wired = true;
              note("health-check", "verified", `GET /health wired in ${routerPath}`);
            }
          }
        }
      }
      if (!wired) {
        note(
          "health-check",
          "warning",
          exFw === "phoenix"
            ? `Could not auto-wire GET /health into ${routerPath ?? "*_web/router.ex"} — add it manually`
            : `Phoenix not detected — add a GET /health route manually`,
        );
      }
    }
  }
}
