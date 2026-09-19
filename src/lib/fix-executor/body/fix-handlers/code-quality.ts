import {
  hasExistingEslintConfig,
  hasLintScript,
  hasExistingPrettierConfig,
} from "../../../project-context.server";
import { fetchFileContent } from "../../github";
import { eslintConfigForProject } from "../eslint/config";
import { PRETTIER_RC, PRETTIER_IGNORE } from "../prettier/config";
import { PYTEST_SETUP, RUFF_CONFIG, RUFF_TOML_CONFIG } from "../languages/python/lint";
import { RUBOCOP_CONFIG } from "../languages/ruby/lint";
import { GOLANGCI_LINT_CONFIG } from "../languages/go/lint";
import { phpCsFixerConfigForProject } from "../languages/php/lint";
import { CHECKSTYLE_CONFIG } from "../languages/java/lint";
import { CREDO_CONFIG } from "../languages/elixir/lint";
import type { FixCtx } from "../shared/fix-ctx";

export function handleEslint(fx: FixCtx) {
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
  if (hasExistingEslintConfig(repoFilePaths, mergedDeps)) {
    if (hasLintScript({ ...ctx.pkg.scripts, ...pkgMods.scripts })) {
      note("eslint", "warning", "ESLint already configured — skipped");
      return;
    }
    Object.assign(pkgMods.scripts, { lint: "eslint ." });
    note("eslint", "verified", "Added lint script (ESLint config already present)");
    return;
  }
  add("eslint.config.js", eslintConfigForProject(ctx.usesTypeScript));
  Object.assign(pkgMods.scripts, { lint: "eslint ." });
  if (ctx.usesTypeScript) {
    Object.assign(pkgMods.devDeps, {
      eslint: "^8.57.0",
      "@typescript-eslint/parser": "^7.0.0",
      "@typescript-eslint/eslint-plugin": "^7.0.0",
    });
  } else {
    Object.assign(pkgMods.devDeps, { eslint: "^8.57.0" });
  }
  note("eslint", "verified", ctx.usesTypeScript ? "TypeScript ESLint" : "JavaScript ESLint");
}

export function handlePrettier(fx: FixCtx) {
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
  if (hasExistingPrettierConfig(repoFilePaths, mergedDeps)) {
    note("prettier", "warning", "Prettier already configured — skipped");
    return;
  }
  const formatGlob = ctx.usesTypeScript ? "**/*.{ts,tsx,js,jsx,json,md}" : "**/*.{js,jsx,json,md}";
  add(".prettierrc", PRETTIER_RC);
  add(".prettierignore", PRETTIER_IGNORE);
  Object.assign(pkgMods.scripts, { format: `prettier --write "${formatGlob}"` });
  Object.assign(pkgMods.devDeps, { prettier: "^3.3.0" });
}

export async function handleTsStrict(fx: FixCtx) {
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
  const tsconfigContent = await fetchFileContent(token, fullName, "tsconfig.json");
  if (tsconfigContent) {
    try {
      // tsconfig.json often uses JSONC (comments) — strip before parsing
      const stripped = tsconfigContent.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const tsconfig = JSON.parse(stripped) as {
        compilerOptions?: Record<string, unknown>;
        [key: string]: unknown;
      };
      tsconfig.compilerOptions = tsconfig.compilerOptions ?? {};
      if (!tsconfig.compilerOptions["strict"] && !tsconfig.compilerOptions["strictNullChecks"]) {
        tsconfig.compilerOptions["strictNullChecks"] = true;
        add("tsconfig.json", JSON.stringify(tsconfig, null, 2) + "\n");
        note(
          "ts-strict",
          "verified",
          "strictNullChecks enabled — phase 1 of strict migration. Run tsc --noEmit locally to see what errors remain before merging.",
        );
      } else {
        note("ts-strict", "warning", "strict or strictNullChecks already set — no change made");
      }
    } catch {
      note(
        "ts-strict",
        "warning",
        'Could not parse tsconfig.json — add "strictNullChecks": true to compilerOptions manually',
      );
    }
  } else {
    note(
      "ts-strict",
      "warning",
      'tsconfig.json not found — add "strictNullChecks": true to compilerOptions manually',
    );
  }
}

