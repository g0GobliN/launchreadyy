import { describe, expect, it } from "vitest";
import {
  buildGoHealthWiring,
  buildGoMiddlewareWiring,
  buildPhpHealthWiring,
  buildPhpMiddlewareWiring,
  buildPythonHealthWiring,
  buildPythonMiddlewareWiring,
  buildRubyHealthWiring,
  buildRubyMiddlewareWiring,
  buildRustMiddlewareWiring,
  detectGoRouterStyle,
  detectPythonFramework,
  detectRubyFramework,
  patchGoContent,
  patchPhpContent,
  patchPythonContent,
  patchRubyContent,
  patchRustContent,
  wrapGoStdlibHandler,
} from "./backend-patch.server";
import { addProjectToSln, buildXunitTestCsproj } from "./fix-executor.server";
import { getFixPreviewDetails } from "./mock-data";
import { getToolApplicability } from "./project-context.server";
import type { ProjectIntelligence } from "./project-intelligence.server";

const emptyIntelligence = (): ProjectIntelligence => ({
  monorepo: false,
  packages: [],
  envContract: { build: [], test: [], runtime: [], all: [], refs: [] },
  integrations: {
    stripe: false,
    firebase: false,
    supabase: false,
    prisma: false,
    auth: false,
    hasWebhooks: false,
    signals: [],
  },
  structure: { entryPoints: [], routePaths: [], apiPaths: [], componentPaths: [] },
  codeSamples: [],
  runtimeModel: "unknown",
});

const FIXTURES = {
  fastapiMain: `from fastapi import FastAPI

app = FastAPI()
`,
  chiMain: `package main

import (
	"net/http"
	"github.com/go-chi/chi/v5"
)

func main() {
	r := chi.NewRouter()
	http.ListenAndServe(":8080", r)
}
`,
  stdlibMain: `package main

import "net/http"

func main() {
	mux := http.NewServeMux()
	http.ListenAndServe(":8080", mux)
}
`,
  railsApp: `module Myapp
  class Application < Rails::Application
    config.load_defaults 7.1
  end
end
`,
  railsRoutes: `Rails.application.routes.draw do
  root "home#index"
end
`,
};

describe("golden repo fix wiring", () => {
  it("FastAPI: helmet + cors + health", () => {
    expect(detectPythonFramework(FIXTURES.fastapiMain)).toBe("fastapi");
    let src = FIXTURES.fastapiMain;
    const mw = buildPythonMiddlewareWiring(["helmet", "cors"], "fastapi");
    src = patchPythonContent(src, mw)!;
    const health = buildPythonHealthWiring("fastapi");
    src = patchPythonContent(src, health)!;
    expect(src).toContain("register_fastapi_security_headers(app)");
    expect(src).toContain("register_fastapi_cors(app)");
    expect(src).toContain("app.include_router(health_router)");
  });

  it("chi Go: middleware + health", () => {
    expect(detectGoRouterStyle(FIXTURES.chiMain)).toBe("chi");
    let src = FIXTURES.chiMain;
    const mw = buildGoMiddlewareWiring(["helmet", "cors"], "chi", "example.com/app");
    src = patchGoContent(src, mw!)!;
    const health = buildGoHealthWiring("chi", "example.com/app");
    src = patchGoContent(src, health!)!;
    expect(src).toContain("r.Use(middleware.SecurityHeaders)");
    expect(src).toContain(`r.Get("/health", health.Handler)`);
  });

  it("stdlib Go: wraps ListenAndServe with middleware chain", () => {
    const wrapped = wrapGoStdlibHandler(FIXTURES.stdlibMain, [
      "middleware.SecurityHeaders",
      "middleware.CORS",
    ]);
    expect(wrapped).toContain("middleware.Chain(mux");
    expect(wrapped).toContain("middleware.SecurityHeaders");
  });

  it("Rails: middleware in application.rb + health route", () => {
    expect(detectRubyFramework(FIXTURES.railsApp, "config/application.rb")).toBe("rails");
    const mw = buildRubyMiddlewareWiring(["helmet", "rate-limit"], "rails");
    const app = patchRubyContent(FIXTURES.railsApp, mw!)!;
    expect(app).toContain("config.middleware.use Middleware::SecurityHeaders");
    const routes = patchRubyContent(FIXTURES.railsRoutes, buildRubyHealthWiring())!;
    expect(routes).toContain('get "/health", to: "health#show"');
  });

  it("helmet applicable on Go API repo", () => {
    const goCtx = {
      fullName: "o/r",
      framework: "Go",
      resolvedFramework: "Go",
      language: "go" as const,
      isNodeProject: false,
      packageManager: "npm" as const,
      filePaths: ["go.mod", "cmd/server/main.go"],
      pkg: {
        scripts: {},
        nodeVersion: "20",
        hasBackend: true,
        dependencies: {},
        devDependencies: {},
      },
      mergedDeps: {},
      stack: { frameworks: ["Go"], services: [], deployTargets: [], profile: "General Node" },
      manifests: { goMod: "module example.com/app\ngo 1.22" },
      usesTypeScript: false,
      usesReact: false,
      hasExpress: false,
      isStaticSpa: false,
      hasNextAppRouter: false,
      hasExistingCi: false,
      hasExistingDockerfile: false,
      deployConfigs: [],
      envVars: [],
      intelligence: emptyIntelligence(),
    };
    expect(getToolApplicability("helmet", goCtx).applicable).toBe(true);
    expect(getToolApplicability("cors", goCtx).applicable).toBe(true);
  });

  it("Laravel kernel wiring", () => {
    const kernel = `<?php\nclass Kernel {\n    protected $middleware = [\n    ];\n}\n`;
    const plan = buildPhpMiddlewareWiring(["helmet", "cors"], "laravel", "app/Http/Kernel.php");
    const out = patchPhpContent(kernel, plan!);
    expect(out).toContain("SecurityHeaders::class");
  });

  it("Laravel 11 bootstrap/app.php wiring (Kernel.php was removed in this version)", () => {
    // Regression: Laravel 11 replaced app/Http/Kernel.php with a fluent bootstrap/app.php API —
    // confirmed this silently dropped all middleware wiring for any Laravel 11+ project, the
    // current major version, while still reporting "verified".
    // Exact shape confirmed against the real official laravel/laravel skeleton repo, including
    // the `: void` return type the original regex missed.
    const bootstrapApp = `<?php

use Illuminate\\Foundation\\Application;
use Illuminate\\Foundation\\Configuration\\Exceptions;
use Illuminate\\Foundation\\Configuration\\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        //
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
`;
    const plan = buildPhpMiddlewareWiring(["helmet", "cors"], "laravel", "bootstrap/app.php");
    expect(plan?.path).toBe("bootstrap/app.php");
    const out = patchPhpContent(bootstrapApp, plan!);
    expect(out).toContain("$middleware->append(\\App\\Http\\Middleware\\SecurityHeaders::class);");
    expect(out).toContain("$middleware->append(\\App\\Http\\Middleware\\CorsMiddleware::class);");
  });

  it("Axum middleware layers", () => {
    const main = `fn main() {\n    let app = Router::new();\n}\n`;
    const plan = buildRustMiddlewareWiring(["helmet", "cors"], "axum");
    const out = patchRustContent(main, plan!);
    expect(out).toContain("middleware::security_headers");
  });

  it("Gin middleware wiring", () => {
    const main = `package main\nfunc main() {\n\tr := gin.Default()\n}\n`;
    const plan = buildGoMiddlewareWiring(["helmet"], "gin", "example.com/app");
    const out = patchGoContent(main, plan!);
    expect(out).toContain("GinSecurityHeaders()");
  });

  it("Actix middleware wraps", () => {
    const main = `fn main() {\n    let app = App::new();\n}\n`;
    const plan = buildRustMiddlewareWiring(["helmet"], "actix");
    const out = patchRustContent(main, plan!);
    expect(out).toContain("middleware::security_headers");
  });

  it("Symfony health route wiring", () => {
    const routes = `controllers:\n`;
    const plan = buildPhpHealthWiring("symfony");
    const out = patchPhpContent(routes, plan!);
    expect(out).toContain("HealthController::index");
  });

  it("UI previews use Go/Ruby/PHP/Rust paths", () => {
    expect(getFixPreviewDetails("helmet", "Go")?.files_added).toContain(
      "internal/middleware/middleware.go",
    );
    expect(getFixPreviewDetails("health-check", "Ruby")?.files_changed).toContain(
      "config/routes.rb",
    );
    expect(getFixPreviewDetails("cors", "PHP")?.files_changed).toContain("app/Http/Kernel.php");
    expect(getFixPreviewDetails("logger", "Rust")?.files_changed).toContain("src/main.rs");
    expect(getFixPreviewDetails("helmet", "C#")?.files_added).toContain(
      "Middleware/SecurityHeadersMiddleware.cs",
    );
    expect(getFixPreviewDetails("cors", "Elixir")?.files_changed).toContain(
      "lib/app_web/endpoint.ex",
    );
  });
});

