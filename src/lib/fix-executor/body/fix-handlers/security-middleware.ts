import {
  HELMET_MIDDLEWARE_EXPRESS,
  RATE_LIMIT_MIDDLEWARE_EXPRESS,
  CORS_EXPRESS,
  WINSTON_LOGGER,
  REQUEST_LOGGER_MIDDLEWARE,
  COOKIE_FLAGS_MIDDLEWARE_EXPRESS,
  HTTPS_REDIRECT_MIDDLEWARE_EXPRESS,
  CSRF_MIDDLEWARE_EXPRESS,
} from "../express/middleware";
import {
  SECURITY_HEADERS_FETCH,
  RATE_LIMITER_FETCH,
  CORS_FETCH,
  LOGGER_FETCH,
  SECURE_COOKIES_FETCH,
  HTTPS_REDIRECT_FETCH,
} from "../fetch-runtime/security";
import {
  SECURITY_HEADERS_PYTHON,
  RATE_LIMIT_PYTHON,
  CORS_PYTHON,
  LOGGER_PYTHON,
  COOKIE_FLAGS_PYTHON,
  HTTPS_REDIRECT_PYTHON,
} from "../languages/python/templates";
import {
  SECURITY_HEADERS_JAVA,
  RATE_LIMIT_JAVA,
  CORS_JAVA,
  LOGGER_JAVA,
} from "../languages/java/templates";
import {
  SECURITY_HEADERS_KOTLIN,
  RATE_LIMIT_KOTLIN,
  CORS_KOTLIN,
  LOGGER_KOTLIN,
} from "../languages/kotlin/templates";
import { MIDDLEWARE_GO } from "../languages/go/templates";
import {
  SECURITY_HEADERS_RUBY,
  RATE_LIMIT_RUBY,
  CORS_RUBY,
  LOGGER_RUBY,
} from "../languages/ruby/templates";
import {
  SECURITY_HEADERS_ELIXIR,
  RATE_LIMIT_ELIXIR,
  CORS_ELIXIR,
  LOGGER_ELIXIR,
} from "../languages/elixir/templates";
import {
  SECURITY_HEADERS_PHP,
  RATE_LIMIT_PHP,
  CORS_PHP,
  LOGGER_PHP,
} from "../languages/php/templates";
import {
  SECURITY_HEADERS_SYMFONY,
  RATE_LIMIT_SYMFONY,
  CORS_SYMFONY,
  LOGGER_SYMFONY,
} from "../languages/php/symfony";
import {
  SECURITY_HEADERS_CSHARP,
  RATE_LIMIT_CSHARP,
  CORS_CSHARP,
  LOGGER_CSHARP,
} from "../languages/csharp/templates";
import type { FixCtx } from "../shared/fix-ctx";

