import type { IssueInput, NonJsManifests } from "../scanner-rules";
import {
  auditorLanguageFromFramework,
  auditorSourceExt,
  extractEnvVars,
  hasStripeDependency,
  isBackendApiRepo,
  JAVA_ROUTE_RE,
  JAVA_VALIDATION_RE,
  JAVA_BODY_RE,
  JAVA_INPUT_RE,
  JAVA_AUTH_RE,
  GO_ROUTE_RE,
  GO_VALIDATION_RE,
  GO_AUTH_RE,
  PHP_ROUTE_RE,
  PHP_VALIDATION_RE,
  PHP_AUTH_RE,
  RUBY_ROUTE_RE,
  RUBY_VALIDATION_RE,
  RUST_ROUTE_RE,
  RUST_VALIDATION_RE,
  CSHARP_ROUTE_RE,
  CSHARP_VALIDATION_RE,
  ELIXIR_ROUTE_RE,
  ELIXIR_VALIDATION_RE,
  RUBY_AUTH_RE,
  RUST_AUTH_RE,
  CSHARP_AUTH_RE,
  ELIXIR_AUTH_RE,
  PY_ROUTE_RE,
  PY_VALIDATION_RE,
  PY_INPUT_RE,
  type AuditorLanguage,
  undocumentedEnvVars,
} from "../auditor-lang.server";
import {
  findStripeWebhookTarget,
  STRIPE_VERIFY_RE,
  STRIPE_WEBHOOK_RE,
} from "../stripe-webhook-fix.server";
// Only matches markers that appear inside a comment line (// # *) or as a throw/raise.
// This avoids false-positives from JSX attributes like placeholder="..." or
// prop names like notImplemented that are not actionable development markers.
const TODO_RE = /\b(TODO|FIXME|HACK|XXX|PLACEHOLDER|not implemented|coming soon)\b/i;
const TODO_LINE_RE =
  /^\s*(?:\/\/|#|\*|\/\*).*\b(TODO|FIXME|HACK|XXX|PLACEHOLDER|not\s+implemented|coming\s+soon)\b/i;
const ENV_VAR_RE = /process\.env\.([A-Z][A-Z0-9_]*)/g;
const NEXT_PUBLIC_RE = /process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g;
const VITE_ENV_RE = /import\.meta\.env\.([A-Z0-9_]+)/g;
const AUTH_GUARD_RE =
  /getServerSession|auth\(|requireAuth|isAuthenticated|clerkMiddleware|withAuth|protectedRoute/;
const VALIDATION_RE =
  /zod|yup|joi|celebrate|express-validator|valibot|superstruct|safeParse|parseAsync/;

export interface AuditorContext {
  files: string[];
  fileContents: Record<string, string>;
  envExampleContent: string | null;
  deps: Record<string, string>;
  framework: string;
  language?: AuditorLanguage;
  manifests?: NonJsManifests;
}

function auditorIssue(partial: Omit<IssueInput, "timeSaved"> & { timeSaved?: string }): IssueInput {
  return { timeSaved: "2h", ...partial };
}

// A hardcoded localhost API reference in JS/TS frontend code. Three shapes:
// fetch("http://localhost…"), axios.get/post/…("http://localhost…"), and an axios-style
// `baseURL: "http://localhost…"` client config. The baseURL shape only counts when the line is
// an unconditional literal — an env-var-with-localhost-fallback (`process.env.X ||
// "http://localhost:5000"`) is a reasonable dev default, not a launch blocker (confirmed
// against the real rmiyazaki6499/mern-app, which uses exactly that pattern and should not
// fire, vs bezkoder/react-axios-example's unconditional literal, which should).
const NODE_LOCALHOST_CALL_RE =
  /(?:fetch|axios\s*\.\s*(?:get|post|put|patch|delete))\s*\(\s*['"`]https?:\/\/localhost/;
const BASE_URL_LOCALHOST_RE = /baseURL\s*:\s*['"`]https?:\/\/localhost/;

function nodeLocalhostCall(content: string): boolean {
  if (NODE_LOCALHOST_CALL_RE.test(content)) return true;
  return content
    .split("\n")
    .some(
      (line) =>
        BASE_URL_LOCALHOST_RE.test(line) && !/process\.env|import\.meta\.env|\|\|/.test(line),
    );
}

// Test files across each language's own naming convention, not just the JS ones — confirmed
// against real repos that sampling only by JS conventions let `internal/test/*.go` helpers count
// as route files and a `src/test/java/*Test.java` file push todo-markers over its threshold.
// `\.Tests?\/` and `Tests?\.cs$` cover the .NET convention (<Project>.Tests/ dirs, *Tests.cs
// files) — confirmed against the real davidfowl/TodoApi, whose Todo.Api.Tests files were sampled
// as source. EF Core `Migrations/` output is generated code, never routes or app logic — its
// auto-named files (e.g. RemoveIsAdmin.cs) matched the auth check's admin-path heuristic.
const TEST_FILE_RE =
  /(^|\/)(tests?|spec|__tests__)\/|\.test\.|\.spec\.|_test\.(go|py|rb|ex|exs)$|_spec\.rb$|(^|\/)test_[^/]*\.py$|(^|\/)src\/test\/|\.Tests?\/|Tests?\.cs$|(^|\/)Migrations\//;

function sampleSourcePaths(files: string[], language: AuditorLanguage, max = 40): string[] {
  const ext = auditorSourceExt(language);
  const scored = files
    .filter((f) => ext.test(f) && !f.includes("node_modules") && !f.endsWith(".d.ts"))
    .filter((f) => !TEST_FILE_RE.test(f))
    .sort((a, b) => {
      const pri = (p: string) =>
        (p.includes("api/") || p.includes("routes/") || p.includes("webhook") ? 0 : 1) +
        (p.includes("pages/") || p.includes("app/") ? 0 : 2);
      return pri(a) - pri(b);
    });
  return scored.slice(0, max);
}

export function runAuditor(ctx: AuditorContext): IssueInput[] {
  const issues: IssueInput[] = [];
  const language = ctx.language ?? auditorLanguageFromFramework(ctx.framework);
  const paths = sampleSourcePaths(ctx.files, language);

  // ── TODO / placeholder logic ───────────────────────────────────────────────
  const todoHits: string[] = [];
  for (const p of paths) {
    const content = ctx.fileContents[p];
    if (!content || !TODO_RE.test(content)) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (TODO_LINE_RE.test(lines[i]!) && !lines[i]!.trim().startsWith("// eslint")) {
        todoHits.push(`${p}:${i + 1}`);
        break;
      }
    }
  }
  if (todoHits.length >= 3) {
    issues.push(
      auditorIssue({
        category: "Maintainability",
        title: `Incomplete implementation markers (${todoHits.length} files)`,
        severity: "medium",
        why: `Found TODO/FIXME/placeholder comments in ${todoHits.slice(0, 3).join(", ")}${todoHits.length > 3 ? "…" : ""}. These often ship to production unfinished.`,
        fixId: "auditor-todo-markers",
        timeSaved: "4h",
        checkedFor: ["TODO comments", "FIXME markers", "placeholder/hack comments in source files"],
        foundEvidence: `Found in: ${todoHits.slice(0, 3).join(", ")}${todoHits.length > 3 ? "…" : ""}`,
      }),
    );
  }

  // ── Env vars used but not documented ───────────────────────────────────────
  const usedEnv = new Set<string>();
  for (const p of paths) {
    const content = ctx.fileContents[p];
    if (!content) continue;
    if (language === "node") {
      for (const re of [ENV_VAR_RE, NEXT_PUBLIC_RE, VITE_ENV_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) usedEnv.add(m[1]!);
      }
    } else {
      for (const v of extractEnvVars(content, language)) usedEnv.add(v);
    }
  }
  const documented = new Set<string>();
  if (ctx.envExampleContent) {
    for (const line of ctx.envExampleContent.split("\n")) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=/);
      if (m) documented.add(m[1]!);
    }
  }
  const missingEnv = undocumentedEnvVars(usedEnv, documented);
  if (missingEnv.length >= 2 && !ctx.files.includes(".env.example")) {
    issues.push(
      auditorIssue({
        category: "Environment setup",
        title: "Env vars used in code but not documented",
        severity: "high",
        why: `Code references ${missingEnv.slice(0, 4).join(", ")}${missingEnv.length > 4 ? "…" : ""} but .env.example is missing or incomplete. Deploy will fail silently.`,
        fixId: "auditor-env-undocumented",
        timeSaved: "1h",
        checkedFor: [
          ".env.example",
          ".env.sample",
          ".env.template",
          "process.env references in source",
        ],
        // Without this, the evidence line falls back to "None found" — actively wrong
        // for a finding that fired because specific vars WERE found undocumented.
        foundEvidence: `Referenced in code but missing from .env.example: ${missingEnv.join(", ")}.`,
      }),
    );
  } else if (missingEnv.length >= 3 && ctx.envExampleContent) {
    issues.push(
      auditorIssue({
        category: "Environment setup",
        title: "Undocumented env vars in active code paths",
        severity: "medium",
        why: `${missingEnv.slice(0, 4).join(", ")} used in code but absent from .env.example.`,
        fixId: "auditor-env-gap",
        timeSaved: "30m",
        checkedFor: [".env.example keys", "env var references in active code paths"],
        foundEvidence: `Referenced in code but missing from .env.example: ${missingEnv.join(", ")}.`,
      }),
    );
  }

  // ── Stripe webhook safety ──────────────────────────────────────────────────
  if (hasStripeDependency(ctx.deps, ctx.manifests)) {
    const centralHandlers = ["server.ts", "server.js", "src/server.ts", "src/server.js"];
    const hasCentralVerification = centralHandlers.some((p) => {
      const c = ctx.fileContents[p];
      return c && STRIPE_WEBHOOK_RE.test(c) && STRIPE_VERIFY_RE.test(c);
    });
    // Repo-level, not per-file: layered apps register the webhook in one file and verify in
    // another (confirmed against the real ruffrey/stripe-webhook-server — server.js does
    // app.post(webhookEndpointPath, routes.webhookHandler) while routes/index.js does the
    // events.retrieve verification). Same granularity fix as the Go validation check.
    const hasVerificationAnywhere = paths.some((p) =>
      STRIPE_VERIFY_RE.test(ctx.fileContents[p] ?? ""),
    );
    if (hasCentralVerification || hasVerificationAnywhere) {
      // Webhook verified somewhere in the repo — skip per-route flags.
    } else {
      const target = findStripeWebhookTarget(paths, (p) => ctx.fileContents[p] ?? null);
      if (target) {
        issues.push(
          auditorIssue({
            category: "Security",
            title: "Stripe webhook may not verify signatures",
            severity: "high",
            why: `Route ${target} handles Stripe webhooks but no constructEvent/signature verification detected. Fake payment events could activate paid plans without real payment.`,
            fixId: "auditor-stripe-webhook",
            timeSaved: "3h",
            checkedFor: [
              "constructEvent() calls",
              "stripe-signature header checks",
              "STRIPE_WEBHOOK_SECRET env usage",
              "up to ~40 sampled source files (not the full repo tree)",
            ],
            foundEvidence: `Webhook handler at ${target} with no constructEvent/signature verification in the sampled files.`,
            confidence: "medium",
            recommendedFix:
              "Verify Stripe signatures with constructEvent (or equivalent) before trusting event payloads.",
          }),
        );
      }
    }
  }

  // ── Python API routes without validation ───────────────────────────────────
  if (language === "python" && isBackendApiRepo(language, ctx.files, ctx.manifests)) {
    const routeFiles = paths.filter(
      (p) =>
        PY_ROUTE_RE.test(ctx.fileContents[p] ?? "") ||
        /^(main|app)\.py$/.test(p) ||
        p.includes("/routes/") ||
        p.includes("/api/"),
    );
    let unvalidated = 0;
    for (const p of routeFiles.slice(0, 15)) {
      const content = ctx.fileContents[p];
      if (!content || !PY_ROUTE_RE.test(content)) continue;
      // A route file that never reads request input has nothing to validate — confirmed against
      // the real miguelgrinberg/microblog, whose Blueprint declaration stubs (3 lines, no routes,
      // no input) counted as "unvalidated routes" while its real form-validated route files were
      // invisible to the old PY_ROUTE_RE.
      if (!PY_INPUT_RE.test(content)) continue;
      if (PY_VALIDATION_RE.test(content)) continue;
      unvalidated++;
    }
    if (unvalidated >= 2) {
      issues.push(
        auditorIssue({
          category: "API reliability",
          title: "API routes without input validation",
          severity: "high",
          why: `${unvalidated} Python route files accept requests without Pydantic or similar validation. Bad input can crash handlers or corrupt data.`,
          fixId: "auditor-api-validation",
          timeSaved: "2h",
          checkedFor: ["Pydantic BaseModel usage", "marshmallow schemas", "wtforms validation"],
          foundEvidence: `${unvalidated} of up to 15 sampled route files read request input with no validation call matched.`,
        }),
      );
    }
  }

  // ── Java API routes without validation ─────────────────────────────────────
  if (language === "java" && isBackendApiRepo(language, ctx.files, ctx.manifests)) {
    const routeFiles = paths.filter(
      (p) => JAVA_ROUTE_RE.test(ctx.fileContents[p] ?? "") || /Controller\.java$/.test(p),
    );
    // Two-tier rule, confirmed against real repos in both directions: a controller
    // deserializing a structured @RequestBody without validation is individually a red flag
    // (java-app's HotelController — hand-verified true positive), while controllers reading no
    // input at all (spring-petclinic's Welcome/Crash controllers) have nothing to validate and
    // must not count toward the threshold. Param-only readers (petclinic's VetController, one
    // auto-converted int) still need company (>=2) before flagging.
    let bodyUnvalidated = 0;
    let paramUnvalidated = 0;
    for (const p of routeFiles.slice(0, 15)) {
      const content = ctx.fileContents[p];
      if (!content || !JAVA_ROUTE_RE.test(content)) continue;
      if (!JAVA_INPUT_RE.test(content)) continue;
      if (JAVA_VALIDATION_RE.test(content)) continue;
      if (JAVA_BODY_RE.test(content)) bodyUnvalidated++;
      else paramUnvalidated++;
    }
    const unvalidated = bodyUnvalidated + paramUnvalidated;
    if (bodyUnvalidated >= 1 || paramUnvalidated >= 2) {
      issues.push(
        auditorIssue({
          category: "API reliability",
          title: "API routes without input validation",
          severity: "high",
          why: `${unvalidated} Java controller files accept requests without @Valid or Bean Validation. Bad input can crash handlers or corrupt data.`,
          fixId: "auditor-api-validation",
          timeSaved: "2h",
          checkedFor: ["@Valid annotations", "@NotNull/@Size constraints", "BindingResult checks"],
          foundEvidence: `${unvalidated} of up to 15 sampled controller files read request input with no validation matched.`,
        }),
      );
    }
  }

  // ── Go / PHP / Ruby / Rust / C# API validation ─────────────────────────────
  const langValidation: Array<{
    lang: AuditorLanguage;
    routeRe: RegExp;
    validationRe: RegExp;
    filter: (p: string) => boolean;
    label: string;
    /** Skip the flag when validation appears anywhere in the sampled files, not just in the
     * same file as the routes — for languages whose standard layout separates the two. */
    repoLevel?: boolean;
  }> = [
    {
      lang: "go",
      routeRe: GO_ROUTE_RE,
      validationRe: GO_VALIDATION_RE,
      filter: (p) => p.endsWith(".go"),
      label: "Go handler",
      // Go's standard layered layout registers routes in api.go and validates in service.go —
      // confirmed against a real repo (qiangxue/go-rest-api): every input validated via ozzo,
      // yet zero route-registering files contain validation themselves. Per-file co-occurrence
      // is structurally the wrong granularity for Go; presence anywhere in the repo is the signal.
      repoLevel: true,
    },
    {
      lang: "php",
      routeRe: PHP_ROUTE_RE,
      validationRe: PHP_VALIDATION_RE,
      filter: (p) => p.endsWith(".php"),
      label: "PHP route",
    },
    {
      lang: "ruby",
      routeRe: RUBY_ROUTE_RE,
      validationRe: RUBY_VALIDATION_RE,
      filter: (p) => p.endsWith(".rb"),
      label: "Ruby route",
    },
    {
      lang: "rust",
      routeRe: RUST_ROUTE_RE,
      validationRe: RUST_VALIDATION_RE,
      filter: (p) => p.endsWith(".rs"),
      label: "Rust route",
    },
    {
      lang: "csharp",
      routeRe: CSHARP_ROUTE_RE,
      validationRe: CSHARP_VALIDATION_RE,
      filter: (p) => p.endsWith(".cs"),
      label: "C# endpoint",
    },
    {
      lang: "elixir",
      routeRe: ELIXIR_ROUTE_RE,
      validationRe: ELIXIR_VALIDATION_RE,
      filter: (p) => /\.exs?$/.test(p),
      label: "Elixir route",
    },
  ];
  for (const { lang, routeRe, validationRe, filter, label, repoLevel } of langValidation) {
    if (language !== lang || !isBackendApiRepo(language, ctx.files, ctx.manifests)) continue;
    const routeFiles = paths.filter(filter);
    if (repoLevel && routeFiles.some((p) => validationRe.test(ctx.fileContents[p] ?? ""))) {
      continue;
    }
    let unvalidated = 0;
    for (const p of routeFiles.slice(0, 15)) {
      const content = ctx.fileContents[p];
      if (!content || !routeRe.test(content)) continue;
      if (validationRe.test(content)) continue;
      unvalidated++;
    }
    if (unvalidated >= 2) {
      issues.push(
        auditorIssue({
          category: "API reliability",
          title: "API routes without input validation",
          severity: "high",
          why: `${unvalidated} ${label} files accept requests without validation. Bad input can crash handlers or corrupt data.`,
          fixId: "auditor-api-validation",
          timeSaved: "2h",
          checkedFor: [
            "request validation patterns",
            "input binding structs",
            "schema validation calls",
          ],
          foundEvidence: `${unvalidated} of up to 15 sampled ${label} files matched a route with no validation call.`,
        }),
      );
    }
  }

  // ── API routes without validation (Express) ────────────────────────────────
  if (language === "node" && (ctx.framework === "Express" || ctx.deps["express"])) {
    const routeFiles = paths.filter(
      (p) =>
        p.includes("/routes/") ||
        p.includes("/api/") ||
        p.endsWith("server.ts") ||
        p.endsWith("server.js"),
    );
    let unvalidated = 0;
    for (const p of routeFiles.slice(0, 15)) {
      const content = ctx.fileContents[p];
      if (!content) continue;
      if (!/(router\.|app\.(get|post|put|patch|delete)|RouteHandler)/.test(content)) continue;
      // A route file that never reads request input has nothing to validate — confirmed false
      // positive against a real repo (w3cj/express-api-starter-ts): two GET-only routers with
      // zero req.body/query/params reads were flagged as "accepting requests without validation".
      if (!/req\.(body|query|params)|request\.(body|query|params)/.test(content)) continue;
      if (VALIDATION_RE.test(content)) continue;
      unvalidated++;
    }
    if (unvalidated >= 2) {
      issues.push(
        auditorIssue({
          category: "API reliability",
          title: "API routes without input validation",
          severity: "high",
          why: `${unvalidated} route files accept requests without Zod/Joi/express-validator. Bad input can crash handlers or corrupt data.`,
          fixId: "auditor-api-validation",
          timeSaved: "2h",
          checkedFor: [
            "zod/joi/yup schemas",
            "express-validator middleware",
            "manual req.body type checks",
          ],
          foundEvidence: `${unvalidated} of up to 15 sampled route files read request input with no validation matched.`,
        }),
      );
    }
  }

  // ── Routes/pages without auth guard ────────────────────────────────────────
  if (ctx.framework === "Next.js" || ctx.deps["next"]) {
    // `(^|\/)` matters: repo-relative paths have no leading slash, so a bare
    // `includes("/app/")` never matched the standard root-level app/ layout (confirmed against
    // the real shadcn/taxonomy — its app/(dashboard)/dashboard pages were invisible to this
    // check), only the src/app/ variant.
    const protectedPaths = paths.filter(
      (p) =>
        (/(^|\/)app\//.test(p) &&
          (p.includes("/dashboard") || p.includes("/admin") || p.includes("/settings"))) ||
        /(^|\/)pages\/(dashboard|admin)/.test(p),
    );
    const hasAuthLib =
      ctx.deps["next-auth"] ||
      ctx.deps["@clerk/nextjs"] ||
      ctx.deps["@supabase/auth-helpers-nextjs"] ||
      ctx.files.some((f) => f.includes("middleware.ts"));
    if (hasAuthLib && protectedPaths.length > 0) {
      let unguarded = 0;
      for (const p of protectedPaths.slice(0, 8)) {
        const content = ctx.fileContents[p];
        if (!content) continue;
        if (AUTH_GUARD_RE.test(content)) continue;
        if (ctx.files.some((f) => f === "middleware.ts" || f === "src/middleware.ts")) {
          const mw = ctx.fileContents["middleware.ts"] ?? ctx.fileContents["src/middleware.ts"];
          if (mw && /matcher|dashboard|admin/.test(mw)) continue;
        }
        unguarded++;
      }
      if (unguarded >= 1) {
        issues.push(
          auditorIssue({
            category: "Security",
            title: "Protected pages may lack auth checks",
            severity: "high",
            why: `Dashboard/admin routes detected without session or middleware guards. Unauthenticated users may access private data.`,
            fixId: "auditor-auth-routes",
            timeSaved: "2h",
            checkedFor: [
              "middleware.ts matchers",
              "getServerSession calls",
              "auth() in page components",
              "redirect on unauthenticated",
            ],
            foundEvidence: `${unguarded} of ${protectedPaths.length} sampled dashboard/admin/settings pages had no session or middleware guard matched.`,
            confidence: "medium",
            recommendedFix:
              "Add session/middleware auth guards on dashboard, admin, and settings routes before launch.",
          }),
        );
      }
    }
  }

  // ── Java / PHP / Go protected routes without auth ──────────────────────────
  if (language === "java" && isBackendApiRepo(language, ctx.files, ctx.manifests)) {
    const protectedFiles = paths.filter(
      (p) => /Controller\.java$/.test(p) && /admin|dashboard|settings|account/i.test(p),
    );
    if (protectedFiles.length > 0) {
      const unguarded = protectedFiles.filter((p) => !JAVA_AUTH_RE.test(ctx.fileContents[p] ?? ""));
      if (unguarded.length >= 1) {
        issues.push(
          auditorIssue({
            category: "Security",
            title: "Protected API routes may lack auth checks",
            severity: "high",
            why: `Admin/dashboard controllers detected without Spring Security annotations or filters.`,
            fixId: "auditor-auth-routes",
            timeSaved: "2h",
            checkedFor: [
              "@PreAuthorize annotations",
              "@Secured annotations",
              "Spring Security filter chain",
            ],
            foundEvidence: `No auth annotation/filter matched in: ${unguarded.slice(0, 4).join(", ")}${unguarded.length > 4 ? "…" : ""}.`,
            confidence: "medium",
            recommendedFix:
              "Add session/middleware auth guards on dashboard, admin, and settings routes before launch.",
          }),
        );
      }
    }
  }
  if (language === "php" && isBackendApiRepo(language, ctx.files, ctx.manifests)) {
    const protectedFiles = paths.filter(
      (p) =>
        p.endsWith(".php") &&
        /admin|dashboard|settings/i.test(p) &&
        PHP_ROUTE_RE.test(ctx.fileContents[p] ?? ""),
    );
    if (protectedFiles.length > 0) {
      const unguarded = protectedFiles.filter((p) => !PHP_AUTH_RE.test(ctx.fileContents[p] ?? ""));
      if (unguarded.length >= 1) {
        issues.push(
          auditorIssue({
            category: "Security",
            title: "Protected routes may lack auth checks",
            severity: "high",
            why: `Admin/dashboard PHP routes detected without auth middleware or guards.`,
            fixId: "auditor-auth-routes",
            timeSaved: "2h",
            checkedFor: [
              "auth middleware group",
              "Auth::check() calls",
              "Laravel/Symfony auth guards",
            ],
            foundEvidence: `No auth middleware/guard matched in: ${unguarded.slice(0, 4).join(", ")}${unguarded.length > 4 ? "…" : ""}.`,
            confidence: "medium",
            recommendedFix:
              "Add session/middleware auth guards on dashboard, admin, and settings routes before launch.",
          }),
        );
      }
    }
  }
  if (language === "go" && isBackendApiRepo(language, ctx.files, ctx.manifests)) {
    const protectedFiles = paths.filter(
      (p) =>
        p.endsWith(".go") &&
        /admin|dashboard|settings/i.test(p) &&
        GO_ROUTE_RE.test(ctx.fileContents[p] ?? ""),
    );
    if (protectedFiles.length > 0) {
      const unguarded = protectedFiles.filter((p) => !GO_AUTH_RE.test(ctx.fileContents[p] ?? ""));
      if (unguarded.length >= 1) {
        issues.push(
          auditorIssue({
            category: "Security",
            title: "Protected routes may lack auth checks",
            severity: "high",
            why: `Admin/dashboard Go handlers detected without JWT or auth middleware.`,
            fixId: "auditor-auth-routes",
            timeSaved: "2h",
            checkedFor: [
              "JWT validation middleware",
              "auth context values",
              "token verification calls",
            ],
            foundEvidence: `No auth middleware/token check matched in: ${unguarded.slice(0, 4).join(", ")}${unguarded.length > 4 ? "…" : ""}.`,
            confidence: "medium",
            recommendedFix:
              "Add session/middleware auth guards on dashboard, admin, and settings routes before launch.",
          }),
        );
      }
    }
  }

  const authChecks: Array<{
    lang: AuditorLanguage;
    re: RegExp;
    routeRe: RegExp;
    filter: (p: string) => boolean;
    label: string;
  }> = [
    {
      lang: "ruby",
      re: RUBY_AUTH_RE,
      routeRe: RUBY_ROUTE_RE,
      filter: (p) => p.endsWith(".rb"),
      label: "Ruby",
    },
    {
      lang: "rust",
      re: RUST_AUTH_RE,
      routeRe: RUST_ROUTE_RE,
      filter: (p) => p.endsWith(".rs"),
      label: "Rust",
    },
    {
      lang: "csharp",
      re: CSHARP_AUTH_RE,
      routeRe: CSHARP_ROUTE_RE,
      filter: (p) => p.endsWith(".cs"),
      label: "C#",
    },
    {
      lang: "elixir",
      re: ELIXIR_AUTH_RE,
      routeRe: ELIXIR_ROUTE_RE,
      filter: (p) => /\.exs?$/.test(p),
      label: "Elixir",
    },
  ];
  for (const { lang, re, routeRe, filter, label } of authChecks) {
    if (language !== lang || !isBackendApiRepo(language, ctx.files, ctx.manifests)) continue;
    // routeRe requirement: a file whose PATH matches the admin/dashboard heuristic but that
    // defines no routes isn't a protected route — confirmed against the real davidfowl/TodoApi,
    // where EF Core's auto-named migration RemoveIsAdmin.cs was flagged as an unguarded route.
    const protectedFiles = paths.filter(
      (p) =>
        filter(p) &&
        /admin|dashboard|settings|account/i.test(p) &&
        routeRe.test(ctx.fileContents[p] ?? ""),
    );
    if (protectedFiles.length === 0) continue;
    const unguarded = protectedFiles.filter((p) => !re.test(ctx.fileContents[p] ?? ""));
    if (unguarded.length >= 1) {
      issues.push(
        auditorIssue({
          category: "Security",
          title: "Protected routes may lack auth checks",
          severity: "high",
          why: `${label} admin/dashboard routes detected without auth plugs or guards.`,
          fixId: "auditor-auth-routes",
          timeSaved: "2h",
          checkedFor: ["auth plugs/guards/middleware", "session verification", "token/JWT checks"],
          foundEvidence: `No auth plug/guard matched in: ${unguarded.slice(0, 4).join(", ")}${unguarded.length > 4 ? "…" : ""}.`,
          confidence: "medium",
          recommendedFix:
            "Add session/middleware auth guards on dashboard, admin, and settings routes before launch.",
        }),
      );
    }
  }

  // ── Prisma/schema without migration folder ─────────────────────────────────
  if (ctx.deps["prisma"] || ctx.deps["@prisma/client"]) {
    const hasMigrations = ctx.files.some((f) => f.includes("prisma/migrations/"));
    const hasSchema = ctx.files.some((f) => f === "prisma/schema.prisma");
    if (hasSchema && !hasMigrations) {
      issues.push(
        auditorIssue({
          category: "Database/migration safety",
          title: "Prisma schema without migration history",
          severity: "high",
          why: "schema.prisma exists but no prisma/migrations/ folder. Production DB drift is likely on deploy.",
          fixId: "auditor-prisma-migrations",
          timeSaved: "2h",
          checkedFor: ["prisma/migrations/", "migration version files"],
          foundEvidence: "prisma/schema.prisma present; no files under prisma/migrations/.",
        }),
      );
    }
  }

  if (language === "python") {
    const hasModels = ctx.files.some((f) => /models\.py$/.test(f) || f.includes("/models/"));
    // Recognize BOTH common Python migration systems, not just Django's migrations/<n>_*.py layout.
    // FastAPI/SQLAlchemy apps use Alembic (alembic.ini + versions under a db/migrations dir), which
    // never matches migrations/\d+ — treating that as "no migrations" false-positived on any
    // correctly-migrated Alembic project (a high-severity finding on a repo that's actually fine).
    const pyManifests = (ctx.manifests?.requirements ?? "") + (ctx.manifests?.pyprojectToml ?? "");
    const usesAlembic =
      /alembic/i.test(pyManifests) ||
      ctx.files.some((f) => f === "alembic.ini" || f.endsWith("/alembic.ini")) ||
      ctx.files.some((f) => /(^|\/)(alembic|migrations)\/versions\//.test(f));
    const hasMigrations =
      usesAlembic ||
      ctx.files.some((f) => /migrations\/\d+/.test(f)) ||
      ctx.files.some(
        (f) => /(^|\/)migrations\/[^/]+\.(py|sql)$/i.test(f) && !/__init__\.py$/.test(f),
      );
    if (hasModels && !hasMigrations) {
      issues.push(
        auditorIssue({
          category: "Database/migration safety",
          title: "Database models without migration history",
          severity: "high",
          why: "Model files exist but no migration versions were found (Django migrations/ or Alembic). Generate migrations (makemigrations / alembic revision) before deploy to avoid production DB drift.",
          fixId: "auditor-prisma-migrations",
          timeSaved: "2h",
          checkedFor: [
            "Django migrations/ folders (0001_initial.py etc.)",
            "Alembic (alembic.ini, versions/)",
          ],
          foundEvidence:
            "Model files present; no Django migrations/ or Alembic version files found.",
        }),
      );
    }
  }
  if (language === "java") {
    const blob = [ctx.manifests?.pomXml, ctx.manifests?.buildGradle].filter(Boolean).join("\n");
    if (/flyway|liquibase/i.test(blob)) {
      const hasMigrations = ctx.files.some((f) =>
        /db\/migration|flyway|liquibase|changelog|V\d+__/.test(f),
      );
      if (!hasMigrations) {
        issues.push(
          auditorIssue({
            category: "Database/migration safety",
            title: "Flyway/Liquibase without migration files",
            severity: "high",
            why: "Migration tool in build config but no db/migration or changelog files found.",
            fixId: "auditor-prisma-migrations",
            timeSaved: "2h",
            checkedFor: [
              "db/migration/V__*.sql files",
              "liquibase changelog",
              "flyway migration scripts",
            ],
            foundEvidence:
              "Flyway/Liquibase referenced in build config; no db/migration or changelog files found.",
          }),
        );
      }
    }
  }
  if (language === "elixir") {
    const hasEcto = /ecto/i.test(ctx.manifests?.mixExs ?? "");
    const hasMigrations = ctx.files.some((f) => /^priv\/.*\/migrations\//.test(f));
    if (hasEcto && !hasMigrations && ctx.files.some((f) => /schema\.exs$/.test(f))) {
      issues.push(
        auditorIssue({
          category: "Database/migration safety",
          title: "Ecto schema without migration history",
          severity: "high",
          why: "Ecto schema exists but priv/repo/migrations/ is empty. Run mix ecto.gen.migration before deploy.",
          fixId: "auditor-prisma-migrations",
          timeSaved: "2h",
          checkedFor: ["priv/repo/migrations/", "Ecto migration files"],
          foundEvidence: "schema.exs present; no files under priv/*/migrations/.",
        }),
      );
    }
  }

  // ── Frontend calling hardcoded localhost APIs ──────────────────────────────
  // HTTP-client module files (http-common.js, api.ts, axios.js …) are where CRA/Vite tutorials
  // hardcode an axios baseURL — confirmed against the real bezkoder/react-axios-example, whose
  // unconditional `baseURL: "http://localhost:8080/api"` lives in src/http-common.js, outside
  // every directory this check used to scan. The `(^|\/)` anchor fixes the same root-level-dir
  // blind spot found in the auth check above (a bare includes("/components/") never matched
  // repos whose components/ dir sits at the repo root).
  const HTTP_CLIENT_FILE_RE =
    /(^|\/)(https?[-._]?common|api[-._]?client|apiclient|axios[-._a-z]*|api)\.(ts|js|tsx|jsx)$/i;
  const localhostPaths =
    language === "node"
      ? paths.filter((f) => /(^|\/)(components|pages|app)\//.test(f) || HTTP_CLIENT_FILE_RE.test(f))
      : paths.filter(
          (f) =>
            /\.(py|java|tsx?|jsx?|ex|heex|leex)$/.test(f) &&
            (f.includes("/templates/") ||
              f.includes("/views/") ||
              f.includes("/static/") ||
              f.includes("/client/") ||
              f.includes("/ui/")),
        );
  for (const p of localhostPaths) {
    const content = ctx.fileContents[p];
    if (!content) continue;
    const localhostFetch =
      language === "python"
        ? /requests\.(get|post|put|patch|delete)\s*\(\s*['"`]https?:\/\/localhost/.test(content) ||
          /httpx\.(get|post)\s*\(\s*['"`]https?:\/\/localhost/.test(content) ||
          /fetch\s*\(\s*['"`]https?:\/\/localhost/.test(content)
        : language === "java"
          ? /RestTemplate|WebClient|HttpClient/.test(content) && /localhost:\d+/.test(content)
          : language === "go"
            ? /http\.(Get|Post)|resty\.|req\.(Get|Post)/.test(content) &&
              /localhost:\d+/.test(content)
            : language === "php"
              ? /Http::(get|post)|file_get_contents\s*\(\s*['"`]https?:\/\/localhost/.test(content)
              : language === "rust"
                ? /reqwest::|hyper::/.test(content) && /localhost:\d+/.test(content)
                : language === "csharp"
                  ? /HttpClient|RestClient/.test(content) && /localhost:\d+/.test(content)
                  : language === "ruby"
                    ? /Net::HTTP|Faraday|HTTParty/.test(content) && /localhost:\d+/.test(content)
                    : language === "elixir"
                      ? /HTTPoison|Req\.|Tesla\./.test(content) && /localhost:\d+/.test(content)
                      : nodeLocalhostCall(content);
    if (localhostFetch) {
      issues.push(
        auditorIssue({
          category: "Frontend UX basics",
          title: "Frontend calls localhost API in source",
          severity: "high",
          why: `${p} references a hardcoded localhost API — this breaks for every user outside your machine in production.`,
          fixId: "auditor-localhost-api",
          timeSaved: "1h",
          checkedFor: [
            "fetch('http://localhost...')",
            "axios calls / baseURL pointing at localhost",
            "http://127.0.0.1 references",
            "hardcoded port URLs in components",
          ],
          foundEvidence: `Found in: ${p}`,
        }),
      );
      break;
    }
  }

  return issues;
}

export function dedupeAuditorIssues(
  issues: IssueInput[],
  existingFixIds: Set<string>,
): IssueInput[] {
  const seen = new Set(existingFixIds);
  return issues.filter((i) => {
    if (seen.has(i.fixId)) return false;
    seen.add(i.fixId);
    return true;
  });
}
