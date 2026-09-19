import { getRepoSnapshot } from "../../../repo-snapshot.server";
import { buildProjectContext } from "../../../project-context.server";
import {
  buildPythonHealthWiring,
  buildPythonMiddlewareWiring,
  detectPythonFramework,
  patchPythonContent,
  pickPythonEntryPath,
} from "../../../backend-patch.server";
import { fetchFileContent } from "../../github";
import { findPythonEntrypoint } from "../languages/python/docker";
import type { FixCtx } from "../shared/fix-ctx";

export async function wirePythonEntry(fx: FixCtx) {
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
  // Python — wire middleware + health into detected entry point
  if (ctx.language === "python") {
    // Same fix as Dockerfile generation: search real file content for the actual
    // `= FastAPI(`/`Flask(` assignment instead of only checking a handful of fixed candidate
    // paths (confirmed too narrow against a real repo — entry point was at application/main.py,
    // not in the candidate list, which silently skipped wiring entirely while still reporting
    // "verified"). Snapshot is already fetched/cached by buildProjectContext earlier in this
    // request, so this is a cache hit, not a new call. Falls back to the old path-guess if the
    // snapshot fetch fails or content search finds nothing (e.g. a factory-function app pattern).
    let pyEntry: string | null = null;
    let snapshotEntryContent: string | null = null;
    try {
      const snap = await getRepoSnapshot(token, fullName);
      const found = findPythonEntrypoint(repoFilePaths, (p) => snap.files.get(p));
      if (found) {
        pyEntry = found.path;
        snapshotEntryContent = snap.files.get(found.path) ?? null;
      }
    } catch {
      // tarball fetch failed — fall through to path-guessing
    }
    if (!pyEntry) pyEntry = pickPythonEntryPath(repoFilePaths);

    const middlewareFixes = [
      "helmet",
      "cors",
      "rate-limit",
      "logger",
      "security-cookie-flags",
      "https-redirect",
    ].filter((id) => fixIds.includes(id));
    const needsHealthWire = fixIds.includes("health-check");

    if (pyEntry && (middlewareFixes.length > 0 || needsHealthWire)) {
      const entryContent =
        snapshotEntryContent ??
        fileMap.get(pyEntry) ??
        (await fetchFileContent(token, fullName, pyEntry));
      if (entryContent) {
        const pyFw = detectPythonFramework(entryContent);
        if (pyFw !== "unknown") {
          let patched = entryContent;
          let wiredMiddleware = false;
          let wiredHealth = false;

          if (middlewareFixes.length > 0) {
            const plan = buildPythonMiddlewareWiring(middlewareFixes, pyFw);
            const next = patchPythonContent(patched, plan);
            if (next) {
              patched = next;
              wiredMiddleware = true;
            }
          }
          if (needsHealthWire) {
            const healthPlan = buildPythonHealthWiring(pyFw);
            const next = patchPythonContent(patched, healthPlan);
            if (next) {
              patched = next;
              wiredHealth = true;
            }
          }

          if (patched !== entryContent) add(pyEntry, patched);
          if (wiredMiddleware) {
            for (const id of middlewareFixes) {
              note(id, "verified", `Middleware wired into ${pyEntry}`);
            }
          } else if (middlewareFixes.length > 0) {
            // Go/Ruby/PHP/Rust/C#/Elixir all warn here; Python was the one path that just went
            // quiet. The middleware files still get created, so silence reads as success.
            for (const id of middlewareFixes) {
              note(
                id,
                "warning",
                `Created the middleware module but could not wire it into ${pyEntry} — ` +
                  `register it on your ${pyFw} app manually`,
              );
            }
          }
          if (wiredHealth) {
            note("health-check", "verified", `GET /health wired into ${pyEntry}`);
          } else if (needsHealthWire) {
            note(
              "health-check",
              "warning",
              `Could not wire GET /health into ${pyEntry} — add the route manually`,
            );
          }
        } else if (middlewareFixes.length > 0 || needsHealthWire) {
          // Unknown framework skipped wiring entirely and said nothing at all.
          for (const id of [...middlewareFixes, ...(needsHealthWire ? ["health-check"] : [])]) {
            note(
              id,
              "warning",
              `Could not identify the Python framework in ${pyEntry} — wire the fix manually`,
            );
          }
        }
      } else if (middlewareFixes.length > 0 || needsHealthWire) {
        for (const id of [...middlewareFixes, ...(needsHealthWire ? ["health-check"] : [])]) {
          note(id, "warning", `Could not read ${pyEntry} — wire the fix manually`);
        }
      }
    } else if (middlewareFixes.length > 0 || needsHealthWire) {
      for (const id of [...middlewareFixes, ...(needsHealthWire ? ["health-check"] : [])]) {
        note(id, "warning", "Python entry point not found — wire the fix manually");
      }
    }
  }
}