export function handleHelmet(fx: FixCtx) {
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
  if (ctx.language === "python") {
    add("middleware/security_headers.py", SECURITY_HEADERS_PYTHON);
    note(
      "helmet",
      "verified",
      "security_headers.py created — call register_flask_security_headers(app) or add FastAPISecurityHeadersMiddleware",
    );
  } else if (ctx.language === "java") {
    addJava("security", "SecurityHeadersFilter.java", SECURITY_HEADERS_JAVA);
    note(
      "helmet",
      "verified",
      "SecurityHeadersFilter created — adjust package name to match your project (Spring auto-registers @Component filters)",
    );
  } else if (ctx.language === "kotlin") {
    addKotlin("security", "SecurityHeadersFilter", SECURITY_HEADERS_KOTLIN);
    note(
      "helmet",
      "verified",
      "SecurityHeadersFilter created — adjust package name to match your project (Spring auto-registers @Component filters)",
    );
  } else if (ctx.language === "go") {
    if (!fileMap.has("internal/middleware/middleware.go")) {
      add("internal/middleware/middleware.go", MIDDLEWARE_GO);
    }
    note("helmet", "verified", "Go security headers middleware — wiring attempted in main.go");
  } else if (ctx.language === "ruby") {
    add("lib/middleware/security_headers.rb", SECURITY_HEADERS_RUBY);
    note(
      "helmet",
      "verified",
      "Rack security headers middleware — wiring attempted in config/application.rb",
    );
  } else if (ctx.language === "elixir") {
    add("lib/app_web/plugs/security_headers.ex", SECURITY_HEADERS_ELIXIR);
    note("helmet", "verified", "Phoenix security headers plug — wiring attempted in endpoint.ex");
  } else if (ctx.language === "php") {
    if (phpFw === "symfony") {
      add("src/EventSubscriber/SecurityHeadersSubscriber.php", SECURITY_HEADERS_SYMFONY);
      note(
        "helmet",
        "verified",
        "Symfony SecurityHeaders EventSubscriber — auto-discovered under src/",
      );
    } else if (phpFw === "laravel") {
      add("app/Http/Middleware/SecurityHeaders.php", SECURITY_HEADERS_PHP);
      note(
        "helmet",
        "verified",
        "Laravel SecurityHeaders middleware — wiring attempted in app/Http/Kernel.php",
      );
    } else {
      note(
        "helmet",
        "warning",
        "Could not detect Laravel or Symfony — add security headers manually for your framework",
      );
    }
  } else if (ctx.language === "rust") {
    if (!fileMap.has("src/middleware.rs")) add("src/middleware.rs", rustMiddlewareSrc);
    note(
      "helmet",
      "verified",
      rustFwHint === "actix"
        ? "Actix security middleware — wiring attempted in src/main.rs"
        : "Axum security middleware — wiring attempted in src/main.rs",
    );
  } else if (ctx.language === "csharp") {
    add("Middleware/SecurityHeadersMiddleware.cs", SECURITY_HEADERS_CSHARP);
    note(
      "helmet",
      "verified",
      "ASP.NET security headers middleware — wiring attempted in Program.cs",
    );
  } else if (ctx.hasExpress) {
    add("src/middleware/security.ts", HELMET_MIDDLEWARE_EXPRESS);
    Object.assign(pkgMods.deps, { helmet: "^7.2.0" });
  } else {
    add("src/lib/security-headers.ts", SECURITY_HEADERS_FETCH);
    note(
      "helmet",
      "verified",
      "Security headers util added — wrap your fetch Responses with withSecurityHeaders() in your server entry or route handlers",
    );
  }
}

export function handleRateLimit(fx: FixCtx) {
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
  if (ctx.language === "python") {
    add("middleware/rate_limit.py", RATE_LIMIT_PYTHON);
    note(
      "rate-limit",
      "verified",
      "rate_limit.py created — call check_rate_limit(client_ip) at the start of sensitive routes",
    );
  } else if (ctx.language === "java") {
    addJava("security", "RateLimitFilter.java", RATE_LIMIT_JAVA);
    note(
      "rate-limit",
      "verified",
      "RateLimitFilter created — Spring auto-registers @Component filters; tune limits for production",
    );
  } else if (ctx.language === "kotlin") {
    addKotlin("security", "RateLimitFilter", RATE_LIMIT_KOTLIN);
    note(
      "rate-limit",
      "verified",
      "RateLimitFilter created — Spring auto-registers @Component filters; tune limits for production",
    );
  } else if (ctx.language === "go") {
    if (!fileMap.has("internal/middleware/middleware.go")) {
      add("internal/middleware/middleware.go", MIDDLEWARE_GO);
    }
    note("rate-limit", "verified", "Go rate limiter — wiring attempted in main.go");
  } else if (ctx.language === "ruby") {
    add("lib/middleware/rate_limit.rb", RATE_LIMIT_RUBY);
    note(
      "rate-limit",
      "verified",
      "Rack rate limit middleware — wiring attempted in config/application.rb",
    );
  } else if (ctx.language === "elixir") {
    add("lib/app_web/plugs/rate_limit.ex", RATE_LIMIT_ELIXIR);
    note("rate-limit", "verified", "Phoenix rate limit plug — wiring attempted in endpoint.ex");
  } else if (ctx.language === "php") {
    if (phpFw === "symfony") {
      add("src/EventSubscriber/RateLimitSubscriber.php", RATE_LIMIT_SYMFONY);
      note(
        "rate-limit",
        "verified",
        "Symfony RateLimit EventSubscriber — auto-discovered under src/",
      );
    } else if (phpFw === "laravel") {
      add("app/Http/Middleware/RateLimitMiddleware.php", RATE_LIMIT_PHP);
      note(
        "rate-limit",
        "verified",
        "Laravel rate limit middleware — wiring attempted in app/Http/Kernel.php",
      );
    } else {
      note(
        "rate-limit",
        "warning",
        "Could not detect Laravel or Symfony — add rate limiting manually for your framework",
      );
    }
  } else if (ctx.language === "rust") {
    if (!fileMap.has("src/middleware.rs")) add("src/middleware.rs", rustMiddlewareSrc);
    note(
      "rate-limit",
      "verified",
      rustFwHint === "actix"
        ? "Actix rate limit layer — wiring attempted in src/main.rs"
        : "Axum rate limit layer — wiring attempted in src/main.rs",
    );
  } else if (ctx.language === "csharp") {
    add("Middleware/RateLimitMiddleware.cs", RATE_LIMIT_CSHARP);
    note(
      "rate-limit",
      "verified",
      "ASP.NET rate limit middleware — wiring attempted in Program.cs",
    );
  } else if (ctx.hasExpress) {
    add("src/middleware/rate-limit.ts", RATE_LIMIT_MIDDLEWARE_EXPRESS);
    Object.assign(pkgMods.deps, { "express-rate-limit": "^7.4.0" });
  } else {
    add("src/lib/rate-limit.ts", RATE_LIMITER_FETCH);
    note(
      "rate-limit",
      "verified",
      "In-memory rate limiter added — call checkRateLimit(ip) in your route handlers and return rateLimitResponse() when not allowed. For production deployments, consider a rate limiting API instead.",
    );
  }
}

