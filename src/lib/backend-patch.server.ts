/**
 * Auto-wiring for Python, Java, Go, and Ruby backend entry points.
 */

export type PythonFramework = "fastapi" | "flask" | "unknown";

export const PYTHON_ENTRY_CANDIDATES = [
  "main.py",
  "app.py",
  "src/main.py",
  "src/app.py",
  "wsgi.py",
  "asgi.py",
];

export function pickPythonEntryPath(filePaths: string[]): string | null {
  for (const candidate of PYTHON_ENTRY_CANDIDATES) {
    if (filePaths.includes(candidate)) return candidate;
  }
  return filePaths.find((p) => /^(src\/)?(main|app)\.py$/.test(p)) ?? null;
}

export function detectPythonFramework(content: string): PythonFramework {
  if (/from fastapi import|FastAPI\s*\(/.test(content)) return "fastapi";
  if (/from flask import|Flask\s*\(/.test(content)) return "flask";
  return "unknown";
}

export interface PythonPatchUsage {
  after: string | RegExp;
  lines: string[];
}

export function patchPythonContent(
  content: string,
  opts: { importLines: string[]; usages: PythonPatchUsage[] },
): string | null {
  if (!content.trim()) return null;

  let lines = content.split("\n");

  if (opts.importLines.length) {
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line.startsWith("import ") || line.startsWith("from ")) lastImportIdx = i;
    }
    const insertAt = lastImportIdx >= 0 ? lastImportIdx + 1 : 0;
    lines = [...lines.slice(0, insertAt), ...opts.importLines, ...lines.slice(insertAt)];
  }

  for (const { after, lines: toAdd } of opts.usages) {
    const idx =
      typeof after === "string"
        ? lines.findIndex((l) => l.includes(after))
        : lines.findIndex((l) => after.test(l));
    if (idx === -1) return null;
    // The anchor line isn't always at column 0 — Flask's application-factory pattern
    // constructs `app = Flask(__name__)` from inside an indented function body (confirmed
    // against the real miguelgrinberg/microblog). Inserting toAdd verbatim there would produce
    // an unindented statement in the middle of an indented block — a Python IndentationError,
    // not just a cosmetic issue. Reuse the anchor's own leading whitespace on every inserted line.
    const indent = lines[idx]!.match(/^[ \t]*/)?.[0] ?? "";
    lines = [...lines.slice(0, idx + 1), ...toAdd.map((l) => indent + l), ...lines.slice(idx + 1)];
  }

  return lines.join("\n");
}

export function pickJavaApplicationPath(filePaths: string[]): string | null {
  const apps = filePaths.filter((p) => /Application\.java$/.test(p));
  if (apps.length === 0) return null;
  return (
    apps.find((p) => p.includes("src/main/java")) ??
    apps.sort((a, b) => a.split("/").length - b.split("/").length)[0] ??
    null
  );
}

export function extractJavaPackage(content: string): string | null {
  const m = content.match(/^package\s+([\w.]+)\s*;/m);
  return m?.[1] ?? null;
}

export function javaSourcePath(packageName: string, className: string): string {
  // Tolerate a className that already carries the extension. Every addJava() call site passed
  // "HealthController.java", so this appended a second one and shipped
  // `.../HealthController.java.java` in real fix PRs — a file javac rejects outright, since a
  // public class must live in a file named exactly after it. Kotlin's equivalent call sites pass
  // a bare name, which is why only Java was affected.
  const bare = className.replace(/\.java$/i, "");
  return `src/main/java/${packageName.replace(/\./g, "/")}/${bare}.java`;
}

/** Rewrites com.example.* templates to the repo's detected base package. */
export function rewriteJavaPackage(content: string, basePackage: string): string {
  return content.replace(/package com\.example([\w.]*);/g, (_, suffix: string) => {
    const sub = suffix.replace(/^\./, "");
    return sub ? `package ${basePackage}.${sub};` : `package ${basePackage};`;
  });
}

export function pickKotlinApplicationPath(filePaths: string[]): string | null {
  const apps = filePaths.filter((p) => /Application\.kt$/.test(p));
  if (apps.length === 0) return null;
  return (
    apps.find((p) => p.includes("src/main/kotlin")) ??
    apps.sort((a, b) => a.split("/").length - b.split("/").length)[0] ??
    null
  );
}

export function extractKotlinPackage(content: string): string | null {
  const m = content.match(/^package\s+([\w.]+)\s*$/m);
  return m?.[1] ?? null;
}

export function kotlinSourcePath(packageName: string, className: string): string {
  return `src/main/kotlin/${packageName.replace(/\./g, "/")}/${className}.kt`;
}

