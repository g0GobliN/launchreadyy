import {
  buildPlaywrightConfig,
  minimalPlaywrightPackageJson,
  playwrightTestDevDepVersion,
} from "../../../playwright-config";
import { dotnetSdkVersion } from "../../../project-context.server";
import { fetchFileContent } from "../../github";
import { vitestConfig, vitestConfigPath, vitestDevDeps } from "../vitest/config";
import { loadPlaywrightConfigInputs } from "../playwright/config";
import { E2E_HOME_SPEC } from "../playwright/e2e";
import { buildXunitTestCsproj, addProjectToSln } from "../languages/csharp/docker";
import type { FixCtx } from "../shared/fix-ctx";

export function handleVitest(fx: FixCtx) {
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
  const vitestPath = vitestConfigPath(ctx.usesTypeScript);
  add(vitestPath, vitestConfig(fw, mergedDeps, ctx.usesTypeScript));
  Object.assign(pkgMods.scripts, {
    test: "vitest run",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
  });
  Object.assign(
    pkgMods.devDeps,
    vitestDevDeps(fw, mergedDeps, ctx.usesTypeScript, /* withCoverage */ true),
  );
  note(
    "vitest",
    "warning",
    `Vitest configured with scripts only — add tests for your modules or use vitest-ai for generated coverage · ${ctx.stack.profile}`,
  );
}

export async function handlePlaywright(fx: FixCtx) {
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
  const pwInput = await loadPlaywrightConfigInputs(token, fullName, ctx, pkgMods.scripts);
  add("playwright.config.ts", buildPlaywrightConfig(pwInput));
  add("e2e/home.spec.ts", E2E_HOME_SPEC);
  if (pkgMeta.raw) {
    Object.assign(pkgMods.devDeps, {
      "@playwright/test": playwrightTestDevDepVersion(mergedDeps),
    });
    Object.assign(pkgMods.scripts, { "test:e2e": "playwright test" });
  } else {
    add("package.json", minimalPlaywrightPackageJson(mergedDeps));
  }
  gitignoreAppends.push("/test-results/", "/playwright-report/", "/playwright/.cache/");
}

export function handleVitestAi(fx: FixCtx) {
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
  Object.assign(
    pkgMods.devDeps,
    vitestDevDeps(fw, mergedDeps, ctx.usesTypeScript, /* withCoverage */ false),
  );
  Object.assign(pkgMods.scripts, { test: "vitest" });
  if (!fixIds.includes("vitest")) {
    add(vitestConfigPath(ctx.usesTypeScript), vitestConfig(fw, mergedDeps, ctx.usesTypeScript));
  }
}

export async function handleXunitAi(fx: FixCtx) {
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
  // Confirmed by real execution against a real repo: `dotnet test` restores the app
  // project and runs zero tests — a bare tests/AppTests.cs is invisible without a test
  // .csproj referencing xunit and the app project, and invisible to root `dotnet test`
  // unless that project is also in the solution. Scaffold both when a root .sln exists;
  // without one, adding a second project would make root `dotnet test` ambiguous
  // (MSB1011), so fall back to an honest warning instead.
  const appCsproj = repoFilePaths.find((p) => /\.csproj$/i.test(p) && !/test/i.test(p));
  const slnPath = repoFilePaths.find((p) => /\.sln$/i.test(p) && !p.includes("/"));
  if (appCsproj && slnPath) {
    const [csprojContent, slnContent] = await Promise.all([
      fetchFileContent(token, fullName, appCsproj),
      fetchFileContent(token, fullName, slnPath),
    ]);
    const patchedSln = slnContent
      ? addProjectToSln(slnContent, "AppTests", "tests/AppTests.csproj")
      : null;
    if (csprojContent && patchedSln) {
      add(
        "tests/AppTests.csproj",
        buildXunitTestCsproj(dotnetSdkVersion(csprojContent), appCsproj),
      );
      add(slnPath, patchedSln);
      note(
        "xunit-ai",
        "verified",
        `tests/AppTests.csproj scaffolded (xunit + reference to ${appCsproj}) and added to ${slnPath} — dotnet test will run it`,
      );
      return;
    }
  }
  note(
    "xunit-ai",
    "warning",
    "tests/AppTests.cs needs a test project to run: `dotnet new xunit -o tests`, move AppTests.cs into it, `dotnet add tests reference <your-app>.csproj`, and add the project to your solution (`dotnet sln add tests`). Then `dotnet test tests` runs it.",
  );
}

export async function handlePlaywrightAi(fx: FixCtx) {
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
  if (!fixIds.includes("playwright")) {
    const pwInput = await loadPlaywrightConfigInputs(token, fullName, ctx, pkgMods.scripts);
    add("playwright.config.ts", buildPlaywrightConfig(pwInput));
  }
  if (pkgMeta.raw) {
    Object.assign(pkgMods.devDeps, {
      "@playwright/test": playwrightTestDevDepVersion(mergedDeps),
    });
    Object.assign(pkgMods.scripts, { "test:e2e": "playwright test" });
  } else {
    add("package.json", minimalPlaywrightPackageJson(mergedDeps));
  }
  gitignoreAppends.push("/test-results/", "/playwright-report/", "/playwright/.cache/");
}

export function handleApiTests(fx: FixCtx) {
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
  if (ctx.isNodeProject) {
    Object.assign(pkgMods.devDeps, { supertest: "^7.0.0", "@types/supertest": "^6.0.0" });
  }
}