export function handleCors(fx: FixCtx) {
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
  if (ctx.language === "python") {
    add("middleware/cors.py", CORS_PYTHON);
    note(
      "cors",
      "verified",
      "cors.py created — call register_flask_cors(app) or apply cors_headers(origin) in FastAPI middleware; pip install flask-cors for Flask",
    );
  } else if (ctx.language === "java") {
    addJava("security", "CorsConfig.java", CORS_JAVA);
    note(
      "cors",
      "verified",
      "CorsConfig created — set ALLOWED_ORIGINS env var (comma-separated origins)",
    );
  } else if (ctx.language === "kotlin") {
    addKotlin("security", "CorsConfig", CORS_KOTLIN);
    note(
      "cors",
      "verified",
      "CorsConfig created — set ALLOWED_ORIGINS env var (comma-separated origins)",
    );
  } else if (ctx.language === "go") {
    if (!fileMap.has("internal/middleware/middleware.go")) {
      add("internal/middleware/middleware.go", MIDDLEWARE_GO);
    }
    note("cors", "verified", "Go CORS middleware — wiring attempted in main.go");
  } else if (ctx.language === "ruby") {
    add("lib/middleware/cors.rb", CORS_RUBY);
    note("cors", "verified", "Rack CORS middleware — wiring attempted in config/application.rb");
  } else if (ctx.language === "elixir") {
    add("lib/app_web/plugs/cors.ex", CORS_ELIXIR);
    note("cors", "verified", "Phoenix CORS plug — set ALLOWED_ORIGINS in runtime config");
  } else if (ctx.language === "php") {
    if (phpFw === "symfony") {
      add("src/EventSubscriber/CorsSubscriber.php", CORS_SYMFONY);
      note("cors", "verified", "Symfony CORS EventSubscriber — set ALLOWED_ORIGINS in .env");
    } else if (phpFw === "laravel") {
      add("app/Http/Middleware/CorsMiddleware.php", CORS_PHP);
      note("cors", "verified", "Laravel CORS middleware — wiring attempted in app/Http/Kernel.php");
    } else {
      note(
        "cors",
        "warning",
        "Could not detect Laravel or Symfony — add CORS headers manually for your framework",
      );
    }
  } else if (ctx.language === "rust") {
    if (!fileMap.has("src/middleware.rs")) add("src/middleware.rs", rustMiddlewareSrc);
    note(
      "cors",
      "verified",
      rustFwHint === "actix"
        ? "Actix CORS layer — wiring attempted in src/main.rs"
        : "Axum CORS layer — wiring attempted in src/main.rs",
    );
  } else if (ctx.language === "csharp") {
    add("Middleware/CorsMiddleware.cs", CORS_CSHARP);
    note("cors", "verified", "ASP.NET CORS middleware — wiring attempted in Program.cs");
  } else if (ctx.hasExpress) {
    add("src/middleware/cors.ts", CORS_EXPRESS);
    Object.assign(pkgMods.deps, { cors: "^2.8.5", "@types/cors": "^2.8.17" });
  } else {
    add("src/lib/cors.ts", CORS_FETCH);
    note(
      "cors",
      "verified",
      "CORS helpers added — set ALLOWED_ORIGINS env var (comma-separated) and call corsHeaders(origin) to add CORS headers to your responses. Call handleCorsPreflight(request) to handle OPTIONS requests.",
    );
  }
}

