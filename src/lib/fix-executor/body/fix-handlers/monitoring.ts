import { fetchFileContent, patchSourceFile } from "../../github";
import { SENTRY_INIT, SENTRY_ERROR_BOUNDARY_TSX } from "../react/sentry";
import { SENTRY_INIT_NEXTJS, sentryInstrumentationNextjs } from "../next/sentry";
import { SENTRY_INIT_NODE } from "../express/middleware";
import { SENTRY_INIT_PYTHON } from "../languages/python/templates";
import { SENTRY_INIT_JAVA } from "../languages/java/templates";
import { SENTRY_INIT_GO } from "../languages/go/templates";
import { SENTRY_INIT_RUBY } from "../languages/ruby/templates";
import { SENTRY_INIT_ELIXIR } from "../languages/elixir/templates";
import { SENTRY_INIT_PHP } from "../languages/php/templates";
import { SENTRY_INIT_RUST } from "../languages/rust/templates";
import { SENTRY_INIT_CSHARP } from "../languages/csharp/templates";
import { detectEntryPoint } from "../shared/helpers";
import type { FixCtx } from "../shared/fix-ctx";

export function handleMonitoring(fx: FixCtx) {
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
  if (fw === "Next.js") {
    add("src/lib/sentry.ts", SENTRY_INIT_NEXTJS);
    Object.assign(pkgMods.deps, { "@sentry/nextjs": "^8.0.0" });
  } else if (fw === "Python") {
    add("src/sentry.py", SENTRY_INIT_PYTHON);
  } else if (fw === "Ruby") {
    add("config/initializers/sentry.rb", SENTRY_INIT_RUBY);
  } else if (fw === "Go") {
    add("internal/sentry/sentry.go", SENTRY_INIT_GO);
  } else if (fw === "Java" || fw === "Kotlin") {
    add("sentry.properties", SENTRY_INIT_JAVA);
  } else if (fw === "C#") {
    add("appsettings.Sentry.json", SENTRY_INIT_CSHARP);
  } else if (fw === "Elixir") {
    add("config/sentry.exs", SENTRY_INIT_ELIXIR);
  } else if (fw === "PHP") {
    add("config/sentry.php", SENTRY_INIT_PHP);
  } else if (fw === "Rust") {
    add("src/sentry.rs", SENTRY_INIT_RUST);
  } else if (fw === "Express") {
    add("src/lib/sentry.ts", SENTRY_INIT_NODE);
    Object.assign(pkgMods.deps, { "@sentry/node": "^8.0.0" });
  } else {
    // Vite / React / unknown
    add("src/lib/sentry.ts", SENTRY_INIT);
    add("src/lib/sentry-error-boundary.tsx", SENTRY_ERROR_BOUNDARY_TSX);
    Object.assign(pkgMods.deps, { "@sentry/react": "^8.0.0" });
  }
}

