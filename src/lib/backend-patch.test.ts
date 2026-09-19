import { describe, expect, it } from "vitest";
import {
  buildCsharpMiddlewareWiring,
  buildElixirPlugWiring,
  buildGoMiddlewareWiring,
  buildPythonHealthWiring,
  buildPythonMiddlewareWiring,
  buildRubyMiddlewareWiring,
  detectGoRouterStyle,
  detectPythonFramework,
  findGoRouterFile,
  extractJavaPackage,
  extractKotlinPackage,
  javaSourcePath,
  kotlinSourcePath,
  patchCsharpContent,
  patchElixirContent,
  patchGoContent,
  patchPythonContent,
  patchRubyContent,
  pickJavaApplicationPath,
  pickKotlinApplicationPath,
  pickPythonEntryPath,
  rewriteJavaPackage,
  rewriteKotlinPackage,
  wireGoRouterFile,
} from "./backend-patch.server";

describe("backend-patch", () => {
  // Every addJava() call site passes the class name *with* its extension
  // ("HealthController.java"). javaSourcePath appended a second one, so real Java fix PRs
  // shipped `.../HealthController.java.java` — javac rejects that, because a public class must
  // live in a file named exactly after it. Caught by generating fixes against
  // spring-projects/spring-petclinic.
  it("does not double the .java extension when the class name already has one", () => {
    expect(javaSourcePath("com.acme.health", "HealthController.java")).toBe(
      "src/main/java/com/acme/health/HealthController.java",
    );
  });

  it("still appends .java for a bare class name", () => {
    expect(javaSourcePath("com.acme.security", "CorsConfig")).toBe(
      "src/main/java/com/acme/security/CorsConfig.java",
    );
  });

  it("detects FastAPI entry", () => {
    expect(detectPythonFramework("from fastapi import FastAPI\napp = FastAPI()")).toBe("fastapi");
  });

  it("patches FastAPI middleware wiring", () => {
    const src = `from fastapi import FastAPI\n\napp = FastAPI()\n`;
    const plan = buildPythonMiddlewareWiring(["helmet", "cors"], "fastapi");
    const out = patchPythonContent(src, plan);
    expect(out).toContain("register_fastapi_security_headers(app)");
    expect(out).toContain("register_fastapi_cors(app)");
  });

  it("patches Flask health wiring", () => {
    const src = `from flask import Flask\napp = Flask(__name__)\n`;
    const plan = buildPythonHealthWiring("flask");
    const out = patchPythonContent(src, plan);
    expect(out).toContain("app.register_blueprint(health_bp)");
  });

  // Confirmed against the real miguelgrinberg/microblog (the reference implementation of
  // Flask's own officially-documented "application factory" pattern): app = Flask(__name__) is
  // constructed from inside an indented function body, not at column 0. Inserting the generated
  // line verbatim there previously produced a Python IndentationError — the insertion must
  // reuse the anchor line's own indentation.
  it("preserves indentation when wiring middleware inside a Flask application factory", () => {
    const src = [
      "from flask import Flask",
      "",
      "def create_app(config_class=Config):",
      "    app = Flask(__name__)",
      "    app.config.from_object(config_class)",
      "    return app",
      "",
    ].join("\n");
    const plan = buildPythonMiddlewareWiring(["cors"], "flask");
    const out = patchPythonContent(src, plan)!;
    expect(out).toContain("    register_flask_cors(app)");
    expect(out).not.toContain("\nregister_flask_cors(app)");
    const lines = out.split("\n");
    const idx = lines.findIndex((l) => l.includes("register_flask_cors(app)"));
    expect(lines[idx]!.match(/^\s*/)![0]).toBe("    ");
  });

  it("rewrites Java package", () => {
    const src = `package com.example.security;\npublic class X {}`;
    expect(rewriteJavaPackage(src, "com.myapp")).toContain("package com.myapp.security;");
  });

  it("finds Spring Boot application file", () => {
    expect(
      pickJavaApplicationPath([
        "src/main/java/com/foo/AppApplication.java",
        "src/main/java/com/foo/web/HomeController.java",
      ]),
    ).toBe("src/main/java/com/foo/AppApplication.java");
  });

  it("extracts Java package", () => {
    expect(extractJavaPackage("package com.foo.bar;\n@SpringBootApplication")).toBe("com.foo.bar");
  });

  it("rewrites Kotlin package (no trailing semicolon)", () => {
    const src = `package com.example.security\nclass X`;
    expect(rewriteKotlinPackage(src, "com.myapp")).toContain("package com.myapp.security");
    expect(rewriteKotlinPackage(src, "com.myapp")).not.toContain(";");
  });

  it("finds Kotlin Spring Boot application file", () => {
    expect(
      pickKotlinApplicationPath([
        "src/main/kotlin/com/foo/AppApplication.kt",
        "src/main/kotlin/com/foo/web/HomeController.kt",
      ]),
    ).toBe("src/main/kotlin/com/foo/AppApplication.kt");
  });

  it("extracts Kotlin package (no trailing semicolon)", () => {
    expect(extractKotlinPackage("package com.foo.bar\n@SpringBootApplication")).toBe("com.foo.bar");
  });

  it("builds a Kotlin source path under src/main/kotlin", () => {
    expect(kotlinSourcePath("com.foo.security", "SecurityHeadersFilter")).toBe(
      "src/main/kotlin/com/foo/security/SecurityHeadersFilter.kt",
    );
  });

  it("picks python entry from tree", () => {
    expect(pickPythonEntryPath(["README.md", "src/app.py"])).toBe("src/app.py");
  });

  it("wires chi Go middleware", () => {
    const src = `package main\nimport "github.com/go-chi/chi/v5"\nfunc main() {\n\tr := chi.NewRouter()\n}\n`;
    const plan = buildGoMiddlewareWiring(["helmet"], "chi", "example.com/app");
    const out = patchGoContent(src, plan!);
    expect(out).toContain("r.Use(middleware.SecurityHeaders)");
  });

  // Mirrors the real mingrammer/go-todo-rest-api-example: mux.NewRouter() assigned to a struct
  // field (a.Router) in app/app.go, not a local `r` in main.go — receiver and file must both
  // come from the repo's actual code, and gorilla must win over stdlib despite ListenAndServe.
  it("detects gorilla before stdlib and wires with the real receiver", () => {
    const appGo = `package app\n\nimport (\n\t"net/http"\n\n\t"github.com/gorilla/mux"\n)\n\ntype App struct {\n\tRouter *mux.Router\n}\n\nfunc (a *App) Initialize() {\n\ta.Router = mux.NewRouter()\n}\n\nfunc (a *App) Run(host string) {\n\tlog.Fatal(http.ListenAndServe(host, a.Router))\n}\n`;
    expect(detectGoRouterStyle(appGo)).toBe("gorilla");
    const out = wireGoRouterFile(appGo, {
      fixIds: ["helmet", "cors"],
      style: "gorilla",
      modulePath: "example.com/app",
      health: true,
    });
    expect(out).toContain("a.Router.Use(middleware.SecurityHeaders)");
    expect(out).toContain("a.Router.Use(middleware.CORS)");
    expect(out).toContain('a.Router.HandleFunc("/health", health.Handler)');
    // net/http already imported — no duplicate
    expect(out!.match(/"net\/http"/g)).toHaveLength(1);
  });

  // Mirrors the real xesina/golang-echo-realworld-example-app: router/router.go already imports
  // echo's own `middleware` package, so ours must be aliased (two same-named packages in one
  // file is a Go compile error), and net/http must be added for WrapHandler.
  it("wires echo via WrapMiddleware with an aliased import on package-name collision", () => {
    const routerGo = `package router\n\nimport (\n\t"github.com/labstack/echo/v4"\n\t"github.com/labstack/echo/v4/middleware"\n)\n\nfunc New() *echo.Echo {\n\te := echo.New()\n\te.Use(middleware.Logger())\n\treturn e\n}\n`;
    expect(detectGoRouterStyle(routerGo)).toBe("echo");
    const out = wireGoRouterFile(routerGo, {
      fixIds: ["helmet"],
      style: "echo",
      modulePath: "example.com/app",
      health: true,
    });
    expect(out).toContain("e.Use(echo.WrapMiddleware(lrmiddleware.SecurityHeaders))");
    expect(out).toContain('e.GET("/health", echo.WrapHandler(http.HandlerFunc(health.Handler)))');
    expect(out).toContain('lrmiddleware "example.com/app/internal/middleware"');
    expect(out).toContain('"net/http"');
  });

  it("finds the router file in a submodule when the entry has no constructor", () => {
    const files: Record<string, string> = {
      "main.go": `package main\n\nimport "example.com/app/app"\n\nfunc main() {\n\tapp.Run()\n}\n`,
      "app/app.go": `package app\n\nimport "github.com/gorilla/mux"\n\nfunc Run() {\n\tr := mux.NewRouter()\n\t_ = r\n}\n`,
    };
    expect(findGoRouterFile(Object.keys(files), (p) => files[p], "main.go")).toBe("app/app.go");
  });

  it("wires Rails middleware config", () => {
    const src = `module X\n  class Application < Rails::Application\n  end\nend\n`;
    const plan = buildRubyMiddlewareWiring(["helmet"], "rails");
    const out = patchRubyContent(src, plan!);
    expect(out).toContain("Middleware::SecurityHeaders");
  });

  it("wires ASP.NET middleware in Program.cs", () => {
    const program = `var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\napp.Run();\n`;
    const plan = buildCsharpMiddlewareWiring(["helmet", "cors"], "aspnet");
    const out = patchCsharpContent(program, plan!);
    expect(out).toContain("UseMiddleware<SecurityHeadersMiddleware>");
    expect(out).toContain("UseMiddleware<CorsMiddleware>");
  });

  it("wires Phoenix plugs in endpoint.ex", () => {
    const endpoint = `defmodule AppWeb.Endpoint do\n  use Phoenix.Endpoint\n  plug Plug.RequestId\nend\n`;
    const plan = buildElixirPlugWiring(["helmet"], "phoenix", "lib/app_web/endpoint.ex");
    const out = patchElixirContent(endpoint, plan!);
    expect(out).toContain("plug AppWeb.Plugs.SecurityHeaders");
  });
});