/** Rewrites com.example.* templates to the repo's detected base package (no trailing `;` — Kotlin). */
export function rewriteKotlinPackage(content: string, basePackage: string): string {
  return content.replace(/package com\.example([\w.]*)$/gm, (_, suffix: string) => {
    const sub = suffix.replace(/^\./, "");
    return sub ? `package ${basePackage}.${sub}` : `package ${basePackage}`;
  });
}

export function buildPythonMiddlewareWiring(
  fixIds: string[],
  framework: PythonFramework,
): { importLines: string[]; usages: PythonPatchUsage[] } {
  const importLines: string[] = [];
  const usages: PythonPatchUsage[] = [];
  const afterApp =
    framework === "flask"
      ? /=\s*Flask\s*\(/
      : framework === "fastapi"
        ? /=\s*FastAPI\s*\(/
        : /=\s*(Flask|FastAPI)\s*\(/;

  const register = (mod: string, fn: string) => {
    importLines.push(`from ${mod} import ${fn}`);
    usages.push({ after: afterApp, lines: [`${fn}(app)`] });
  };

  if (fixIds.includes("helmet")) {
    register(
      "middleware.security_headers",
      framework === "flask"
        ? "register_flask_security_headers"
        : "register_fastapi_security_headers",
    );
  }
  if (fixIds.includes("cors")) {
    register(
      "middleware.cors",
      framework === "flask" ? "register_flask_cors" : "register_fastapi_cors",
    );
  }
  if (fixIds.includes("rate-limit")) {
    register(
      "middleware.rate_limit",
      framework === "flask" ? "register_flask_rate_limit" : "register_fastapi_rate_limit",
    );
  }
  if (fixIds.includes("logger")) {
    register(
      "middleware.logger",
      framework === "flask" ? "register_flask_request_logger" : "register_fastapi_request_logger",
    );
  }
  // Pushed last on purpose: patchPythonContent re-anchors every usage on the same `= Flask(`/
  // `= FastAPI(` line and inserts right after it, which reverses insertion order — pushing
  // cookie-flags then https-redirect last makes https-redirect land first in the generated file
  // (short-circuits before anything else) with cookie-flags right behind it.
  if (fixIds.includes("security-cookie-flags")) {
    register(
      "middleware.cookie_flags",
      framework === "flask" ? "register_flask_cookie_flags" : "register_fastapi_cookie_flags",
    );
  }
  if (fixIds.includes("https-redirect")) {
    register(
      "middleware.https_redirect",
      framework === "flask" ? "register_flask_https_redirect" : "register_fastapi_https_redirect",
    );
  }

  return { importLines, usages };
}

export function buildPythonHealthWiring(framework: PythonFramework): {
  importLines: string[];
  usages: PythonPatchUsage[];
} {
  const afterApp =
    framework === "flask"
      ? /=\s*Flask\s*\(/
      : framework === "fastapi"
        ? /=\s*FastAPI\s*\(/
        : /=\s*(Flask|FastAPI)\s*\(/;

  if (framework === "flask") {
    return {
      importLines: ["from health import health_bp"],
      usages: [{ after: afterApp, lines: ["app.register_blueprint(health_bp)"] }],
    };
  }
  if (framework === "fastapi") {
    return {
      importLines: ["from health import health_router"],
      usages: [{ after: afterApp, lines: ["app.include_router(health_router)"] }],
    };
  }
  return { importLines: [], usages: [] };
}

// ─── Go ───────────────────────────────────────────────────────────────────────

export type GoRouterStyle = "chi" | "stdlib" | "gin" | "gorilla" | "echo" | "unknown";

export const GO_ENTRY_CANDIDATES = [
  "cmd/server/main.go",
  "cmd/api/main.go",
  "cmd/main.go",
  "main.go",
  "server.go",
];

export function pickGoEntryPath(filePaths: string[]): string | null {
  for (const candidate of GO_ENTRY_CANDIDATES) {
    if (filePaths.includes(candidate)) return candidate;
  }
  return filePaths.find((p) => /^(cmd\/[^/]+\/)?main\.go$/.test(p)) ?? null;
}

export function extractGoModulePath(goMod: string | undefined | null): string {
  if (!goMod) return "app";
  const m = goMod.match(/^module\s+(\S+)/m);
  return m?.[1] ?? "app";
}

export function detectGoRouterStyle(content: string): GoRouterStyle {
  if (/chi\.NewRouter|go-chi\/chi/.test(content)) return "chi";
  if (/gin\.Default\(|gin\.New\(/.test(content)) return "gin";
  // gorilla/echo must be checked before stdlib — real apps in both styles also call
  // http.ListenAndServe (confirmed: mingrammer/go-todo-rest-api-example serves its mux.Router
  // via http.ListenAndServe), which would misclassify them as stdlib.
  if (/mux\.NewRouter|gorilla\/mux/.test(content)) return "gorilla";
  if (/echo\.New\(\)|labstack\/echo/.test(content)) return "echo";
  if (/http\.HandleFunc|http\.NewServeMux|http\.ListenAndServe/.test(content)) return "stdlib";
  return "unknown";
}

// Explicit router constructors only — stdlib anchors (http.ListenAndServe etc.) appear in all
// kinds of files (clients, tests, tools), so cross-file search would misfire on them; the entry
// file remains the stdlib fallback.
const GO_ROUTER_CONSTRUCTOR_RE =
  /chi\.NewRouter\(\)|gin\.Default\(\)|gin\.New\(\)|mux\.NewRouter\(\)|echo\.New\(\)/;

/** Searches every .go file for the real router-constructor call — confirmed against two real
 * repos that it commonly lives in a submodule (app/app.go for gorilla/mux, router/router.go for
 * echo), not the picked main.go entry. Same submodule pattern (and same shallow-first fallback
 * behavior) as findRustAppFile. */
export function findGoRouterFile(
  filePaths: string[],
  getContent: (path: string) => string | undefined,
  fallback: string | null,
): string | null {
  const candidates = filePaths
    .filter((p) => p.endsWith(".go") && !p.endsWith("_test.go") && !/(^|\/)vendor\//.test(p))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  for (const path of candidates) {
    const content = getContent(path);
    if (content && GO_ROUTER_CONSTRUCTOR_RE.test(content)) return path;
  }
  return fallback;
}

export function patchGoContent(
  content: string,
  opts: { importLines: string[]; insertAfter?: RegExp; lines: string[] },
): string | null {
  if (!content.trim()) return null;
  let lines = content.split("\n");

  // Skip imports the file already has — wiring may need stdlib packages (e.g. net/http for
  // echo's WrapHandler) that real router files often already import; a duplicate import is a
  // compile error in Go. Supports `import alias "path"` lines (needed when the target file
  // already imports another package with the same base name).
  const parseImport = (l: string) => {
    const m = l.replace(/^import\s+/, "").match(/^(?:(\w+)\s+)?"?([^"\s]+)"?$/);
    return { alias: m?.[1], path: m?.[2] ?? l };
  };
  const neededImports = opts.importLines.filter(
    (l) => !content.includes(`"${parseImport(l).path}"`),
  );
  if (neededImports.length) {
    const importBlockStart = lines.findIndex((l) => l.trim() === "import (");
    if (importBlockStart >= 0) {
      let importBlockEnd = importBlockStart + 1;
      while (importBlockEnd < lines.length && lines[importBlockEnd]!.trim() !== ")") {
        importBlockEnd++;
      }
      lines = [
        ...lines.slice(0, importBlockEnd),
        ...neededImports.map((l) => {
          const { alias, path } = parseImport(l);
          return alias ? `\t${alias} "${path}"` : `\t"${path}"`;
        }),
        ...lines.slice(importBlockEnd),
      ];
    } else {
      const pkgIdx = lines.findIndex((l) => l.startsWith("package "));
      const insertAt = pkgIdx >= 0 ? pkgIdx + 1 : 0;
      lines = [...lines.slice(0, insertAt), ...neededImports, ...lines.slice(insertAt)];
    }
  }

  if (opts.lines.length > 0 && opts.insertAfter) {
    const idx = lines.findIndex((l) => opts.insertAfter!.test(l));
    if (idx === -1) return null;
    lines = [...lines.slice(0, idx + 1), ...opts.lines, ...lines.slice(idx + 1)];
  }

  return lines.join("\n");
}

export function buildGoMiddlewareWiring(
  fixIds: string[],
  style: GoRouterStyle,
  modulePath: string,
): { importLines: string[]; insertAfter: RegExp; lines: string[] } | null {
  const importLines = [`import "${modulePath}/internal/middleware"`];
  // https-redirect and security-cookie-flags pushed first (outermost) — HTTPSRedirect must
  // short-circuit before anything else runs, and SecureCookies must wrap the writer before any
  // downstream handler can call WriteHeader/Write. Go's Chain()/router .Use() apply wrappers in
  // registration order (first registered = outermost), unlike the Express/Python wiring below,
  // which re-anchors on the same line and reverses order — no reversal here.
  const mw: string[] = [];
  if (fixIds.includes("https-redirect")) mw.push("middleware.HTTPSRedirect");
  if (fixIds.includes("security-cookie-flags")) mw.push("middleware.SecureCookies");
  if (fixIds.includes("helmet")) mw.push("middleware.SecurityHeaders");
  if (fixIds.includes("cors")) mw.push("middleware.CORS");
  if (fixIds.includes("rate-limit")) mw.push("middleware.RateLimit");
  if (fixIds.includes("logger")) mw.push("middleware.RequestLogger");
  if (mw.length === 0) return null;

  if (style === "chi") {
    return {
      importLines,
      insertAfter: /chi\.NewRouter\(\)/,
      lines: mw.map((fn) => `\tr.Use(${fn})`),
    };
  }
  if (style === "stdlib") {
    return {
      importLines,
      insertAfter: /http\.NewServeMux\(\)|:= http\.NewServeMux/,
      lines: [],
    };
  }
  if (style === "gin") {
    const ginMw: string[] = [];
    if (fixIds.includes("https-redirect")) ginMw.push("middleware.GinHTTPSRedirect");
    if (fixIds.includes("security-cookie-flags")) ginMw.push("middleware.GinSecureCookies");
    if (fixIds.includes("helmet")) ginMw.push("middleware.GinSecurityHeaders");
    if (fixIds.includes("cors")) ginMw.push("middleware.GinCORS");
    if (fixIds.includes("rate-limit")) ginMw.push("middleware.GinRateLimit");
    if (fixIds.includes("logger")) ginMw.push("middleware.GinRequestLogger");
    return {
      importLines: [`import "${modulePath}/internal/middleware"`],
      insertAfter: /gin\.Default\(\)|:= gin\.New\(\)|r := gin\./,
      lines: ginMw.map((fn) => `\tr.Use(${fn}())`),
    };
  }
  return null;
}

export function buildGoHealthWiring(
  style: GoRouterStyle,
  modulePath: string,
): { importLines: string[]; insertAfter: RegExp; lines: string[] } | null {
  const importLines = [`import "${modulePath}/internal/health"`];
  if (style === "chi") {
    return {
      importLines,
      insertAfter: /chi\.NewRouter\(\)/,
      lines: [`\tr.Get("/health", health.Handler)`],
    };
  }
  if (style === "stdlib") {
    return {
      importLines,
      insertAfter: /http\.NewServeMux\(\)|:= http\.NewServeMux/,
      lines: [`\tmux.HandleFunc("/health", health.Handler)`],
    };
  }
  if (style === "gin") {
    return {
      importLines,
      insertAfter: /gin\.Default\(\)|gin\.New\(\)/,
      lines: [`\tr.GET("/health", func(c *gin.Context) { health.Handler(c.Writer, c.Request) })`],
    };
  }
  return null;
}

const GO_ROUTER_ANCHORS: Record<"gorilla" | "echo", RegExp> = {
  gorilla: /(\S+)\s*:?=\s*mux\.NewRouter\(\)/,
  echo: /(\S+)\s*:?=\s*echo\.New\(\)/,
};

/**
 * Wires middleware + health into a gorilla/mux or echo router file in one pass. Receiver-aware:
 * the real mingrammer/go-todo-rest-api-example assigns `a.Router = mux.NewRouter()` (a struct
 * field, not a local `r`), so the generated .Use/.HandleFunc calls must target whatever the
 * anchor line actually assigns. gorilla's *mux.Router.Use takes func(http.Handler) http.Handler
 * directly (same signature as the generated middleware); echo adapts the same functions through
 * its built-in echo.WrapMiddleware/echo.WrapHandler.
 */
export function wireGoRouterFile(
  content: string,
  opts: {
    fixIds: string[];
    style: "gorilla" | "echo";
    modulePath: string;
    health: boolean;
  },
): string | null {
  const anchor = GO_ROUTER_ANCHORS[opts.style];
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => anchor.test(l));
  if (idx === -1) return null;
  const receiver = lines[idx]!.match(anchor)![1]!;

  // Real echo apps already import echo's own middleware package (confirmed:
  // xesina/golang-echo-realworld-example-app's router.go uses middleware.Logger() from
  // labstack/echo/v4/middleware) — importing our internal/middleware unaliased would be two
  // packages named `middleware` in one file, a compile error. Alias on collision.
  const importsPkgNamed = (base: string) => new RegExp(`"[^"]*/${base}"|"${base}"`).test(content);
  const mwName = importsPkgNamed("middleware") ? "lrmiddleware" : "middleware";
  const healthName = importsPkgNamed("health") ? "lrhealth" : "health";
  const mw = goMiddlewareFnNames(opts.fixIds).map((fn) =>
    fn.replace(/^middleware\./, `${mwName}.`),
  );

  const inserted: string[] = [];
  if (opts.style === "gorilla") {
    inserted.push(...mw.map((fn) => `\t${receiver}.Use(${fn})`));
    if (opts.health) inserted.push(`\t${receiver}.HandleFunc("/health", ${healthName}.Handler)`);
  } else {
    inserted.push(...mw.map((fn) => `\t${receiver}.Use(echo.WrapMiddleware(${fn}))`));
    if (opts.health) {
      inserted.push(
        `\t${receiver}.GET("/health", echo.WrapHandler(http.HandlerFunc(${healthName}.Handler)))`,
      );
    }
  }
  if (inserted.length === 0) return null;

  const aliased = (name: string, base: string) => (name === base ? "" : `${name} `);
  const importLines: string[] = [];
  if (mw.length > 0) {
    importLines.push(
      `import ${aliased(mwName, "middleware")}"${opts.modulePath}/internal/middleware"`,
    );
  }
  if (opts.health) {
    importLines.push(`import ${aliased(healthName, "health")}"${opts.modulePath}/internal/health"`);
  }
  // echo's WrapHandler needs http.HandlerFunc from net/http — patchGoContent dedupes if the
  // file already imports it.
  if (opts.style === "echo" && opts.health) importLines.push(`import "net/http"`);

  const withInserted = [...lines.slice(0, idx + 1), ...inserted, ...lines.slice(idx + 1)].join(
    "\n",
  );
  return patchGoContent(withInserted, { importLines, lines: [] });
}

/** Wraps the handler passed to http.ListenAndServe with middleware.Chain. */
export function wrapGoStdlibHandler(content: string, middlewareFns: string[]): string | null {
  if (middlewareFns.length === 0) return content;
  const re = /http\.ListenAndServe\(([^,]+),\s*([^)]+)\)/;
  if (!re.test(content)) return null;
  return content.replace(re, (_match, addr, handler) => {
    const h = handler.trim();
    return `http.ListenAndServe(${addr}, middleware.Chain(${h}, ${middlewareFns.join(", ")}))`;
  });
}

export function goMiddlewareFnNames(fixIds: string[]): string[] {
  const mw: string[] = [];
  if (fixIds.includes("https-redirect")) mw.push("middleware.HTTPSRedirect");
  if (fixIds.includes("security-cookie-flags")) mw.push("middleware.SecureCookies");
  if (fixIds.includes("helmet")) mw.push("middleware.SecurityHeaders");
  if (fixIds.includes("cors")) mw.push("middleware.CORS");
  if (fixIds.includes("rate-limit")) mw.push("middleware.RateLimit");
  if (fixIds.includes("logger")) mw.push("middleware.RequestLogger");
  return mw;
}

// ─── Ruby ─────────────────────────────────────────────────────────────────────

export type RubyFramework = "rails" | "sinatra" | "rack" | "unknown";

export const RUBY_CONFIG_CANDIDATES = ["config/application.rb", "config.ru", "app.rb"];

export function pickRubyConfigPath(filePaths: string[]): string | null {
  for (const candidate of RUBY_CONFIG_CANDIDATES) {
    if (filePaths.includes(candidate)) return candidate;
  }
  return null;
}

export function pickRubyRoutesPath(filePaths: string[]): string | null {
  if (filePaths.includes("config/routes.rb")) return "config/routes.rb";
  return filePaths.find((p) => p.endsWith("routes.rb")) ?? null;
}

export function detectRubyFramework(content: string, path: string): RubyFramework {
  if (/Rails::Application/.test(content) || path === "config/application.rb") return "rails";
  if (/Sinatra::Base|Sinatra::Application/.test(content)) return "sinatra";
  if (path === "config.ru" || /Rack::Builder/.test(content)) return "rack";
  return "unknown";
}

export function patchRubyContent(
  content: string,
  opts: { lines: string[]; insertAfter: RegExp },
): string | null {
  if (!content.trim()) return null;
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => opts.insertAfter.test(l));
  if (idx === -1) return null;
  return [...lines.slice(0, idx + 1), ...opts.lines, ...lines.slice(idx + 1)].join("\n");
}

export function buildRubyMiddlewareWiring(
  fixIds: string[],
  framework: RubyFramework,
): { path: string; insertAfter: RegExp; lines: string[] } | null {
  const classes: string[] = [];
  if (fixIds.includes("helmet")) classes.push("Middleware::SecurityHeaders");
  if (fixIds.includes("cors")) classes.push("Middleware::Cors");
  if (fixIds.includes("rate-limit")) classes.push("Middleware::RateLimit");
  if (fixIds.includes("logger")) classes.push("Middleware::RequestLogger");
  if (classes.length === 0) return null;

  if (framework === "rails") {
    return {
      path: "config/application.rb",
      insertAfter: /class Application < Rails::Application/,
      lines: classes.map((c) => `    config.middleware.use ${c}`),
    };
  }
  if (framework === "sinatra" || framework === "rack") {
    return {
      path: "config.ru",
      insertAfter: /run\s+|use\s+Rack::|map\s+/,
      lines: classes.map((c) => `use ${c}`),
    };
  }
  return null;
}

export function buildRubyHealthWiring(): {
  path: string;
  insertAfter: RegExp;
  lines: string[];
} {
  return {
    path: "config/routes.rb",
    insertAfter: /Rails\.application\.routes\.draw do/,
    lines: [`  get "/health", to: "health#show"`],
  };
}

// ─── PHP ──────────────────────────────────────────────────────────────────────

export type PhpFramework = "laravel" | "symfony" | "unknown";

export function pickPhpKernelPath(filePaths: string[]): string | null {
  if (filePaths.includes("app/Http/Kernel.php")) return "app/Http/Kernel.php";
  if (filePaths.includes("bootstrap/app.php")) return "bootstrap/app.php";
  return null;
}

export function pickSymfonyRoutesPath(filePaths: string[]): string | null {
  if (filePaths.includes("config/routes.yaml")) return "config/routes.yaml";
  if (filePaths.includes("config/routes.yml")) return "config/routes.yml";
  return filePaths.find((p) => /^config\/routes\/.+\.ya?ml$/.test(p)) ?? null;
}

export function detectPhpFramework(
  filePaths: string[],
  composerJson?: string | null,
): PhpFramework {
  const blob = composerJson ?? "";
  if (/laravel\/framework/.test(blob) || filePaths.includes("artisan")) return "laravel";
  if (/symfony\//.test(blob) || filePaths.includes("symfony.lock")) return "symfony";
  return "unknown";
}

export function patchPhpContent(
  content: string,
  opts: { lines: string[]; insertAfter: RegExp },
): string | null {
  return patchRubyContent(content, opts);
}

// Laravel 11 (Feb 2024) removed app/Http/Kernel.php entirely in favor of a fluent
// bootstrap/app.php API (Application::configure()->withMiddleware(...)) — confirmed this broke
// wiring completely for any Laravel 11+ project: pickPhpKernelPath correctly falls back to
// bootstrap/app.php, but this function still only knew the old Kernel.php `$middleware = []`
// array syntax, and the call site's `plan.path === kernelPath` safety check silently discarded
// the mismatch rather than wiring anything — Laravel 11 projects got zero middleware wiring
// while still reporting "verified". Branch on which file was actually found instead of assuming
// Kernel.php always exists.
export function buildPhpMiddlewareWiring(
  fixIds: string[],
  framework: PhpFramework,
  kernelPath: string | null,
): { path: string; insertAfter: RegExp; lines: string[] } | null {
  const classes: string[] = [];
  if (fixIds.includes("helmet")) classes.push("\\App\\Http\\Middleware\\SecurityHeaders::class");
  if (fixIds.includes("cors")) classes.push("\\App\\Http\\Middleware\\CorsMiddleware::class");
  if (fixIds.includes("rate-limit"))
    classes.push("\\App\\Http\\Middleware\\RateLimitMiddleware::class");
  if (fixIds.includes("logger")) classes.push("\\App\\Http\\Middleware\\RequestLogger::class");
  if (classes.length === 0) return null;

  if (framework === "laravel" && kernelPath === "bootstrap/app.php") {
    return {
      path: "bootstrap/app.php",
      // Confirmed against the real official Laravel skeleton: it declares `: void` between the
      // closing paren and the brace — an earlier version of this regex without the optional
      // return-type group would have matched nothing on the actual generated file.
      insertAfter: /->withMiddleware\(function \(Middleware \$middleware\)(?:\s*:\s*\w+)?\s*\{/,
      lines: classes.map((c) => `        $middleware->append(${c});`),
    };
  }
  if (framework === "laravel" && kernelPath === "app/Http/Kernel.php") {
    return {
      path: "app/Http/Kernel.php",
      insertAfter: /protected \$middleware = \[/,
      lines: classes.map((c) => `        ${c},`),
    };
  }
  // Symfony auto-discovers EventSubscriber classes under src/
  return null;
}

export function buildPhpHealthWiring(framework: PhpFramework): {
  path: string;
  insertAfter: RegExp;
  lines: string[];
} | null {
  if (framework === "laravel") {
    return {
      path: "routes/web.php",
      insertAfter: /^<\?php/,
      lines: [`Route::get('/health', fn () => response()->json(['status' => 'ok']));`],
    };
  }
  if (framework === "symfony") {
    return {
      path: "config/routes.yaml",
      insertAfter: /^[\s\S]*$/m,
      lines: [
        `health_check:`,
        `  path: /health`,
        `  methods: [GET]`,
        `  controller: App\\Controller\\HealthController::index`,
      ],
    };
  }
  return null;
}

// ─── Rust ─────────────────────────────────────────────────────────────────────

export type RustFramework = "axum" | "actix" | "unknown";

export const RUST_ENTRY_CANDIDATES = ["src/main.rs", "src/bin/server.rs", "src/bin/main.rs"];

export function pickRustEntryPath(filePaths: string[]): string | null {
  for (const c of RUST_ENTRY_CANDIDATES) {
    if (filePaths.includes(c)) return c;
  }
  return filePaths.find((p) => /^src\/(main|bin\/[^/]+)\.rs$/.test(p)) ?? null;
}

export function detectRustFramework(content: string, cargoToml?: string | null): RustFramework {
  const blob = [content, cargoToml].filter(Boolean).join("\n");
  if (/axum/.test(blob)) return "axum";
  if (/actix-web|actix_web/.test(blob)) return "actix";
  return "unknown";
}

export function patchRustContent(
  content: string,
  opts: { lines: string[]; insertAfter: RegExp },
): string | null {
  return patchRubyContent(content, opts);
}

// Confirmed against a real repo: App::new()/Router::new() commonly live in a submodule (e.g.
// src/app/mod.rs), not in the picked main.rs entry — `mod middleware;` in main.rs still makes it
// reachable crate-wide, but only via an absolute `crate::` path; the old bare `middleware::X`
// only resolves when the wrap/layer call happens to be in the crate-root file itself. Using
// `crate::` makes the generated call correct regardless of which file it's inserted into.
export function buildRustMiddlewareWiring(
  fixIds: string[],
  framework: RustFramework,
): { insertAfter: RegExp; lines: string[] } | null {
  if (framework === "axum") {
    const layers: string[] = [];
    if (fixIds.includes("helmet"))
      layers.push(".layer(axum::middleware::from_fn(crate::middleware::security_headers))");
    if (fixIds.includes("cors"))
      layers.push(".layer(axum::middleware::from_fn(crate::middleware::cors))");
    if (fixIds.includes("rate-limit"))
      layers.push(".layer(axum::middleware::from_fn(crate::middleware::rate_limit))");
    if (fixIds.includes("logger"))
      layers.push(".layer(axum::middleware::from_fn(crate::middleware::request_logger))");
    if (layers.length === 0) return null;
    return {
      insertAfter: /Router::new\(\)/,
      lines: layers.map((l) => `\t\t${l}`),
    };
  }
  if (framework === "actix") {
    const wraps: string[] = [];
    if (fixIds.includes("helmet"))
      wraps.push(".wrap(actix_web::middleware::from_fn(crate::middleware::security_headers))");
    if (fixIds.includes("cors"))
      wraps.push(".wrap(actix_web::middleware::from_fn(crate::middleware::cors))");
    if (fixIds.includes("rate-limit"))
      wraps.push(".wrap(actix_web::middleware::from_fn(crate::middleware::rate_limit))");
    if (fixIds.includes("logger"))
      wraps.push(".wrap(actix_web::middleware::from_fn(crate::middleware::request_logger))");
    if (wraps.length === 0) return null;
    return {
      insertAfter: /App::new\(\)/,
      lines: wraps.map((w) => `\t\t${w}`),
    };
  }
  return null;
}

export function buildRustHealthWiring(framework: RustFramework): {
  insertAfter: RegExp;
  lines: string[];
} | null {
  if (framework === "axum") {
    return {
      insertAfter: /Router::new\(\)/,
      lines: ["\t\t.merge(crate::health::health_routes())"],
    };
  }
  if (framework === "actix") {
    return {
      insertAfter: /App::new\(\)/,
      lines: [
        '\t\t.route("/health", web::get().to(|| async { HttpResponse::Ok().json(serde_json::json!({"status":"ok"})) }))',
      ],
    };
  }
  return null;
}

/** Searches every .rs file for the real App::new()/Router::new() call — confirmed against a
 * real repo that this commonly lives in a submodule (src/app/mod.rs), not the crate-root entry
 * file the old code assumed. Falls back to the entry file if nothing else matches, so behavior
 * degrades to the old (still sometimes-correct) assumption rather than breaking. */
export function findRustAppFile(
  filePaths: string[],
  getContent: (path: string) => string | undefined,
  framework: RustFramework,
  fallback: string | null,
): string | null {
  const anchor = framework === "axum" ? /Router::new\(\)/ : /App::new\(\)/;
  const candidates = filePaths
    .filter((p) => p.endsWith(".rs") && !p.startsWith("target/"))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  for (const path of candidates) {
    const content = getContent(path);
    if (content && anchor.test(content)) return path;
  }
  return fallback;
}

// ─── C# / ASP.NET Core ────────────────────────────────────────────────────────

export type CsharpFramework = "aspnet" | "unknown";

export const CSHARP_ENTRY_CANDIDATES = ["Program.cs", "Startup.cs"];

export function pickCsharpProgramPath(filePaths: string[]): string | null {
  for (const c of CSHARP_ENTRY_CANDIDATES) {
    if (filePaths.includes(c)) return c;
  }
  return filePaths.find((p) => /Program\.cs$/.test(p)) ?? null;
}

export function detectCsharpFramework(content: string, csproj?: string | null): CsharpFramework {
  const blob = [content, csproj].filter(Boolean).join("\n");
  if (/WebApplication\.CreateBuilder|Microsoft\.AspNetCore/i.test(blob)) return "aspnet";
  return "unknown";
}

export function patchCsharpContent(
  content: string,
  opts: { lines: string[]; insertAfter: RegExp },
): string | null {
  return patchRubyContent(content, opts);
}

export function buildCsharpMiddlewareWiring(
  fixIds: string[],
  framework: CsharpFramework,
): { insertAfter: RegExp; lines: string[] } | null {
  if (framework !== "aspnet") return null;
  const uses: string[] = [];
  if (fixIds.includes("helmet")) uses.push("app.UseMiddleware<SecurityHeadersMiddleware>();");
  if (fixIds.includes("cors")) uses.push("app.UseMiddleware<CorsMiddleware>();");
  if (fixIds.includes("rate-limit")) uses.push("app.UseMiddleware<RateLimitMiddleware>();");
  if (fixIds.includes("logger")) uses.push("app.UseMiddleware<RequestLoggerMiddleware>();");
  if (uses.length === 0) return null;
  return {
    insertAfter: /var app = builder\.Build\(\);|app = builder\.Build\(\);/,
    lines: uses,
  };
}

export function buildCsharpHealthWiring(framework: CsharpFramework): {
  insertAfter: RegExp;
  lines: string[];
} | null {
  if (framework !== "aspnet") return null;
  return {
    insertAfter: /var app = builder\.Build\(\);|app = builder\.Build\(\);/,
    lines: ['app.MapGet("/health", () => Results.Ok(new { status = "ok" }));'],
  };
}

// ─── Elixir / Phoenix ─────────────────────────────────────────────────────────

export type ElixirFramework = "phoenix" | "unknown";

export function pickElixirEndpointPath(filePaths: string[]): string | null {
  return filePaths.find((p) => /_web\/endpoint\.ex$/.test(p)) ?? null;
}

export function pickElixirRouterPath(filePaths: string[]): string | null {
  return filePaths.find((p) => /_web\/router\.ex$/.test(p)) ?? null;
}

export function detectElixirFramework(mixExs?: string | null): ElixirFramework {
  if (/phoenix/i.test(mixExs ?? "")) return "phoenix";
  return "unknown";
}

export function patchElixirContent(
  content: string,
  opts: { lines: string[]; insertAfter: RegExp },
): string | null {
  return patchRubyContent(content, opts);
}

export function buildElixirPlugWiring(
  fixIds: string[],
  framework: ElixirFramework,
  endpointPath: string,
): { path: string; insertAfter: RegExp; lines: string[] } | null {
  const plugs: string[] = [];
  if (fixIds.includes("helmet")) plugs.push("AppWeb.Plugs.SecurityHeaders");
  if (fixIds.includes("cors")) plugs.push("AppWeb.Plugs.Cors");
  if (fixIds.includes("rate-limit")) plugs.push("AppWeb.Plugs.RateLimit");
  if (fixIds.includes("logger")) plugs.push("AppWeb.Plugs.RequestLogger");
  if (plugs.length === 0 || framework !== "phoenix") return null;
  return {
    path: endpointPath,
    insertAfter: /plug Plug\.RequestId|plug Plug\.Telemetry|use Phoenix\.Endpoint/,
    lines: plugs.map((p) => `  plug ${p}`),
  };
}

export function buildElixirHealthWiring(
  framework: ElixirFramework,
  routerPath: string,
): { path: string; insertAfter: RegExp; lines: string[] } | null {
  if (framework !== "phoenix") return null;
  return {
    path: routerPath,
    insertAfter: /scope\s+"\/",\s+\w+\s+do|use\s+\w+Web,\s+:router/,
    lines: [`    get "/health", HealthController, :index`],
  };
}
