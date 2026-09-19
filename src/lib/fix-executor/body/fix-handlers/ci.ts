import { projectUsesTypeScript } from "../../../project-ci.server";
import { buildLanguageCiWorkflow } from "../../../project-ci-lang.server";
import { fetchFileContent } from "../../github";
import { ensureTypecheckScript } from "../shared/helpers";
import { fetchCsprojContent } from "../languages/csharp/docker";
import type { FixCtx } from "../shared/fix-ctx";

export async function handleGithubActions(fx: FixCtx) {
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
  if (ctx.hasExistingCi) {
    note(
      "github-actions",
      "warning",
      "Existing GitHub Actions workflow found — skipped to avoid overwrite",
    );
    return;
  }
  if (!ctx.isNodeProject) {
    const csprojContent =
      fw === "C#" ? await fetchCsprojContent(token, fullName, repoFilePaths) : "";
    const langWf = buildLanguageCiWorkflow(ctx, csprojContent);
    if (langWf) {
      add(".github/workflows/ci.yml", langWf);
      note("github-actions", "verified", `${ctx.resolvedFramework} CI · manifest-driven workflow`);
    } else {
      note(
        "github-actions",
        "warning",
        `No deterministic CI template for ${ctx.resolvedFramework} — use ci-ai`,
      );
    }
    return;
  }

  const nvmrc = await fetchFileContent(token, fullName, ".nvmrc");
  const nodeVersion = nvmrc
    ? (nvmrc.trim().replace(/^v/, "").match(/\d+/)?.[0] ?? pkgMeta.nodeVersion)
    : pkgMeta.nodeVersion;

  if (projectUsesTypeScript(pkgMeta, repoFilePaths)) {
    ensureTypecheckScript(pkgMeta, pkgMods, repoFilePaths);
  }

  const profile = ciProfileInput();
  add(".github/workflows/ci.yml", buildCiYaml(profile));

  const nodeSource = nvmrc ? ".nvmrc" : pkgMeta.nodeVersion !== "20" ? ".nvmrc" : "default";
  const bundleNote =
    bundled.length > 0 ? ` · bundled ${bundled.join(" + ")} for production gates` : "";
  note(
    "github-actions",
    profile.steps.length > 0 ? "verified" : "warning",
    `Production CI (quality · test · build · audit · secret-scan)${bundleNote} · ${profile.summary}`,
  );
}

export async function handleCiAi(fx: FixCtx) {
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
  if (ctx.hasExistingCi) {
    note("ci-ai", "warning", "Existing GitHub Actions workflow found — skipped to avoid overwrite");
    return;
  }
  const hasAiCi = aiFiles?.some((f) => f.fixId === "ci-ai");
  if (!hasAiCi && !ctx.isNodeProject) {
    const csprojContent =
      fw === "C#" ? await fetchCsprojContent(token, fullName, repoFilePaths) : "";
    const langWf = buildLanguageCiWorkflow(ctx, csprojContent);
    if (langWf) {
      add(".github/workflows/ci.yml", langWf);
      note("ci-ai", "verified", `${fw} CI · manifest-driven workflow`);
    }
    return;
  }

  const nvmrc = await fetchFileContent(token, fullName, ".nvmrc");
  const nodeVersion = nvmrc
    ? (nvmrc.trim().replace(/^v/, "").match(/\d+/)?.[0] ?? pkgMeta.nodeVersion)
    : pkgMeta.nodeVersion;

  if (ctx.isNodeProject && projectUsesTypeScript(pkgMeta, repoFilePaths)) {
    ensureTypecheckScript(pkgMeta, pkgMods, repoFilePaths);
  }

  if (!hasAiCi && ctx.isNodeProject) {
    const profile = ciProfileInput();
    add(".github/workflows/ci.yml", buildCiYaml(profile));
    const bundleNote = bundled.length > 0 ? ` · bundled ${bundled.join(" + ")}` : "";
    note(
      "ci-ai",
      "verified",
      `Production CI · Node ${nodeVersion}${bundleNote} · ${profile.summary}`,
    );
  } else {
    note("ci-ai", "verified", `AI CI workflow · Node ${nodeVersion}`);
  }
}

export async function handleDependencyAuditCi(fx: FixCtx) {
  const { add, note, repoFilePaths } = fx;
  const hasAuditWorkflow = repoFilePaths.some(
    (f) =>
      f === ".github/workflows/dependency-audit.yml" ||
      f === ".github/workflows/dependency-audit.yaml",
  );
  if (hasAuditWorkflow) {
    note("dependency-audit-ci", "warning", "dependency-audit workflow already present — skipped");
    return;
  }

  add(
    ".github/workflows/dependency-audit.yml",
    `name: Dependency audit

on:
  push:
    branches: [main, master]
  pull_request:
  schedule:
    - cron: "0 9 * * 1"

jobs:
  audit:
    name: npm audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - name: Install dependencies
        run: |
          if [ -f pnpm-lock.yaml ]; then
            corepack enable
            pnpm install --frozen-lockfile
            pnpm audit --audit-level high
          elif [ -f yarn.lock ]; then
            yarn install --frozen-lockfile
            yarn npm audit --severity high
          else
            npm ci
            npm audit --audit-level=high
          fi
`,
  );
  note("dependency-audit-ci", "verified", "Added weekly + PR dependency audit workflow");
}
