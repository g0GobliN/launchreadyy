import { fetchFileContent, patchPackageJson } from "../github";
import { buildReadmeSections } from "../../readme-setup";
import { detectRepoStack } from "../../language-setup";
import { ENV_EXAMPLE } from "./shared/constants";
import type { FixCtx } from "./shared/fix-ctx";

export async function applyEnvExample(fx: FixCtx) {
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
  // .env.example — merge detected vars into existing file, only create from scratch if none exists
  const needsEnvExample = fixIds.includes("env-example") && !fixIds.includes("env-example-ai");
  const detectedEnvVars = needsEnvExample ? ctx.envVars : [];
  if (needsEnvExample) {
    const existingEnvExample = await fetchFileContent(token, fullName, ".env.example").catch(
      () => null,
    );
    if (existingEnvExample) {
      const missing = detectedEnvVars.filter((v) => !existingEnvExample.includes(v));
      if (missing.length > 0) {
        add(
          ".env.example",
          existingEnvExample.trimEnd() + "\n" + missing.map((v) => `${v}=`).join("\n") + "\n",
        );
      }
    } else {
      const lines =
        detectedEnvVars.length > 0
          ? ["# Copy to .env and fill in", ...detectedEnvVars.map((v) => `${v}=`)]
          : ENV_EXAMPLE.trim().split("\n");
      add(".env.example", lines.join("\n") + "\n");
    }
  }
}

export function applyReadme(fx: FixCtx) {
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
  // README — repo-specific setup docs (package manager, scripts, env vars)
  const needsEnvExample = fixIds.includes("env-example") && !fixIds.includes("env-example-ai");
  const detectedEnvVars = needsEnvExample ? ctx.envVars : [];
  const needsReadme = fixIds.includes("readme") && !fixIds.includes("readme-ai");
  const needsEnvOnlyReadme = needsEnvExample && !needsReadme && !fixIds.includes("readme-ai");
  if (needsReadme || needsEnvOnlyReadme) {
    const envVars = needsEnvExample ? detectedEnvVars : [];

    if (needsReadme) {
      const stack = detectRepoStack(ctx.filePaths, framework, ctx.manifests);
      readmeSections.push(
        ...buildReadmeSections({
          fullName,
          repoName,
          framework: stack.label || ctx.stack.profile,
          packageManager: pm,
          scripts: pkgMeta.scripts,
          nodeVersion: pkgMeta.nodeVersion,
          envVars,
          withEnvStep: needsEnvExample,
          stack,
        }),
      );
    } else if (needsEnvOnlyReadme) {
      readmeSections.push(
        `## Environment variables\n\nCopy \`.env.example\` to \`.env\` and fill in the required values:\n\n\`\`\`bash\ncp .env.example .env\n\`\`\`\n\nRequired variables:\n\n${envVars.length ? envVars.map((v) => `- \`${v}\``).join("\n") : "See `.env.example` for the full list."}`,
      );
    }
  }
}

export async function mergeGeneratedArtifacts(fx: FixCtx) {
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
  // AI-generated file content (deterministic templates win over cached AI sidecars)
  if (aiFiles) {
    for (const f of aiFiles) {
      if (/^playwright\.config\.(ts|js|mjs)$/i.test(f.path)) continue;
      add(f.path, f.content);
    }
  }

  // Merge all package.json modifications into the app's own manifest, not the workspace root.
  const pkgContent = await patchPackageJson(token, fullName, pkgMods, ctx.appDir);
  if (pkgContent) add(ctx.appDir ? `${ctx.appDir}/package.json` : "package.json", pkgContent);

  // Append .gitignore entries
  if (gitignoreAppends.length) {
    const current = await fetchFileContent(token, fullName, ".gitignore");
    const base = current ? current.trimEnd() + "\n" : "";
    add(".gitignore", base + gitignoreAppends.join("\n") + "\n");
  }

  // README modifications (deduplicated across fixes)
  if (readmeSections.length) {
    const current = await fetchFileContent(token, fullName, "README.md");
    const base = current ? current.trimEnd() + "\n\n" : "";
    add("README.md", base + readmeSections.join("\n\n") + "\n");
  }
}

export async function applyCrossCuttingPatches(fx: FixCtx) {
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
  const { patchCiWorkflowsForManifestDrift } = await import("../../fix-recovery.server");
  const ciRelaxed = await patchCiWorkflowsForManifestDrift({
    token,
    repoFullName: fullName,
    repoFilePaths,
    fileMap,
    add,
  });
  if (ciRelaxed) {
    note(
      "github-actions",
      "verified",
      "CI install steps relaxed — dependency manifest changed without lockfile update",
    );
  }

  const { patchViteEsmConfigs } = await import("../../vite-esm-config");
  const viteEsm = await patchViteEsmConfigs({
    filePaths: repoFilePaths,
    fetchFile: (path) => fetchFileContent(token, fullName, path),
    add,
    appDir: ctx.appDir,
  });
  if (viteEsm.patched > 0) {
    note(
      "ci-ai",
      "verified",
      `Vite ESM fix — set type=module for ${viteEsm.paths.filter((p) => p.endsWith("package.json")).join(", ") || "workspace packages"} (fixes Vitest/Vite 5 CI errors)`,
    );
  }
}