export function handleLogger(fx: FixCtx) {
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
  if (ctx.language === "python") {
    add("middleware/logger.py", LOGGER_PYTHON);
    note("logger", "verified", "logger.py created — import logger and call logger.info/warn/error");
  } else if (ctx.language === "java") {
    addJava("logging", "AppLogger.java", LOGGER_JAVA);
    note(
      "logger",
      "verified",
      "AppLogger created — inject or use SLF4J AppLogger for structured logs",
    );
  } else if (ctx.language === "kotlin") {
    addKotlin("logging", "AppLogger", LOGGER_KOTLIN);
    note(
      "logger",
      "verified",
      "AppLogger created — inject or use SLF4J AppLogger for structured logs",
    );
  } else if (ctx.language === "go") {
    if (!fileMap.has("internal/middleware/middleware.go")) {
      add("internal/middleware/middleware.go", MIDDLEWARE_GO);
    }
    note("logger", "verified", "Go request logger — wiring attempted in main.go");
  } else if (ctx.language === "ruby") {
    add("lib/middleware/request_logger.rb", LOGGER_RUBY);
    note("logger", "verified", "Rack request logger — wiring attempted in config/application.rb");
  } else if (ctx.language === "elixir") {
    add("lib/app_web/plugs/request_logger.ex", LOGGER_ELIXIR);
    note("logger", "verified", "Phoenix request logger plug — wiring attempted in endpoint.ex");
  } else if (ctx.language === "php") {
    if (phpFw === "symfony") {
      add("src/EventSubscriber/RequestLoggerSubscriber.php", LOGGER_SYMFONY);
      note("logger", "verified", "Symfony RequestLogger EventSubscriber — uses PSR logger");
    } else if (phpFw === "laravel") {
      add("app/Http/Middleware/RequestLogger.php", LOGGER_PHP);
      note(
        "logger",
        "verified",
        "Laravel request logger — wiring attempted in app/Http/Kernel.php",
      );
    } else {
      note(
        "logger",
        "warning",
        "Could not detect Laravel or Symfony — add request logging manually for your framework",
      );
    }
  } else if (ctx.language === "rust") {
    if (!fileMap.has("src/middleware.rs")) add("src/middleware.rs", rustMiddlewareSrc);
    note(
      "logger",
      "verified",
      rustFwHint === "actix"
        ? "Actix request logger — wiring attempted in src/main.rs"
        : "Axum request logger — wiring attempted in src/main.rs",
    );
  } else if (ctx.language === "csharp") {
    add("Middleware/RequestLoggerMiddleware.cs", LOGGER_CSHARP);
    note("logger", "verified", "ASP.NET request logger — wiring attempted in Program.cs");
  } else if (ctx.hasExpress) {
    add("src/lib/logger.ts", WINSTON_LOGGER);
    add("src/middleware/logging.ts", REQUEST_LOGGER_MIDDLEWARE);
    Object.assign(pkgMods.deps, { winston: "^3.14.0" });
  } else {
    add("src/lib/logger.ts", LOGGER_FETCH);
    note(
      "logger",
      "verified",
      "Structured JSON logger added — import { logger } from './lib/logger' and call logger.info/warn/error with optional data payload",
    );
  }
}

// Scoped to node (Express + fetch-runtime), Python, and Go — getToolApplicability's
// SCOPED_MIDDLEWARE_LANGUAGES gate keeps every other language from ever reaching this handler,
// reporting "Skipped" with a reason before dispatch instead.
export function handleCookieFlags(fx: FixCtx) {
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
  if (ctx.language === "python") {
    add("middleware/cookie_flags.py", COOKIE_FLAGS_PYTHON);
    note(
      "security-cookie-flags",
      "verified",
      "cookie_flags.py created — call register_flask_cookie_flags(app) or register_fastapi_cookie_flags(app)",
    );
  } else if (ctx.language === "go") {
    if (!fileMap.has("internal/middleware/middleware.go")) {
      add("internal/middleware/middleware.go", MIDDLEWARE_GO);
    }
    note(
      "security-cookie-flags",
      "verified",
      "Go cookie security middleware — wiring attempted in main.go",
    );
  } else if (ctx.hasExpress) {
    add("src/middleware/secure-cookies.ts", COOKIE_FLAGS_MIDDLEWARE_EXPRESS);
  } else {
    add("src/lib/secure-cookies.ts", SECURE_COOKIES_FETCH);
    note(
      "security-cookie-flags",
      "verified",
      "Cookie security util added — wrap your fetch Responses with withSecureCookies() in your server entry or route handlers",
    );
  }
}