// Ground-truthed against the real FabianGosebrink/ASPNETCore-WebAPI-Sample solution file and
// verified end-to-end in the audit harness: root `dotnet test` only discovers the scaffolded
// test project when it's a member of the solution.
describe("xunit-ai test project scaffolding", () => {
  const SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "App", "App\\App.csproj", "{36DF3175-0775-44CC-8708-5B67F2ED70FE}"
EndProject
Global
	GlobalSection(SolutionConfigurationPlatforms) = preSolution
		Debug|Any CPU = Debug|Any CPU
		Release|Any CPU = Release|Any CPU
	EndGlobalSection
	GlobalSection(ProjectConfigurationPlatforms) = postSolution
		{36DF3175-0775-44CC-8708-5B67F2ED70FE}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{36DF3175-0775-44CC-8708-5B67F2ED70FE}.Release|Any CPU.ActiveCfg = Release|Any CPU
	EndGlobalSection
EndGlobal
`;

  it("adds the project entry and mirrors solution configurations", () => {
    const out = addProjectToSln(SLN, "AppTests", "tests/AppTests.csproj");
    expect(out).not.toBeNull();
    expect(out).toContain('"AppTests", "tests\\AppTests.csproj"');
    expect(out).toMatch(/\{[0-9A-F-]{36}\}\.Debug\|Any CPU\.ActiveCfg = Debug\|Any CPU/);
    expect(out).toMatch(/\{[0-9A-F-]{36}\}\.Release\|Any CPU\.Build\.0 = Release\|Any CPU/);
  });

  it("is idempotent when the project is already present", () => {
    const once = addProjectToSln(SLN, "AppTests", "tests/AppTests.csproj") as string;
    expect(addProjectToSln(once, "AppTests", "tests/AppTests.csproj")).toBe(once);
  });

  it("returns null on a file without a Global section instead of corrupting it", () => {
    expect(addProjectToSln("not a solution file", "AppTests", "tests/AppTests.csproj")).toBeNull();
  });

  it("uses the app project's real TargetFramework in the test csproj", () => {
    const csproj = buildXunitTestCsproj("9.0", "App/App.csproj");
    expect(csproj).toContain("<TargetFramework>net9.0</TargetFramework>");
    expect(csproj).toContain('Include="..\\App\\App.csproj"');
    expect(csproj).toContain('PackageReference Include="xunit"');
  });
});
