import type { NonJsManifests } from "./scanner-rules";

export type AuditorLanguage =
  | "node"
  | "python"
  | "java"
  | "go"
  | "ruby"
  | "php"
  | "rust"
  | "csharp"
  | "elixir"
  | "unknown";

const FRAMEWORK_TO_AUDITOR_LANG: Record<string, AuditorLanguage> = {
  Python: "python",
  Java: "java",
  Go: "go",
  Ruby: "ruby",
  PHP: "php",
  Rust: "rust",
  "C#": "csharp",
  Elixir: "elixir",
  Kotlin: "java",
};

export function auditorLanguageFromFramework(framework: string): AuditorLanguage {
  return FRAMEWORK_TO_AUDITOR_LANG[framework] ?? "node";
}

export function auditorSourceExt(language: AuditorLanguage): RegExp {
  switch (language) {
    case "python":
      return /\.py$/;
    case "java":
      return /\.java$/;
    case "go":
      return /\.go$/;
    case "ruby":
      return /\.rb$/;
    case "php":
      return /\.php$/;
    case "rust":
      return /\.rs$/;
    case "csharp":
      return /\.cs$/;
    case "elixir":
      return /\.exs?$/;
    default:
      return /\.(tsx?|jsx?|mts|mjs)$/;
  }
}