export function handleHttpsRedirect(fx: FixCtx) {
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
  if (ctx.language === "python") {
    add("middleware/https_redirect.py", HTTPS_REDIRECT_PYTHON);
    note(
      "https-redirect",
      "verified",
      "https_redirect.py created — call register_flask_https_redirect(app) or register_fastapi_https_redirect(app)",
    );
  } else if (ctx.language === "go") {
    if (!fileMap.has("internal/middleware/middleware.go")) {
      add("internal/middleware/middleware.go", MIDDLEWARE_GO);
    }
    note(
      "https-redirect",
      "verified",
      "Go HTTPS redirect middleware — wiring attempted in main.go",
    );
  } else if (ctx.hasExpress) {
    add("src/middleware/https-redirect.ts", HTTPS_REDIRECT_MIDDLEWARE_EXPRESS);
  } else {
    add("src/lib/https-redirect.ts", HTTPS_REDIRECT_FETCH);
    note(
      "https-redirect",
      "verified",
      "HTTPS redirect helper added — call httpsRedirectResponse(request) at the start of your fetch handler and return its result when non-null",
    );
  }
}

/**
 * CSRF. Previously the only registered fix id with no generator at all: the scanner reported it
 * and the Security Hardening Pack included it, while `fix-executor/` produced nothing — no file, no
 * note — so the PR silently came back without it.
 *
 * Deliberately generates-but-does-not-wire. Enabling CSRF is a breaking change: every existing
 * non-GET request fails until the client echoes the token. Auto-wiring it would clear the finding
 * and break the user's app in the same PR, which is worse than the gap it closes. Django/Rails/
 * Laravel already ship CSRF — for those the fix is configuration, not a dependency, so they get
 * the exact setting to flip rather than a file.
 */
export function handleCsrf(fx: FixCtx) {
  const { ctx, add, note, pkgMods } = fx;

  if (ctx.language === "python") {
    note(
      "security-csrf",
      "warning",
      "Django ships CSRF protection — add 'django.middleware.csrf.CsrfViewMiddleware' to MIDDLEWARE " +
        "in settings.py and {% csrf_token %} to your forms. No dependency needed.",
    );
    return;
  }
  if (ctx.language === "ruby") {
    note(
      "security-csrf",
      "warning",
      "Rails ships CSRF protection — add `protect_from_forgery with: :exception` to " +
        "ApplicationController and ensure csrf_meta_tags is in your layout. No dependency needed.",
    );
    return;
  }
  if (ctx.language === "php") {
    note(
      "security-csrf",
      "warning",
      "Laravel ships CSRF protection — ensure VerifyCsrfToken is in the 'web' middleware group " +
        "and @csrf is in your forms. No dependency needed.",
    );
    return;
  }
  if (ctx.hasExpress) {
    add("src/middleware/csrf.ts", CSRF_MIDDLEWARE_EXPRESS);
    Object.assign(pkgMods.deps, { "csrf-csrf": "^3.1.0", "cookie-parser": "^1.4.7" });
    note(
      "security-csrf",
      "warning",
      "src/middleware/csrf.ts created — NOT wired in, because enabling CSRF breaks existing " +
        "clients until they send the token. To turn it on: set CSRF_SECRET, add " +
        "`import { applyCsrf } from './middleware/csrf'` and `applyCsrf(app)` after your session " +
        "middleware, then have the frontend GET /csrf-token and send it as the x-csrf-token header.",
    );
    return;
  }
  note(
    "security-csrf",
    "warning",
    `No automated CSRF fix for ${ctx.resolvedFramework} — add CSRF protection to state-changing ` +
      "cookie-authenticated routes manually.",
  );
}
