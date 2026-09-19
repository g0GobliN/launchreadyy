import type { IssueInput, NonJsManifests } from "../../scanner-rules";

export function checkNonJsSecurityMiddleware(
  language: string,
  files: string[],
  manifests: NonJsManifests,
  issues: IssueInput[],
  fileContents?: Record<string, string>,
) {
  if (
    language !== "python" &&
    language !== "java" &&
    language !== "go" &&
    language !== "ruby" &&
    language !== "php" &&
    language !== "rust" &&
    language !== "csharp" &&
    language !== "c#" &&
    language !== "elixir"
  )
    return;

  const hasApi =
    language === "python"
      ? /fastapi|flask|django/i.test(
          [manifests.requirements, manifests.pyprojectToml].filter(Boolean).join("\n"),
        ) ||
        files.some(
          (f) => /^(main|app)\.py$/.test(f) || f.includes("/routes/") || f.includes("/api/"),
        )
      : language === "java"
        ? /spring-boot|springframework/i.test(
            [manifests.pomXml, manifests.buildGradle].filter(Boolean).join("\n"),
          ) || files.some((f) => /Controller\.java$/.test(f))
        : language === "go"
          ? files.some((f) => /\.go$/.test(f) && (f.includes("/cmd/") || f === "main.go"))
          : language === "php"
            ? files.some((f) => /artisan$|routes\/web\.php|app\/Http\/Kernel\.php/.test(f))
            : language === "rust"
              ? files.some((f) => f === "src/main.rs" || f.startsWith("src/bin/"))
              : language === "csharp" || language === "c#"
                ? files.some((f) => /Program\.cs$/.test(f) || f.endsWith(".csproj"))
                : language === "elixir"
                  ? files.some((f) => /_web\/endpoint\.ex$|_web\/router\.ex$/.test(f))
                  : files.some((f) =>
                      /config\/application\.rb|config\/routes\.rb|app\/controllers\//.test(f),
                    );

  if (!hasApi) return;

  // Content-based detection: join all available source file contents so we search
  // actual code rather than just filenames (filename-only checks produce false positives
  // when CORS/security is configured inline in a generic file like main.go or app.py).
  const allContent = fileContents ? Object.values(fileContents).join("\n") : files.join("\n");

  const SECURITY_HEADERS_RE: Record<string, RegExp> = {
    python:
      /talisman|flask_talisman|secure_headers|SecurityMiddleware|CSP_|content.security.policy/i,
    java: /SecurityHeadersWriter|X-Content-Type-Options|X-Frame-Options|addHeader.*X-|http\.headers/i,
    go: /SecurityHeaders|X-Content-Type-Options|X-Frame-Options|SecureMiddleware|negroni-secure/i,
    php: /SecurityHeaders|X-Frame-Options|X-Content-Type-Options|SecureHeader/i,
    rust: /security_headers|X-Frame-Options|X-Content-Type-Options|tower_http::set_header/i,
    csharp: /UseSecurityHeaders|X-Frame-Options|X-Content-Type-Options|AddSecurityHeaders/i,
    elixir: /put_resp_header.*x-frame|put_resp_header.*x-content|SecurityHeaders|Plugs\.Security/i,
    ruby: /SecurityHeaders|X-Frame-Options|X-Content-Type-Options|rack.protection|secure_headers/i,
  };
  const hasSecurityHeaders = SECURITY_HEADERS_RE[language]?.test(allContent) ?? false;
  if (!hasSecurityHeaders) {
    issues.push({
      category: "Security",
      title: "No security headers middleware",
      severity: "medium",
      why: "API responses should set X-Content-Type-Options, X-Frame-Options, and related headers to reduce XSS and clickjacking risk.",
      timeSaved: "30m",
      fixId: "helmet",
      checkedFor: [
        "flask-talisman / django SecurityMiddleware",
        "SecurityHeadersFilter (Java/C#)",
        "X-Frame-Options / X-Content-Type-Options headers in source",
        "up to ~40 sampled source files (not the full repo tree)",
      ],
      foundEvidence:
        "No security-headers middleware or header-setting helpers matched in sampled sources.",
      confidence: "medium",
      recommendedFix:
        "Enable framework security-header middleware (Helmet, Talisman, SecurityMiddleware, etc.) in production.",
    });
  }

  const CORS_RE: Record<string, RegExp> = {
    python: /CORSMiddleware|flask.cors|django.cors|cors\b|Access-Control-Allow-Origin/i,
    java: /CorsConfiguration|@CrossOrigin|WebMvcConfigurer.*cors|CorsFilter|addCorsMappings/i,
    go: /cors\.|AllowOrigins|AllowedOrigins|Access-Control-Allow-Origin|rs\/cors|gin.CORS/i,
    php: /CorsMiddleware|HandleCors|Access-Control-Allow-Origin|fruitcake\/cors/i,
    rust: /CorsLayer|cors\(\)|AllowOrigin|tower_http::cors/i,
    csharp: /UseCors|AddCors|AllowAnyOrigin|WithOrigins|CorsPolicy/i,
    elixir: /Corsica|cors_plug|access-control-allow-origin/i,
    ruby: /rack.cors|Cors::Middleware|allow\.origin|access.control.allow/i,
  };
  const hasCors = CORS_RE[language]?.test(allContent) ?? false;
  if (!hasCors) {
    issues.push({
      category: "Security",
      title: "No CORS configuration",
      severity: "medium",
      why: "Browser clients need explicit CORS rules. Without them, frontends on another origin cannot call your API in production.",
      timeSaved: "20m",
      fixId: "cors",
      checkedFor: [
        "CORSMiddleware",
        "flask-cors",
        "CorsConfiguration",
        "@CrossOrigin",
        "UseCors",
        "up to ~40 sampled source files (not the full repo tree)",
      ],
      foundEvidence:
        "No CORS middleware or Access-Control configuration matched in sampled sources.",
      confidence: "medium",
      recommendedFix: "Configure an explicit CORS allowlist for production origins.",
    });
  }

  const RATE_LIMIT_RE: Record<string, RegExp> = {
    python: /slowapi|Limiter|flask.limiter|RateLimiter|rate.limit/i,
    java: /RateLimiter|Bucket4j|RateLimit|ResilienceRateLimit/i,
    go: /rate\.Limiter|limiter\.|ratelimit|golang\.org\/x\/time\/rate|tollbooth|ulule\/limiter/i,
    php: /RateLimiter|RateLimitMiddleware|throttle|Throttle/i,
    rust: /RateLimiter|rate_limit|governor::|leaky_bucket/i,
    csharp: /RateLimiter|AddRateLimiter|FixedWindowRateLimiter|UseRateLimiter/i,
    elixir: /Hammer\.|ExRated\.|rate_limit|PlugAttack/i,
    ruby: /Rack::Attack|throttle|RateLimit/i,
  };
  const hasRateLimit = RATE_LIMIT_RE[language]?.test(allContent) ?? false;
  if (!hasRateLimit) {
    issues.push({
      category: "Security",
      title: "No API rate limiting",
      severity: "high",
      why: "Public endpoints without rate limits are vulnerable to abuse, credential stuffing, and runaway cloud bills.",
      timeSaved: "45m",
      fixId: "rate-limit",
      checkedFor: [
        "slowapi/Limiter (Python)",
        "Bucket4j (Java)",
        "rate.Limiter (Go)",
        "Rack::Attack (Ruby)",
        "up to ~40 sampled source files (not the full repo tree)",
      ],
      foundEvidence: "No rate-limiting middleware matched in sampled sources or manifests.",
      confidence: "medium",
      recommendedFix: "Add request rate limiting on public auth and API endpoints.",
    });
  }
}
