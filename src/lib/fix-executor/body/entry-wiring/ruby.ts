import {
  buildRubyHealthWiring,
  buildRubyMiddlewareWiring,
  detectRubyFramework,
  patchRubyContent,
  pickRubyConfigPath,
  pickRubyRoutesPath,
} from "../../../backend-patch.server";
import { fetchFileContent } from "../../github";
import type { FixCtx } from "../shared/fix-ctx";

export async function wireRubyEntry(fx: FixCtx) {
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
  // Ruby — wire Rack middleware + health route
  if (ctx.language === "ruby") {
    const middlewareFixes = ["helmet", "cors", "rate-limit", "logger"].filter((id) =>
      fixIds.includes(id),
    );
    const needsHealthWire = fixIds.includes("health-check");

    if (middlewareFixes.length > 0) {
      const configPath = pickRubyConfigPath(repoFilePaths);
      let wired = false;
      if (configPath) {
        const configContent =
          fileMap.get(configPath) ?? (await fetchFileContent(token, fullName, configPath));
        if (configContent) {
          const rbFw = detectRubyFramework(configContent, configPath);
          const plan = buildRubyMiddlewareWiring(middlewareFixes, rbFw);
          if (plan && plan.path === configPath) {
            const next = patchRubyContent(configContent, plan);
            if (next) {
              add(configPath, next);
              wired = true;
              for (const id of middlewareFixes) {
                note(id, "verified", `Middleware wired into ${configPath}`);
              }
            }
          }
        }
      }
      if (!wired) {
        // Same gap as Go/Python: the per-fixId switch already claimed "verified" for creating
        // the middleware file, regardless of whether it could actually be wired into the app —
        // without this, config.ru/config/application.rb missing, an unrecognized Rack setup, or
        // a changed anchor line all failed silently with no indication to the user.
        for (const id of middlewareFixes) {
          note(
            id,
            "warning",
            configPath
              ? `Could not auto-wire into ${configPath} — add the middleware manually`
              : `No config.ru / config/application.rb found — add the middleware manually`,
          );
        }
      }
    }

    if (needsHealthWire) {
      const routesPath = pickRubyRoutesPath(repoFilePaths);
      let wired = false;
      if (routesPath) {
        const routesContent =
          fileMap.get(routesPath) ?? (await fetchFileContent(token, fullName, routesPath));
        if (routesContent) {
          const plan = buildRubyHealthWiring();
          const next = patchRubyContent(routesContent, plan);
          if (next) {
            add(routesPath, next);
            wired = true;
            note("health-check", "verified", `GET /health wired in ${routesPath}`);
          }
        }
      }
      if (!wired) {
        note(
          "health-check",
          "warning",
          routesPath
            ? `Could not auto-wire GET /health into ${routesPath} — add it manually`
            : `No routes file found — add a GET /health route manually`,
        );
      }
    }
  }
}
