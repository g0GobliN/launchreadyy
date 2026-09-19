import { getRepoSnapshot } from "../../../repo-snapshot.server";
import {
  buildGoHealthWiring,
  buildGoMiddlewareWiring,
  detectGoRouterStyle,
  extractGoModulePath,
  goMiddlewareFnNames,
  patchGoContent,
  pickGoEntryPath,
  wrapGoStdlibHandler,
  findGoRouterFile,
  wireGoRouterFile,
} from "../../../backend-patch.server";
import { fetchFileContent } from "../../github";
import { MIDDLEWARE_GIN_GO } from "../languages/go/templates";
import type { FixCtx } from "../shared/fix-ctx";

export async function wireGoEntry(fx: FixCtx) {
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
  // Go — wire middleware + health into main.go
  if (ctx.language === "go") {
    const goEntry = pickGoEntryPath(repoFilePaths);
    const modulePath = extractGoModulePath(ctx.manifests.goMod);
    const middlewareFixes = [
      "helmet",
      "cors",
      "rate-limit",
      "logger",
      "security-cookie-flags",
      "https-redirect",
    ].filter((id) => fixIds.includes(id));
    const needsHealthWire = fixIds.includes("health-check");

    if (goEntry && (middlewareFixes.length > 0 || needsHealthWire)) {
      const entryContent =
        fileMap.get(goEntry) ?? (await fetchFileContent(token, fullName, goEntry));
      if (entryContent) {
        // The router constructor commonly lives in a submodule, not the picked entry file
        // (confirmed against two real repos: mux.NewRouter() in app/app.go for
        // mingrammer/go-todo-rest-api-example, echo.New() in router/router.go for
        // xesina/golang-echo-realworld-example-app) — same submodule pattern and same
        // snapshot-search fallback approach as the Rust wiring fix.
        let goTarget = goEntry;
        let targetContent = entryContent;
        let style = detectGoRouterStyle(entryContent);
        if (style === "unknown" || style === "stdlib") {
          try {
            const snap = await getRepoSnapshot(token, fullName);
            const found = findGoRouterFile(repoFilePaths, (p) => snap.files.get(p), null);
            if (found && found !== goEntry) {
              const c =
                fileMap.get(found) ??
                snap.files.get(found) ??
                (await fetchFileContent(token, fullName, found));
              if (c) {
                goTarget = found;
                targetContent = c;
                style = detectGoRouterStyle(c);
              }
            }
          } catch {
            // snapshot fetch failed — keep the entry-file behavior
          }
        }
        if (style === "gin" && !fileMap.has("internal/middleware/gin.go")) {
          add("internal/middleware/gin.go", MIDDLEWARE_GIN_GO);
        }
        let patched = targetContent;

        if (style === "gorilla" || style === "echo") {
          const next = wireGoRouterFile(patched, {
            fixIds: middlewareFixes,
            style,
            modulePath,
            health: needsHealthWire,
          });
          if (next) patched = next;
        } else {
          if (middlewareFixes.length > 0 && style !== "unknown") {
            if (style === "stdlib") {
              const fns = goMiddlewareFnNames(middlewareFixes);
              const withImports = patchGoContent(patched, {
                importLines: [`import "${modulePath}/internal/middleware"`],
                lines: [],
              });
              if (withImports) patched = withImports;
              const wrapped = wrapGoStdlibHandler(patched, fns);
              if (wrapped) patched = wrapped;
            } else {
              const plan = buildGoMiddlewareWiring(middlewareFixes, style, modulePath);
              if (plan) {
                const next = patchGoContent(patched, plan);
                if (next) patched = next;
              }
            }
          }
          if (needsHealthWire && style !== "unknown") {
            const healthPlan = buildGoHealthWiring(style, modulePath);
            if (healthPlan) {
              const next = patchGoContent(patched, healthPlan);
              if (next) patched = next;
            }
          }
        }

        if (patched !== targetContent) {
          add(goTarget, patched);
          if (middlewareFixes.length > 0) {
            for (const id of middlewareFixes) {
              note(id, "verified", `Middleware wired into ${goTarget}`);
            }
          }
          if (needsHealthWire) {
            note("health-check", "verified", `GET /health wired into ${goTarget}`);
          }
        } else {
          // The per-fixId switch already wrote a "verified: file created" note for each of
          // these regardless of wiring outcome — without this, a repo using a router style we
          // don't recognize (e.g. fiber or ozzo-routing, both real and in use) silently got
          // zero actual wiring while still showing "verified", with no indication the file is
          // inert until manually imported.
          const reason =
            style === "unknown"
              ? `Router style in ${goTarget} not recognized (only chi/gin/gorilla-mux/echo/net-http are auto-wired) — import and call the middleware manually`
              : `Could not find an anchor point in ${goTarget} to wire this in automatically — add it manually`;
          for (const id of middlewareFixes) {
            note(id, "warning", reason);
          }
          if (needsHealthWire) {
            note(
              "health-check",
              "warning",
              style === "unknown"
                ? `Router style in ${goTarget} not recognized — add a GET /health handler manually`
                : `Could not find an anchor point in ${goTarget} to wire /health automatically — add it manually`,
            );
          }
        }
        if (style === "gin" && ctx.manifests.goMod && !/gin-gonic\/gin/.test(ctx.manifests.goMod)) {
          for (const id of middlewareFixes) {
            note(
              id,
              "warning",
              "Add github.com/gin-gonic/gin to go.mod — run `go get github.com/gin-gonic/gin`",
            );
          }
        }
      }
    }
  }
}
