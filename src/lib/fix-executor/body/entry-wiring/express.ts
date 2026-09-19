import { patchSourceFile, fetchFileContent, findExpressApp } from "../../github";
import { detectEntryPoint } from "../shared/helpers";
import type { FixCtx } from "../shared/fix-ctx";

export async function wireExpressMiddleware(fx: FixCtx) {
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
  // Express middleware — wire imports + usage into detected entry point (Express only)
  const expressMiddlewareFixes = ctx.hasExpress
    ? ["helmet", "rate-limit", "logger", "cors", "security-cookie-flags", "https-redirect"].filter(
        (id) => fixIds.includes(id),
      )
    : [];
  if (expressMiddlewareFixes.length > 0) {
    const entryPoint = await detectEntryPoint(token, fullName, "Express");
    // Resolve the real declaration before building any usage line. The anchor used to be the
    // literal "const app = express()", which misses `var`/`let`/typed declarations and any app
    // not named `app` — and missing was silent, so a fix that wired nothing still reported
    // "verified". Anchor on the line this repo actually has, and call the variable it actually
    // uses.
    const entryLines = entryPoint
      ? ((await fetchFileContent(token, fullName, entryPoint)) ?? "").split("\n")
      : [];
    const appDecl = entryLines.length ? findExpressApp(entryLines) : null;
    const anchor = appDecl?.line ?? "";
    const appVar = appDecl?.varName ?? "app";

    const indexImports: string[] = [];
    const indexUsages: { after: string; lines: string[] }[] = [];

    if (fixIds.includes("helmet")) {
      indexImports.push(`import { applyHelmet } from "./middleware/security";`);
      indexUsages.push({ after: anchor, lines: [`applyHelmet(${appVar});`] });
    }
    if (fixIds.includes("rate-limit")) {
      indexImports.push(`import { applyRateLimit } from "./middleware/rate-limit";`);
      indexUsages.push({ after: anchor, lines: [`applyRateLimit(${appVar});`] });
    }
    if (fixIds.includes("logger")) {
      indexImports.push(`import { requestLogger } from "./middleware/logging";`);
      indexUsages.push({ after: anchor, lines: [`${appVar}.use(requestLogger);`] });
    }
    if (fixIds.includes("cors")) {
      indexImports.push(`import { applyCors } from "./middleware/cors";`);
      indexUsages.push({ after: anchor, lines: [`applyCors(${appVar});`] });
    }
    // Pushed last on purpose: patchSourceFile re-anchors every usage on the same declaration line
    // and inserts right after it, which reverses insertion order — pushing cookie-flags then
    // https-redirect last makes https-redirect land first in the generated file (short-circuits
    // before anything else) with cookie-flags right behind it.
    if (fixIds.includes("security-cookie-flags")) {
      indexImports.push(`import { applySecureCookies } from "./middleware/secure-cookies";`);
      indexUsages.push({ after: anchor, lines: [`applySecureCookies(${appVar});`] });
    }
    if (fixIds.includes("https-redirect")) {
      indexImports.push(`import { applyHttpsRedirect } from "./middleware/https-redirect";`);
      indexUsages.push({ after: anchor, lines: [`applyHttpsRedirect(${appVar});`] });
    }

    if (!entryPoint) {
      for (const id of expressMiddlewareFixes) {
        note(id, "warning", `Express entry point not found — add middleware imports manually`);
      }
    } else if (!appDecl) {
      // Imports without their usage lines is the failure this whole path exists to avoid: it
      // leaves dead imports that can fail lint/noUnusedLocals while the app stays unprotected.
      // Skip the patch and say so, rather than shipping a PR that looks complete.
      for (const id of expressMiddlewareFixes) {
        note(
          id,
          "warning",
          `Found ${entryPoint} but no \`= express()\` declaration to anchor on — ` +
            `apply the middleware manually`,
        );
      }
    } else {
      const patched = await patchSourceFile(token, fullName, entryPoint, indexImports, indexUsages);
      if (patched && patched.missed.length === 0) {
        add(entryPoint, patched.content);
        for (const id of expressMiddlewareFixes) {
          note(id, "verified", `middleware wired into ${entryPoint}`);
        }
      } else if (patched) {
        // Anchor resolved but some usage still did not land — report honestly rather than
        // claiming "verified" for a partially-applied patch.
        add(entryPoint, patched.content);
        for (const id of expressMiddlewareFixes) {
          note(
            id,
            "warning",
            `Partially wired into ${entryPoint} — ${patched.missed.length} usage line(s) ` +
              `could not be placed; check the middleware is applied`,
          );
        }
      } else {
        for (const id of expressMiddlewareFixes) {
          note(
            id,
            "warning",
            `Found ${entryPoint} but could not patch — add middleware imports manually`,
          );
        }
      }
    }
  }
}