export async function finalizeMonitoringManifests(fx: FixCtx) {
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
  // Sentry — patch dependency manifests and .env.example for non-JS languages
  const needsEnvExample = fixIds.includes("env-example") && !fixIds.includes("env-example-ai");
  if (fixIds.includes("monitoring")) {
    const sentryDsnVar =
      framework === "Next.js"
        ? "SENTRY_DSN"
        : framework === "Vite" || framework === "React"
          ? "VITE_SENTRY_DSN"
          : "SENTRY_DSN";

    // Append DSN key to .env.example if it exists (and we haven't already added it)
    if (!needsEnvExample) {
      const existingEnv = await fetchFileContent(token, fullName, ".env.example").catch(() => null);
      if (existingEnv && !existingEnv.includes("SENTRY")) {
        add(".env.example", existingEnv.trimEnd() + `\n${sentryDsnVar}=\n`);
      }
    }

    // Patch language-specific dependency manifests
    if (framework === "Python") {
      const req = await fetchFileContent(token, fullName, "requirements.txt").catch(() => null);
      if (req && !req.includes("sentry-sdk")) {
        add("requirements.txt", req.trimEnd() + "\nsentry-sdk\n");
      } else if (!req) {
        add("requirements.txt", "sentry-sdk\n");
      }
    } else if (framework === "Ruby") {
      const gemfile = await fetchFileContent(token, fullName, "Gemfile").catch(() => null);
      if (gemfile && !gemfile.includes("sentry-ruby")) {
        add("Gemfile", gemfile.trimEnd() + '\ngem "sentry-ruby"\ngem "sentry-rails"\n');
      }
    } else if (framework === "Rust") {
      const cargo = await fetchFileContent(token, fullName, "Cargo.toml").catch(() => null);
      if (cargo && !cargo.includes("sentry")) {
        const patched = cargo.replace(
          /(\[dependencies][^[]*)/,
          '$1sentry = { version = "0.34", features = ["debug-images"] }\n',
        );
        if (patched !== cargo) add("Cargo.toml", patched);
      }
    } else if (framework === "PHP") {
      const composer = await fetchFileContent(token, fullName, "composer.json").catch(() => null);
      if (composer && !composer.includes("sentry/sentry")) {
        try {
          const obj = JSON.parse(composer) as Record<string, unknown>;
          const require = (obj["require"] as Record<string, string> | undefined) ?? {};
          require["sentry/sentry-laravel"] = "^4.0";
          obj["require"] = require;
          add("composer.json", JSON.stringify(obj, null, 4) + "\n");
        } catch {
          /* leave unchanged if parse fails */
        }
      }
    }
  }
}

export async function wireMonitoringEntry(fx: FixCtx) {
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
  // ── Entry-point wiring ────────────────────────────────────────────────────

  // Sentry — wire import into app entry point
  if (fixIds.includes("monitoring")) {
    if (framework === "Next.js") {
      // Next.js 13.4+: instrumentation.ts registers on startup, no entry patching needed
      const usesSrcDir = repoFilePaths.some((p) => p === "src/app" || p.startsWith("src/app/"));
      add(
        usesSrcDir ? "src/instrumentation.ts" : "instrumentation.ts",
        sentryInstrumentationNextjs(usesSrcDir),
      );
      note("monitoring", "verified", "instrumentation.ts created (Next.js App Router)");
    } else if (framework === "Python") {
      note(
        "monitoring",
        "verified",
        "src/sentry.py created — import it at the top of your app entry file (e.g. manage.py or app.py)",
      );
    } else if (framework === "Ruby") {
      note(
        "monitoring",
        "verified",
        "config/initializers/sentry.rb created — Rails auto-loads initializers on boot",
      );
    } else if (framework === "Go") {
      note(
        "monitoring",
        "verified",
        "internal/sentry/sentry.go created — call sentry.Init() in your main() before starting the server",
      );
    } else if (framework === "Java") {
      note(
        "monitoring",
        "verified",
        "sentry.properties created — add io.sentry:sentry-spring-boot-starter-jakarta to your pom.xml or build.gradle",
      );
    } else if (framework === "Kotlin") {
      note(
        "monitoring",
        "verified",
        "sentry.properties created — add io.sentry:sentry-spring-boot-starter-jakarta to build.gradle.kts",
      );
    } else if (framework === "C#") {
      note(
        "monitoring",
        "verified",
        "appsettings.Sentry.json created — add Sentry.AspNetCore NuGet package and set SENTRY_DSN",
      );
    } else if (framework === "Elixir") {
      note(
        "monitoring",
        "verified",
        "config/sentry.exs created — add {:sentry, ...} to mix.exs deps and set SENTRY_DSN",
      );
    } else if (framework === "PHP") {
      note(
        "monitoring",
        "verified",
        "config/sentry.php created — add sentry/sentry-laravel to composer.json and set SENTRY_LARAVEL_DSN in .env",
      );
    } else if (framework === "Rust") {
      note(
        "monitoring",
        "verified",
        'src/sentry.rs created — call sentry::init() at the top of main() and add sentry = "0.34" to Cargo.toml',
      );
    } else {
      const entryPoint = await detectEntryPoint(token, fullName, framework);
      if (entryPoint) {
        const importPath = entryPoint.startsWith("src/") ? "./lib/sentry" : "./src/lib/sentry";
        const patched = await patchSourceFile(
          token,
          fullName,
          entryPoint,
          [`import "${importPath}";`],
          [],
        );
        if (patched) {
          // Import-only patch (no usage anchors), so `missed` is always empty here.
          add(entryPoint, patched.content);
          note("monitoring", "verified", `Sentry import wired into ${entryPoint}`);
        } else {
          note(
            "monitoring",
            "warning",
            `Found ${entryPoint} but could not patch — add \`import "${importPath}"\` manually`,
          );
        }
      } else {
        note(
          "monitoring",
          "warning",
          `No entry point found — add \`import "./lib/sentry"\` to your app entry file`,
        );
      }
    }
  }
}
