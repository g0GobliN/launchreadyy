import {
  buildPhpHealthWiring,
  buildPhpMiddlewareWiring,
  detectPhpFramework,
  patchPhpContent,
  pickPhpKernelPath,
  pickSymfonyRoutesPath,
} from "../../../backend-patch.server";
import { fetchFileContent } from "../../github";
import { HEALTH_CONTROLLER_SYMFONY } from "../languages/php/symfony";
import type { FixCtx } from "../shared/fix-ctx";

export async function wirePhpEntry(fx: FixCtx) {
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
  // PHP — wire Laravel middleware + health route
  if (ctx.language === "php") {
    const phpFw = detectPhpFramework(repoFilePaths, ctx.manifests.composerJson);
    const middlewareFixes = ["helmet", "cors", "rate-limit", "logger"].filter((id) =>
      fixIds.includes(id),
    );
    const needsHealthWire = fixIds.includes("health-check");

    if (middlewareFixes.length > 0 && phpFw === "laravel") {
      const kernelPath = pickPhpKernelPath(repoFilePaths);
      let wired = false;
      if (kernelPath) {
        const kernelContent =
          fileMap.get(kernelPath) ?? (await fetchFileContent(token, fullName, kernelPath));
        if (kernelContent) {
          const plan = buildPhpMiddlewareWiring(middlewareFixes, phpFw, kernelPath);
          if (plan && plan.path === kernelPath) {
            const next = patchPhpContent(kernelContent, plan);
            if (next) {
              add(kernelPath, next);
              wired = true;
              for (const id of middlewareFixes) {
                note(id, "verified", `Middleware wired into ${kernelPath}`);
              }
            }
          }
        }
      }
      if (!wired) {
        // Same gap as Go/Ruby/Python: the per-fixId switch already claimed "verified" for
        // creating the middleware file — without this, neither Kernel.php nor bootstrap/app.php
        // being found (or the expected anchor line having moved) failed silently.
        for (const id of middlewareFixes) {
          note(
            id,
            "warning",
            kernelPath
              ? `Could not auto-wire into ${kernelPath} — register the middleware manually`
              : `Neither app/Http/Kernel.php nor bootstrap/app.php found — register the middleware manually`,
          );
        }
      }
    }

    if (needsHealthWire && phpFw === "laravel") {
      const routesPath = repoFilePaths.includes("routes/web.php") ? "routes/web.php" : null;
      let wired = false;
      if (routesPath) {
        const routesContent =
          fileMap.get(routesPath) ?? (await fetchFileContent(token, fullName, routesPath));
        if (routesContent) {
          const plan = buildPhpHealthWiring(phpFw);
          if (plan) {
            const next = patchPhpContent(routesContent, plan);
            if (next) {
              add(routesPath, next);
              wired = true;
              note("health-check", "verified", `GET /health wired in ${routesPath}`);
            }
          }
        }
      }
      if (!wired) {
        note(
          "health-check",
          "warning",
          routesPath
            ? `Could not auto-wire GET /health into ${routesPath} — add it manually`
            : `routes/web.php not found — add a GET /health route manually`,
        );
      }
    }

    if (needsHealthWire && phpFw === "symfony") {
      add("src/Controller/HealthController.php", HEALTH_CONTROLLER_SYMFONY);
      const routesPath = pickSymfonyRoutesPath(repoFilePaths);
      const plan = buildPhpHealthWiring("symfony");
      if (plan) {
        if (routesPath) {
          const routesContent =
            fileMap.get(routesPath) ?? (await fetchFileContent(token, fullName, routesPath));
          if (routesContent) {
            const next = patchPhpContent(routesContent, plan);
            if (next) {
              add(routesPath, next);
              note("health-check", "verified", `GET /health wired in ${routesPath}`);
            }
          }
        } else {
          add(plan.path, plan.lines.join("\n") + "\n");
          note("health-check", "verified", `GET /health route added in ${plan.path}`);
        }
      }
    }
  }
}