export async function handlePytest(fx: FixCtx, fixId: string) {
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
  const pyproject = await fetchFileContent(token, fullName, "pyproject.toml").catch(() => null);
  if (pyproject) {
    if (!pyproject.includes("[tool.pytest")) {
      add("pyproject.toml", pyproject.trimEnd() + "\n\n" + PYTEST_SETUP);
      note(fixId, "verified", "pytest config added to pyproject.toml");
    } else {
      note(fixId, "warning", "pytest already configured in pyproject.toml");
    }
  } else {
    add("pyproject.toml", '[project]\nname = "app"\nversion = "0.1.0"\n\n' + PYTEST_SETUP);
    note(fixId, "verified", "pyproject.toml created with pytest config");
  }
  // Config alone doesn't make `pytest` pip-installable — confirmed by actually running a
  // real generated test file with `pytest-ai`'s prior (zero) scaffolding: `pip install -r
  // requirements.txt` succeeded, then `pytest` itself failed with "No module named
  // pytest" since it was never listed as a dependency anywhere. Only requirements.txt-based
  // projects are handled here (matching the existing Sentry Python pattern below);
  // pyproject-dependency-list projects need it added manually for now.
  const requirements = await fetchFileContent(token, fullName, "requirements.txt").catch(
    () => null,
  );
  if (requirements && !/^pytest\b/im.test(requirements)) {
    add("requirements.txt", requirements.trimEnd() + "\npytest\n");
  } else if (!requirements && !pyproject) {
    add("requirements.txt", "pytest\n");
  }
  const hasTestsDir = ctx.filePaths.some((f) => /^tests?\//.test(f));
  if (!hasTestsDir) {
    add("tests/__init__.py", "");
    note(fixId, "verified", "tests/ directory created — add test_*.py files for your modules");
  }
}

export async function handleRuff(fx: FixCtx) {
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
  const pyproject = await fetchFileContent(token, fullName, "pyproject.toml").catch(() => null);
  if (pyproject) {
    if (!pyproject.includes("[tool.ruff")) {
      add("pyproject.toml", pyproject.trimEnd() + "\n\n" + RUFF_CONFIG);
      note(
        "ruff",
        "verified",
        "ruff config added to pyproject.toml — run `pip install ruff` then `ruff check .`",
      );
    } else {
      note("ruff", "warning", "ruff already configured in pyproject.toml");
    }
  } else {
    add("ruff.toml", RUFF_TOML_CONFIG);
    note("ruff", "verified", "ruff.toml created — run `pip install ruff` then `ruff check .`");
  }
}

export function handleRspec(fx: FixCtx) {
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
  const hasSpec = ctx.filePaths.some((f) => /^spec\//.test(f));
  if (!hasSpec) {
    add(
      "spec/spec_helper.rb",
      `RSpec.configure do |config|\n  config.expect_with :rspec do |c|\n    c.syntax = :expect\n  end\nend\n`,
    );
    note(
      "rspec",
      "verified",
      "spec/ scaffold created — add `gem 'rspec'` to Gemfile and write real specs",
    );
  } else {
    note("rspec", "warning", "spec/ already exists — no scaffold added");
  }
}

export function handleRubocop(fx: FixCtx) {
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
  const hasRubocop = ctx.filePaths.some((f) => /^\.rubocop\.ya?ml$/.test(f));
  if (!hasRubocop) {
    add(".rubocop.yml", RUBOCOP_CONFIG);
    note("rubocop", "verified", ".rubocop.yml created — run `gem install rubocop` then `rubocop`");
  } else {
    note("rubocop", "warning", ".rubocop.yml already exists");
  }
}

export function handleGolangciLint(fx: FixCtx) {
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
  const hasConfig = ctx.filePaths.some((f) => /^\.golangci\.ya?ml$/.test(f));
  if (!hasConfig) {
    add(".golangci.yml", GOLANGCI_LINT_CONFIG);
    note(
      "golangci-lint",
      "verified",
      ".golangci.yml created — install golangci-lint and run `golangci-lint run`",
    );
  } else {
    note("golangci-lint", "warning", ".golangci.yml already exists");
  }
}

export function handlePhpunit(fx: FixCtx) {
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
  const hasPhpunit = ctx.filePaths.some((f) => /phpunit\.xml/.test(f));
  if (!hasPhpunit) {
    add(
      "phpunit.xml",
      `<?xml version="1.0" encoding="UTF-8"?>\n<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n  xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"\n  bootstrap="vendor/autoload.php"\n  colors="true">\n  <testsuites>\n    <testsuite name="Unit">\n      <directory>tests</directory>\n    </testsuite>\n  </testsuites>\n</phpunit>\n`,
    );
    note(
      "phpunit",
      "verified",
      "phpunit.xml created — run `composer require --dev phpunit/phpunit` and add tests under tests/",
    );
  } else {
    note("phpunit", "warning", "phpunit.xml already exists");
  }
}

export function handlePhpcs(fx: FixCtx) {
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
  const hasConfig = ctx.filePaths.some((f) =>
    /^\.php-cs-fixer\.php$|^phpcs\.xml(\.dist)?$/.test(f),
  );
  if (!hasConfig) {
    add(".php-cs-fixer.php", phpCsFixerConfigForProject(ctx.filePaths));
    note(
      "phpcs",
      "verified",
      ".php-cs-fixer.php created — run `composer require --dev friendsofphp/php-cs-fixer` then `./vendor/bin/php-cs-fixer fix --dry-run`",
    );
  } else {
    note("phpcs", "warning", "PHP CS config already exists");
  }
}

export function handleCheckstyle(fx: FixCtx) {
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
  const hasConfig = ctx.filePaths.some((f) => /^checkstyle\.xml$/.test(f));
  if (!hasConfig) {
    add("checkstyle.xml", CHECKSTYLE_CONFIG);
    note(
      "checkstyle",
      "verified",
      "checkstyle.xml created — add checkstyle-maven-plugin to pom.xml or the checkstyle Gradle plugin, then run `mvn checkstyle:check`",
    );
  } else {
    note("checkstyle", "warning", "checkstyle.xml already exists");
  }
}

export function handleCredo(fx: FixCtx) {
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
  const hasConfig = ctx.filePaths.some((f) => /^\.credo\.exs$/.test(f));
  if (!hasConfig) {
    add(".credo.exs", CREDO_CONFIG);
    note(
      "credo",
      "verified",
      '.credo.exs created — add `{:credo, "~> 1.7", only: [:dev, :test]}` to mix.exs deps, then run `mix credo`',
    );
  } else {
    note("credo", "warning", ".credo.exs already exists");
  }
}