const ENV_PATTERNS: Record<AuditorLanguage, RegExp[]> = {
  node: [
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]]/g,
    /import\.meta\.env\.([A-Z0-9_]+)/g,
  ],
  python: [
    /os\.environ\[['"]([A-Z_][A-Z0-9_]*)['"]]/g,
    /os\.getenv\(['"]([A-Z_][A-Z0-9_]*)['"]/g,
    /os\.environ\.get\(['"]([A-Z_][A-Z0-9_]*)['"]/g,
  ],
  java: [/System\.getenv\(["']([A-Z_][A-Z0-9_]*)["']\)/g],
  go: [/os\.Getenv\(["']([A-Z_][A-Z0-9_]*)["']\)/g],
  ruby: [/ENV\[['"]([A-Z_][A-Z0-9_]*)['"]]/g, /ENV\.fetch\(['"]([A-Z_][A-Z0-9_]*)['"]/g],
  php: [/\$_ENV\[['"]([A-Z_][A-Z0-9_]*)['"]]/g, /getenv\(['"]([A-Z_][A-Z0-9_]*)['"]\)/g],
  rust: [/std::env::var\(["']([A-Z_][A-Z0-9_]*)["']\)/g, /env!\(["']([A-Z_][A-Z0-9_]*)["']\)/g],
  csharp: [
    /Environment\.GetEnvironmentVariable\(["']([A-Z_][A-Z0-9_]*)["']\)/g,
    /Configuration\[["']([A-Z_][A-Z0-9_]*)["']\]/g,
  ],
  elixir: [/System\.get_env\(["']([A-Z_][A-Z0-9_]*)["']\)/g],
  unknown: [
    /process\.env\.([A-Z_][A-Z0-9_]*)/g,
    /os\.getenv\(['"]([A-Z_][A-Z0-9_]*)['"]/g,
    /System\.getenv\(["']([A-Z_][A-Z0-9_]*)["']\)/g,
  ],
};

const SKIP_ENV = new Set([
  "NODE_ENV",
  "CI",
  "VERCEL",
  "RAILWAY_ENVIRONMENT",
  "PATH",
  "HOME",
  "USER",
  // Rails/Bundler scaffold vars — present in every `rails new` output (boot.rb, production.rb),
  // set by the platform, never app config. Confirmed against the real
  // gothinkster/rails-realworld-example-app, which was flagged solely for these.
  "BUNDLE_GEMFILE",
  "RAILS_ENV",
  "RACK_ENV",
  "RAILS_SERVE_STATIC_FILES",
  "RAILS_LOG_TO_STDOUT",
  "RAILS_MASTER_KEY",
  // Azure/telemetry toggles the app runs fine without — confirmed against the real
  // davidfowl/TodoApi, flagged solely for optional observability wiring.
  "APPLICATIONINSIGHTS_CONNECTION_STRING",
]);

// OpenTelemetry's env contract is a whole OTEL_* family of optional exporter/sampler toggles —
// platform-injected observability config, not "deploy fails silently" app config.
const SKIP_ENV_PREFIX_RE = /^OTEL_/;

export function extractEnvVars(content: string, language: AuditorLanguage): Set<string> {
  const used = new Set<string>();
  for (const re of ENV_PATTERNS[language]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) used.add(m[1]!);
  }
  return used;
}

export function undocumentedEnvVars(used: Set<string>, documented: Set<string>): string[] {
  return [...used].filter(
    (v) => !documented.has(v) && !SKIP_ENV.has(v) && !SKIP_ENV_PREFIX_RE.test(v),
  );
}

export function hasStripeDependency(
  deps: Record<string, string>,
  manifests?: NonJsManifests,
): boolean {
  if (deps["stripe"]) return true;
  const blob = [
    manifests?.requirements,
    manifests?.pyprojectToml,
    manifests?.pomXml,
    manifests?.buildGradle,
    manifests?.goMod,
    manifests?.gemfile,
    manifests?.composerJson,
    manifests?.mixExs,
  ]
    .filter(Boolean)
    .join("\n");
  return /\bstripe\b/i.test(blob);
}

// wtforms/FlaskForm flow (validate_on_submit) was in checkedFor but missing from the regex —
// confirmed against the real miguelgrinberg/microblog, whose form-validated route files were
// invisible while its 3-line Blueprint declaration stubs counted as "unvalidated routes".
export const PY_VALIDATION_RE =
  /pydantic|BaseModel|Field\(|@validator|model_validator|marshmallow|cerberus|schema\.|validate_on_submit|FlaskForm|wtforms/i;
// `@\w+\.route(` covers Flask's standard decorator on both app and blueprints (@app.route,
// @bp.route) — 27 real routes in microblog matched nothing here before.
export const PY_ROUTE_RE =
  /@app\.(get|post|put|patch|delete)|@router\.(get|post|put|patch|delete)|@\w+\.route\s*\(|APIRouter|Blueprint|add_url_rule/i;
/** A Python route file that never reads request input has nothing to validate — same rule the
 * Express branch already applies (confirmed there against w3cj/express-api-starter-ts). */
export const PY_INPUT_RE =
  /request\.(get_json|json|form|args|values|data|POST|GET|body)|await\s+request\./;

export const JAVA_VALIDATION_RE =
  /@Valid|@Validated|jakarta\.validation|javax\.validation|Bean Validation|@NotNull|@NotBlank/i;
export const JAVA_ROUTE_RE =
  /@(Get|Post|Put|Patch|Delete|Request)Mapping|@RestController|@Controller/;
/** Structured request payload — a controller deserializing a body without validation is
 * individually a red flag (confirmed true positive: java-app's HotelController). */
export const JAVA_BODY_RE = /@RequestBody/;
/** Any request input at all — controllers reading none (spring-petclinic's Welcome/Crash
 * controllers) have nothing to validate and must not count toward the threshold. */
export const JAVA_INPUT_RE =
  /@RequestBody|@RequestParam|@PathVariable|@ModelAttribute|HttpServletRequest/;

export const PY_STRIPE_VERIFY_RE =
  /construct_event|Webhook\.construct_event|stripe\.Webhook\.construct_event/i;
export const JAVA_STRIPE_VERIFY_RE = /Webhook\.constructEvent|constructEvent/i;

export const GO_ROUTE_RE =
  /http\.HandleFunc|HandleFunc\(|\.Get\(|\.Post\(|\.Put\(|\.Delete\(|chi\.NewRouter|gin\.Default|gin\.New|echo\.New|fiber\.New/i;
// `validation\.Validate` also covers ozzo-validation's `validation.ValidateStruct(...)` —
// confirmed missing against a real repo (qiangxue/go-rest-api) that validates everything with
// ozzo yet matched nothing here.
export const GO_VALIDATION_RE =
  /validator\.Validate|binding:|validate\.Struct|go-playground\/validator|validation\.Validate|ozzo-validation/i;

export const PHP_ROUTE_RE =
  /Route::(get|post|put|patch|delete)|#\[Route|@Route|->get\(|->post\(|Router::/i;
// createForm/handleRequest/isValid is Symfony's standard form-validation flow — the constraints
// live on the entity/FormType classes, not in the controller, so controllers using it looked
// "unvalidated" (confirmed against the real symfony/demo: 3 of its 4 flagged controllers were
// textbook form-validated).
export const PHP_VALIDATION_RE =
  /validate\(|Request::validate|Assert\\|Symfony\\Component\\Validator|FormType|createForm\(|handleRequest\(|isValid\(/i;

export const RUBY_ROUTE_RE =
  /(get|post|put|patch|delete)\s+['"]|resources\s+|namespace\s+:api|Rails\.application\.routes/i;
export const RUBY_VALIDATION_RE =
  /strong_parameters|permit\(|params\.require|dry-validation|ActiveModel::Validations/i;

export const RUST_ROUTE_RE =
  /#\[(get|post|put|delete|patch)\(|\.route\(|Router::new|web::resource|axum::routing/i;
export const RUST_VALIDATION_RE = /validator::|Validate\b|serde::Deserialize|garde::|validify::/i;

export const CSHARP_ROUTE_RE =
  /\[Http(Get|Post|Put|Delete|Patch)\]|MapGet\(|MapPost\(|ControllerBase|ApiController/i;
// WithParameterValidation/MiniValidation is the standard minimal-API validation filter
// (endpoint groups validate DataAnnotations-attributed models declared in separate files) —
// confirmed against the real davidfowl/TodoApi, whose validated route groups were flagged.
export const CSHARP_VALIDATION_RE =
  /\[Required\]|\[Range\(|\[StringLength\(|FluentValidation|ModelState\.IsValid|DataAnnotations|WithParameterValidation|MiniValidation/i;

export const ELIXIR_ROUTE_RE =
  /get\s+"|post\s+"|put\s+"|patch\s+"|delete\s+"|scope\s+"|pipe_through|resources\s+/i;
export const ELIXIR_VALIDATION_RE =
  /Ecto\.Changeset|cast\(|validate_required|validate_change|embedded_schema/i;

export const JAVA_AUTH_RE =
  /@PreAuthorize|@Secured|SecurityFilterChain|authenticate\(|authorizeHttpRequests/i;
export const PHP_AUTH_RE = /auth\(|Auth::|IsGranted|Security::|middleware\(['"]auth/i;
export const GO_AUTH_RE = /jwt\.|auth\.Middleware|RequireAuth|authorized\(|BearerToken/i;
export const RUBY_AUTH_RE =
  /before_action\s+:authenticate|devise_for|warden|authorize!|current_user|authenticate_or_request/i;
export const RUST_AUTH_RE =
  /jwt_auth|auth_middleware|require_auth|Bearer|axum_login|tower_http::auth/i;
export const CSHARP_AUTH_RE =
  /\[Authorize\]|AddAuthentication|UseAuthentication|RequireAuthorization|IAuthorizationService/i;
export const ELIXIR_AUTH_RE =
  /plug\s+:require_authenticated|pow_|guardian|ueberauth|on_mount\s+:ensure_authenticated/i;

export function isBackendApiRepo(
  language: AuditorLanguage,
  files: string[],
  manifests?: NonJsManifests,
): boolean {
  if (language === "python") {
    const blob = [manifests?.requirements, manifests?.pyprojectToml].filter(Boolean).join("\n");
    return (
      /fastapi|flask|django/i.test(blob) ||
      files.some((f) => /^(main|app)\.py$/.test(f) || f.includes("/routes/") || f.includes("/api/"))
    );
  }
  if (language === "java") {
    const blob = [manifests?.pomXml, manifests?.buildGradle].filter(Boolean).join("\n");
    return (
      /spring-boot|springframework/i.test(blob) ||
      files.some((f) => /Controller\.java$/.test(f) || f.includes("/controller/"))
    );
  }
  if (language === "csharp") {
    return files.some((f) => /Program\.cs$/.test(f) || f.endsWith(".csproj"));
  }
  if (language === "go") {
    return files.some(
      (f) => /\.go$/.test(f) && (f.includes("/cmd/") || f === "main.go" || f.endsWith("/main.go")),
    );
  }
  if (language === "php") {
    const blob = manifests?.composerJson ?? "";
    return (
      /laravel\/framework|symfony\//i.test(blob) ||
      files.some((f) => /artisan$|routes\/web\.php|config\/routes\.yaml/.test(f))
    );
  }
  if (language === "ruby") {
    return files.some((f) => /config\/routes\.rb|app\/controllers\//.test(f));
  }
  if (language === "rust") {
    return files.some((f) => f === "src/main.rs" || f.startsWith("src/bin/"));
  }
  if (language === "elixir") {
    return files.some((f) => /_web\/(endpoint|router)\.ex$/.test(f) || f === "mix.exs");
  }
  return false;
}
