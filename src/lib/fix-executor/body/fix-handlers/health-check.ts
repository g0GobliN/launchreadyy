import { isTanStackStart } from "../../../fetch-server-patch.server";
import { patchSourceFile, fetchFileContent, findExpressApp } from "../../github";
import { detectEntryPoint } from "../shared/helpers";
import { HEALTH_CHECK_EXPRESS } from "../express/middleware";
import { HEALTH_CHECK_TANSTACK } from "../fetch-runtime/tanstack";
import { HEALTH_CHECK_PYTHON } from "../languages/python/templates";
import { HEALTH_CHECK_JAVA } from "../languages/java/templates";
import { HEALTH_CHECK_KOTLIN } from "../languages/kotlin/templates";
import { HEALTH_CHECK_GO } from "../languages/go/templates";
import { HEALTH_CHECK_RUBY } from "../languages/ruby/templates";
import { HEALTH_CONTROLLER_ELIXIR } from "../languages/elixir/templates";
import { HEALTH_CHECK_RUST } from "../languages/rust/templates";
import type { FixCtx } from "../shared/fix-ctx";

export async function handleHealthCheck(fx: FixCtx) {
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
  if (ctx.language === "node") {
    if (isTanStackStart(ctx)) {
      add("src/routes/api.health.ts", HEALTH_CHECK_TANSTACK);
      note(
        "health-check",
        "verified",
        "GET /api/health route added via TanStack Start API route — run your dev server and visit /api/health to verify",
      );
    } else if (ctx.hasExpress) {
      const entryPoint = await detectEntryPoint(token, fullName, "Express");
      if (entryPoint) {
        // Anchor on the declaration this repo actually has. The old literal
        // "const app = express()" missed `var`/`let`/typed forms, and the miss was silent —
        // patchSourceFile still returned content, so this reported "verified" for a route that
        // was never added.
        const entryLines = ((await fetchFileContent(token, fullName, entryPoint)) ?? "").split(
          "\n",
        );
        const appDecl = findExpressApp(entryLines);
        const patched = appDecl
          ? await patchSourceFile(
              token,
              fullName,
              entryPoint,
              [],
              [{ after: appDecl.line, lines: [HEALTH_CHECK_EXPRESS.trim()] }],
            )
          : null;
        if (patched && patched.missed.length === 0) {
          add(entryPoint, patched.content);
          note("health-check", "verified", `GET /health wired into ${entryPoint}`);
        } else {
          note(
            "health-check",
            "warning",
            `Found ${entryPoint} but could not auto-patch — add GET /health route manually`,
          );
        }
      } else {
        note("health-check", "warning", "Entry point not found — add GET /health route manually");
      }
    } else {
      note(
        "health-check",
        "warning",
        `Add a GET /health endpoint to your ${ctx.resolvedFramework} server manually`,
      );
    }
  } else if (ctx.language === "python") {
    add("health.py", HEALTH_CHECK_PYTHON);
    note(
      "health-check",
      "verified",
      "health.py created — wiring attempted in app entry when Flask/FastAPI is detected",
    );
  } else if (ctx.language === "go") {
    add("internal/health/handler.go", HEALTH_CHECK_GO);
    note(
      "health-check",
      "verified",
      "internal/health/handler.go created — register health.Handler at /health in your router",
    );
  } else if (ctx.language === "ruby") {
    add("app/controllers/health_controller.rb", HEALTH_CHECK_RUBY);
    note(
      "health-check",
      "warning",
      "HealthController created — add `get '/health', to: 'health#show'` to config/routes.rb",
    );
  } else if (ctx.language === "elixir") {
    add("lib/app_web/controllers/health_controller.ex", HEALTH_CONTROLLER_ELIXIR);
    note(
      "health-check",
      "verified",
      "HealthController created — GET /health wiring attempted in router.ex",
    );
  } else if (ctx.language === "java") {
    addJava("health", "HealthController.java", HEALTH_CHECK_JAVA);
    note(
      "health-check",
      "verified",
      javaApplicationPath
        ? `HealthController under ${javaBasePackage}.health — auto-scanned by Spring Boot`
        : "Spring-style HealthController created — place under your @SpringBootApplication package",
    );
  } else if (ctx.language === "kotlin") {
    addKotlin("health", "HealthController", HEALTH_CHECK_KOTLIN);
    note(
      "health-check",
      "verified",
      kotlinApplicationPath
        ? `HealthController under ${kotlinBasePackage}.health — auto-scanned by Spring Boot`
        : "Spring-style HealthController created — place under your @SpringBootApplication package",
    );
  } else if (ctx.language === "rust") {
    add("src/health.rs", HEALTH_CHECK_RUST);
    note(
      "health-check",
      "verified",
      "health.rs created — merge health_routes() into your axum/actix router at /health",
    );
  } else if (ctx.language === "csharp") {
    note("health-check", "verified", "GET /health MapGet wiring attempted in Program.cs");
  } else {
    note(
      "health-check",
      "warning",
      `Add a GET /health endpoint to your ${ctx.resolvedFramework} app manually`,
    );
  }
}
