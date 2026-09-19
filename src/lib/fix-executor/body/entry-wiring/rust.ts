import { getRepoSnapshot } from "../../../repo-snapshot.server";
import {
  buildRustHealthWiring,
  buildRustMiddlewareWiring,
  detectRustFramework,
  findRustAppFile,
  patchRustContent,
  pickRustEntryPath,
} from "../../../backend-patch.server";
import { fetchFileContent } from "../../github";
import { dockerfile } from "../docker/index";
import type { FixCtx } from "../shared/fix-ctx";

export async function wireRustEntry(fx: FixCtx) {
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
  // Rust — wire Axum/Actix middleware + health
  if (ctx.language === "rust") {
    const rustEntry = pickRustEntryPath(repoFilePaths);
    const middlewareFixes = ["helmet", "cors", "rate-limit", "logger"].filter((id) =>
      fixIds.includes(id),
    );
    const needsHealthWire = fixIds.includes("health-check");

    if (rustEntry && (middlewareFixes.length > 0 || needsHealthWire)) {
      const entryContent =
        fileMap.get(rustEntry) ?? (await fetchFileContent(token, fullName, rustEntry));
      if (entryContent) {
        const rsFw = detectRustFramework(entryContent, ctx.manifests.cargoToml);
        if (rsFw === "axum" || rsFw === "actix") {
          // App::new()/Router::new() commonly live in a submodule, not the crate-root entry file
          // (confirmed against a real repo) — search all .rs files for it via the repo snapshot,
          // same content-search-over-snapshot approach as the Python/dockerfile fix, falling
          // back to the entry file itself if nothing else matches.
          let appFile = rustEntry;
          try {
            const snap = await getRepoSnapshot(token, fullName);
            appFile =
              findRustAppFile(repoFilePaths, (p) => snap.files.get(p), rsFw, rustEntry) ??
              rustEntry;
          } catch {
            // snapshot fetch failed — fall back to treating the entry file as the app file
          }
          const appContent =
            appFile === rustEntry
              ? entryContent
              : (fileMap.get(appFile) ?? (await fetchFileContent(token, fullName, appFile)));

          let entryPatched = entryContent;
          if (rsFw === "axum" && !entryPatched.includes("mod middleware")) {
            entryPatched = entryPatched.replace(
              /^fn main/m,
              "mod middleware;\nmod health;\n\nfn main",
            );
          }
          if (rsFw === "actix" && !entryPatched.includes("mod middleware")) {
            entryPatched = entryPatched.replace(/^fn main/m, "mod middleware;\n\nfn main");
          }

          let appPatched = appContent ?? undefined;
          let wiredMiddleware = false;
          let wiredHealth = false;
          if (appPatched) {
            if (middlewareFixes.length > 0) {
              const plan = buildRustMiddlewareWiring(middlewareFixes, rsFw);
              if (plan) {
                const next = patchRustContent(appPatched, plan);
                if (next) {
                  appPatched = next;
                  wiredMiddleware = true;
                }
              }
            }
            if (needsHealthWire) {
              const healthPlan = buildRustHealthWiring(rsFw);
              if (healthPlan) {
                const next = patchRustContent(appPatched, healthPlan);
                if (next) {
                  appPatched = next;
                  wiredHealth = true;
                }
              }
            }
          }

          if (entryPatched !== entryContent) add(rustEntry, entryPatched);
          if (appPatched && appPatched !== appContent) add(appFile, appPatched);

          if (wiredMiddleware) {
            for (const id of middlewareFixes) {
              note(id, "verified", `Middleware wired into ${appFile}`);
            }
          } else {
            for (const id of middlewareFixes) {
              note(id, "warning", `Could not auto-wire into ${appFile} — add it manually`);
            }
          }
          if (needsHealthWire) {
            if (wiredHealth) {
              note("health-check", "verified", `GET /health wired into ${appFile}`);
            } else {
              note(
                "health-check",
                "warning",
                `Could not auto-wire GET /health into ${appFile} — add it manually`,
              );
            }
          }
        } else {
          // Neither Axum nor Actix detected — same "file created but never wired" gap.
          for (const id of middlewareFixes) {
            note(
              id,
              "warning",
              `${rustEntry} doesn't look like Axum or Actix — add the middleware manually`,
            );
          }
          if (needsHealthWire) {
            note(
              "health-check",
              "warning",
              `${rustEntry} doesn't look like Axum or Actix — add a GET /health handler manually`,
            );
          }
        }
      }
    }
  }
}
