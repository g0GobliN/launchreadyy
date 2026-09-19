import { describe, expect, it } from "vitest";
import { enrichFinding } from "./enrich-finding";
import { computeReadinessScore, partitionFindings, sortByPriority } from "./scorer";
import { runAuditor } from "./auditor";
import type { IssueInput } from "../scanner-rules";

describe("computeReadinessScore", () => {
  it("returns 100 when no findings", () => {
    const r = computeReadinessScore([]);
    expect(r.overallScore).toBe(100);
    expect(r.categoryScores.every((c) => c.score === 100)).toBe(true);
  });

  it("lowers score for critical security finding", () => {
    const f = enrichFinding({
      category: "Security",
      title: "Stripe webhook",
      severity: "critical",
      why: "x",
      timeSaved: "1h",
      fixId: "auditor-stripe-webhook",
    });
    const r = computeReadinessScore([f]);
    expect(r.overallScore).toBeLessThan(100);
    const sec = r.categoryScores.find((c) => c.category === "Security");
    expect(sec?.blockerCount).toBe(1);
  });
});

/**
 * Offering a one-click fix for a finding must not change how that finding is graded. The two are
 * separate decisions — "can we repair this automatically" and "should this hold the launch" — and
 * wiring them together silently re-scored nine real repositories by up to 18 points the first time
 * these three fixes were registered.
 */
describe("hardening findings keep their grade when a fix generator exists", () => {
  const hardening = (fixId: string): IssueInput => ({
    category: "Security",
    title: fixId,
    severity: "medium",
    why: "x",
    timeSaved: "30m",
    fixId,
  });

  it.each(["workflow-permissions", "workflow-unpinned-action", "docker-root-user"])(
    "%s is hardening to schedule, not a reason to hold the launch",
    (fixId) => {
      const finding = enrichFinding(hardening(fixId));
      const { blockers, fixBeforeLaunch, canWait } = partitionFindings([finding]);
      expect(blockers).toHaveLength(0);
      expect(fixBeforeLaunch).toHaveLength(0);
      expect(canWait).toHaveLength(1);
    },
  );

  it("grades them the same as an equivalent finding with no metadata at all", () => {
    const withMeta = enrichFinding(hardening("docker-root-user"));
    const withoutMeta = enrichFinding(hardening("some-unregistered-finding"));
    expect(withMeta.priority).toBe(withoutMeta.priority);
    expect(withMeta.riskLevel).toBe(withoutMeta.riskLevel);
  });
});

describe("partitionFindings", () => {
  it("separates blockers from deferrable items", () => {
    const blocker = enrichFinding({
      category: "Security",
      title: "a",
      severity: "critical",
      why: "x",
      timeSaved: "1h",
      fixId: "auditor-stripe-webhook",
    });
    const low = enrichFinding({
      category: "Maintainability",
      title: "b",
      severity: "low",
      why: "x",
      timeSaved: "1h",
      fixId: "prettier",
    });
    const { blockers, canWait } = partitionFindings([blocker, low]);
    expect(blockers).toHaveLength(1);
    expect(canWait.some((i) => i.fixId === "prettier")).toBe(true);
  });
});

describe("enrichFinding severity calibration", () => {
  it("downgrades critical + medium confidence to high (not a blocker)", () => {
    const f = enrichFinding({
      category: "Security",
      title: "Maybe secret",
      severity: "critical",
      why: "x",
      timeSaved: "1h",
      fixId: "security-secret-heuristic",
      confidence: "medium",
    });
    expect(f.severity).toBe("high");
    expect(f.riskLevel).toBe("high");
  });

  it("keeps critical + high confidence as a blocker", () => {
    const f = enrichFinding({
      category: "Security",
      title: "Hardcoded key",
      severity: "critical",
      why: "x",
      timeSaved: "1h",
      fixId: "security-hardcoded-secret",
      confidence: "high",
    });
    expect(f.severity).toBe("critical");
    expect(f.riskLevel).toBe("blocker");
  });
});

describe("sortByPriority confidence", () => {
  it("sinks low-confidence findings within the same severity band", () => {
    const highConf = enrichFinding({
      category: "Security",
      title: "High conf",
      severity: "high",
      why: "x",
      timeSaved: "1h",
      fixId: "cors",
      confidence: "high",
    });
    const lowConf = enrichFinding({
      category: "Security",
      title: "Low conf",
      severity: "high",
      why: "x",
      timeSaved: "1h",
      fixId: "rate-limit",
      confidence: "low",
    });
    // Same priority band — force equal priority so confidence is the tiebreak
    highConf.priority = 3;
    lowConf.priority = 3;
    const sorted = sortByPriority([lowConf, highConf]);
    expect(sorted[0]!.title).toBe("High conf");
    expect(sorted[1]!.title).toBe("Low conf");
  });
});

describe("runAuditor", () => {
  it("flags stripe webhook without verification", () => {
    const issues = runAuditor({
      files: ["app/api/stripe/webhook/route.ts"],
      fileContents: {
        "app/api/stripe/webhook/route.ts":
          "export async function POST(req) { const body = await req.json(); await handleStripe(body); }",
      },
      envExampleContent: null,
      deps: { stripe: "14.0.0" },
      framework: "Next.js",
    });
    expect(issues.some((i) => i.fixId === "auditor-stripe-webhook")).toBe(true);
  });

  it("skips stripe webhook flag when server.ts verifies centrally", () => {
    const issues = runAuditor({
      files: ["server.ts", "src/lib/fix-packs.ts"],
      fileContents: {
        "server.ts":
          "export async function handleStripeWebhook() { stripe.webhooks.constructEventAsync(body, sig, process.env.STRIPE_WEBHOOK_SECRET) }",
        "src/lib/fix-packs.ts": 'export const x = "webhook signature verification";',
      },
      envExampleContent: null,
      deps: { stripe: "14.0.0" },
      framework: "Express",
    });
    expect(issues.some((i) => i.fixId === "auditor-stripe-webhook")).toBe(false);
  });

  it("skips stripe webhook flag when src/server.ts verifies centrally", () => {
    const issues = runAuditor({
      files: ["src/server.ts", "src/lib/api/github.functions.ts"],
      fileContents: {
        "src/server.ts":
          "async function handleStripeWebhook() { await stripe.webhooks.constructEventAsync(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!) }",
        "src/lib/api/github.functions.ts":
          'import { parseAuditorRoutePath } from "../stripe-webhook-fix.server";',
      },
      envExampleContent: null,
      deps: { stripe: "14.0.0" },
      framework: "TanStack",
    });
    expect(issues.some((i) => i.fixId === "auditor-stripe-webhook")).toBe(false);
  });

  // Confirmed against the real ruffrey/stripe-webhook-server: layered apps register the
  // webhook in server.js and verify in routes/index.js (via events.retrieve — Stripe's
  // documented pre-signature verification alternative). Per-file co-occurrence flagged it.
  it("skips stripe webhook flag when registration and verification live in different files", () => {
    const issues = runAuditor({
      files: ["server.js", "routes/index.js"],
      fileContents: {
        "server.js":
          "var routes = require('./routes');\napp.post(config.webhookEndpointPath, routes.webhookHandler(config));",
        "routes/index.js":
          "exports.webhookHandler = function(config) { return function(req, res) { stripe.events.retrieve(req.body.id, function(err, evt) { handle(evt); }); }; };",
      },
      envExampleContent: null,
      deps: { stripe: "3.9.0" },
      framework: "Express",
    });
    expect(issues.some((i) => i.fixId === "auditor-stripe-webhook")).toBe(false);
  });

  it("does not flag fix-packs.ts for webhook comment text", () => {
    const issues = runAuditor({
      files: ["src/lib/fix-packs.ts"],
      fileContents: {
        "src/lib/fix-packs.ts":
          'export const FIX_PACKS = [{ description: "webhook signature verification" }];',
      },
      envExampleContent: null,
      deps: { stripe: "14.0.0" },
      framework: "Vite",
    });
    expect(issues.some((i) => i.fixId === "auditor-stripe-webhook")).toBe(false);
  });

  // `(^|\/)app\//` regression: repo-relative paths have no leading slash, so the old
  // `includes("/app/")` never matched the standard root-level app/ layout — confirmed against
  // the real shadcn/taxonomy, whose app/(dashboard)/dashboard pages were invisible to this
  // check (taxonomy itself is properly guarded by its middleware matcher and must stay silent).
  it("flags an unguarded root-level app/ dashboard page when an auth lib is present", () => {
    const issues = runAuditor({
      files: ["app/(dashboard)/dashboard/page.tsx", "package.json"],
      fileContents: {
        "app/(dashboard)/dashboard/page.tsx":
          "export default async function DashboardPage() { const posts = await db.post.findMany(); return <div>{posts.length}</div> }",
      },
      envExampleContent: null,
      deps: { next: "14.0.0", "next-auth": "4.24.0" },
      framework: "Next.js",
    });
    expect(issues.some((i) => i.fixId === "auditor-auth-routes")).toBe(true);
  });

  it("stays silent for a root-level app/ dashboard guarded by a middleware matcher", () => {
    const issues = runAuditor({
      files: ["app/(dashboard)/dashboard/page.tsx", "middleware.ts", "package.json"],
      fileContents: {
        "app/(dashboard)/dashboard/page.tsx":
          "export default async function DashboardPage() { const posts = await db.post.findMany(); return <div>{posts.length}</div> }",
        "middleware.ts":
          'export default withAuth(async function middleware(req) {})\nexport const config = { matcher: ["/dashboard/:path*"] }',
      },
      envExampleContent: null,
      deps: { next: "14.0.0", "next-auth": "4.24.0" },
      framework: "Next.js",
    });
    expect(issues.some((i) => i.fixId === "auditor-auth-routes")).toBe(false);
  });

  // Confirmed against the real bezkoder/react-axios-example: CRA/Vite tutorials hardcode the
  // axios baseURL in an HTTP-client module (src/http-common.js) — outside components//pages//app/
  // and not a fetch() call, so the old check was blind to the most common real shape.
  it("flags an unconditional axios baseURL localhost in an http-client module", () => {
    const issues = runAuditor({
      files: ["src/http-common.js", "src/components/TutorialsList.js"],
      fileContents: {
        "src/http-common.js":
          'import axios from "axios";\n\nexport default axios.create({\n  baseURL: "http://localhost:8080/api",\n  headers: { "Content-type": "application/json" }\n});',
      },
      envExampleContent: null,
      deps: { axios: "0.22.0", react: "17.0.2" },
      framework: "React",
    });
    expect(issues.some((i) => i.fixId === "auditor-localhost-api")).toBe(true);
  });

  // Confirmed against the real rmiyazaki6499/mern-app: an env var with a localhost fallback is
  // a reasonable dev default, not a launch blocker — must NOT fire.
  it("stays silent for an env-var baseURL with localhost fallback", () => {
    const issues = runAuditor({
      files: ["src/api-client.js"],
      fileContents: {
        "src/api-client.js":
          'import axios from "axios";\nexport default axios.create({\n  baseURL: process.env.REACT_APP_HOST || "http://localhost:5000",\n});',
      },
      envExampleContent: null,
      deps: { axios: "0.22.0", react: "17.0.2" },
      framework: "React",
    });
    expect(issues.some((i) => i.fixId === "auditor-localhost-api")).toBe(false);
  });

  // Root-level components/ regression — same `(^|\/)` blind spot as the auth check.
  it("flags a localhost fetch in a root-level components/ dir", () => {
    const issues = runAuditor({
      files: ["components/user-list.tsx"],
      fileContents: {
        "components/user-list.tsx":
          'export async function UserList() { const res = await fetch("http://localhost:3001/api/users"); return res.json() }',
      },
      envExampleContent: null,
      deps: { next: "14.0.0" },
      framework: "Next.js",
    });
    expect(issues.some((i) => i.fixId === "auditor-localhost-api")).toBe(true);
  });

  it("detects TODO markers across files", () => {
    const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
    const fileContents: Record<string, string> = {};
    for (const f of files) fileContents[f] = "// TODO: finish this";
    const issues = runAuditor({
      files,
      fileContents,
      envExampleContent: null,
      deps: {},
      framework: "Vite",
    });
    expect(issues.some((i) => i.fixId === "auditor-todo-markers")).toBe(true);
  });

  it("flags unvalidated Go handlers", () => {
    const files = ["cmd/server/main.go", "cmd/server/routes.go", "internal/api/handlers.go"];
    const fileContents: Record<string, string> = {
      "cmd/server/main.go": `http.HandleFunc("/users", usersHandler)`,
      "cmd/server/routes.go": `mux.HandleFunc("/orders", ordersHandler)`,
      "internal/api/handlers.go": `r.Get("/billing", billingHandler)`,
    };
    const issues = runAuditor({
      files,
      fileContents,
      envExampleContent: null,
      deps: {},
      framework: "Go",
      language: "go",
    });
    expect(issues.some((i) => i.fixId === "auditor-api-validation")).toBe(true);
  });

  // Confirmed against the real qiangxue/go-rest-api: Go's standard layout registers routes in
  // api.go and validates in service.go via ozzo-validation — per-file co-occurrence flagged a
  // repo that validates everything.
  it("does not flag Go repos that validate in a separate service layer (ozzo)", () => {
    const files = ["internal/album/api.go", "internal/album/service.go", "cmd/server/main.go"];
    const fileContents: Record<string, string> = {
      "internal/album/api.go": `r.Get("/albums", res.query)\nr.Post("/albums", res.create)`,
      "internal/album/service.go": `return validation.ValidateStruct(&m, validation.Field(&m.Name, validation.Required))`,
      "cmd/server/main.go": `http.HandleFunc("/health", healthHandler)`,
    };
    const issues = runAuditor({
      files,
      fileContents,
      envExampleContent: null,
      deps: {},
      framework: "Go",
      language: "go",
    });
    expect(issues.some((i) => i.fixId === "auditor-api-validation")).toBe(false);
  });

  // Confirmed against the real w3cj/express-api-starter-ts: two GET-only routers that never
  // read req.body/query/params were flagged as "accepting requests without validation".
  it("does not flag Express route files that read no request input", () => {
    const issues = runAuditor({
      files: ["src/api/index.ts", "src/api/emojis.ts"],
      fileContents: {
        "src/api/index.ts": `router.get("/", (req, res) => { res.json({ message: "ok" }); });`,
        "src/api/emojis.ts": `router.get("/", (req, res) => { res.json(["😀"]); });`,
      },
      envExampleContent: null,
      deps: { express: "5.0.0" },
      framework: "Express",
    });
    expect(issues.some((i) => i.fixId === "auditor-api-validation")).toBe(false);
  });

  it("still flags Express route files that read input without validation", () => {
    const issues = runAuditor({
      files: ["src/api/users.ts", "src/api/orders.ts"],
      fileContents: {
        "src/api/users.ts": `router.post("/", (req, res) => { db.insert(req.body); });`,
        "src/api/orders.ts": `router.post("/", (req, res) => { create(req.body.items); });`,
      },
      envExampleContent: null,
      deps: { express: "5.0.0" },
      framework: "Express",
    });
    expect(issues.some((i) => i.fixId === "auditor-api-validation")).toBe(true);
  });

  // Confirmed against the real khoubyari/spring-boot-rest-example: a src/test/java/*Test.java
  // file pushed the marker count over the threshold — only JS test conventions were excluded.
  it("does not count language-convention test files toward TODO markers", () => {
    const files = [
      "src/main/java/App.java",
      "src/main/java/Handler.java",
      "src/test/java/AppTest.java",
    ];
    const fileContents: Record<string, string> = {};
    for (const f of files) fileContents[f] = "// TODO: finish this";
    const issues = runAuditor({
      files,
      fileContents,
      envExampleContent: null,
      deps: {},
      framework: "Java",
      language: "java",
    });
    expect(issues.some((i) => i.fixId === "auditor-todo-markers")).toBe(false);
  });

  // Confirmed against the real davidfowl/TodoApi: Todo.Api.Tests/*Tests.cs files were sampled
  // as source (only tests/-style dirs were excluded, not the .NET <Project>.Tests convention).
  it("does not count .NET test-project files toward TODO markers", () => {
    const files = ["Todo.Api/TodoApi.cs", "Todo.Api/UsersApi.cs", "Todo.Api.Tests/TodoApiTests.cs"];
    const fileContents: Record<string, string> = {};
    for (const f of files) fileContents[f] = "// TODO: finish this";
    const issues = runAuditor({
      files,
      fileContents,
      envExampleContent: null,
      deps: {},
      framework: "C#",
      language: "csharp",
    });
    expect(issues.some((i) => i.fixId === "auditor-todo-markers")).toBe(false);
  });

  // Confirmed against the real miguelgrinberg/microblog: its 27 routes all use Flask's
  // @bp.route decorator (invisible to the old PY_ROUTE_RE) and validate via WTForms
  // (validate_on_submit — claimed in checkedFor but missing from the regex). Meanwhile its
  // 3-line Blueprint declaration stubs counted as "unvalidated routes".
  it("does not flag Flask apps that validate via WTForms in @bp.route files", () => {
    const issues = runAuditor({
      files: ["app/main/routes.py", "app/auth/routes.py", "app/main/__init__.py", "main.py"],
      fileContents: {
        "app/main/routes.py": `@bp.route('/edit', methods=['POST'])\ndef edit():\n    form = EditForm()\n    if form.validate_on_submit():\n        save(request.form)`,
        "app/auth/routes.py": `@bp.route('/login', methods=['POST'])\ndef login():\n    form = LoginForm()\n    if form.validate_on_submit():\n        do_login(request.form)`,
        "app/main/__init__.py": `from flask import Blueprint\n\nbp = Blueprint('main', __name__)`,
      },
      envExampleContent: null,
      deps: {},
      framework: "Python",
      language: "python",
    });
    expect(issues.some((i) => i.fixId === "auditor-api-validation")).toBe(false);
  });

  it("still flags Flask @bp.route files that read JSON input without validation", () => {
    const issues = runAuditor({
      files: ["app/api/users.py", "app/api/posts.py", "main.py"],
      fileContents: {
        "app/api/users.py": `@bp.route('/users', methods=['POST'])\ndef create_user():\n    data = request.get_json()\n    db.insert(data)`,
        "app/api/posts.py": `@bp.route('/posts', methods=['POST'])\ndef create_post():\n    data = request.get_json()\n    db.insert(data)`,
      },
      envExampleContent: null,
      deps: {},
      framework: "Python",
      language: "python",
    });
    expect(issues.some((i) => i.fixId === "auditor-api-validation")).toBe(true);
  });

  // Confirmed against the real spring-projects/spring-petclinic: WelcomeController and
  // CrashController read zero request input (nothing to validate), and VetController's single
  // auto-converted @RequestParam int shouldn't fire alone.
  it("does not flag Java controllers that read no request input", () => {
    const issues = runAuditor({
      files: [
        "src/main/java/WelcomeController.java",
        "src/main/java/CrashController.java",
        "src/main/java/VetController.java",
      ],
      fileContents: {
        "src/main/java/WelcomeController.java": `@Controller\nclass WelcomeController {\n  @GetMapping("/") public String welcome() { return "welcome"; }\n}`,
        "src/main/java/CrashController.java": `@Controller\nclass CrashController {\n  @GetMapping("/oups") public String triggerException() { throw new RuntimeException(); }\n}`,
        "src/main/java/VetController.java": `@Controller\nclass VetController {\n  @GetMapping("/vets") public String showVetList(@RequestParam(defaultValue = "1") int page) { return page(page); }\n}`,
      },
      envExampleContent: null,
      deps: {},
      framework: "Java",
      language: "java",
    });
    expect(issues.some((i) => i.fixId === "auditor-api-validation")).toBe(false);
  });

  // Confirmed true positive on the real khoubyari/spring-boot-rest-example: HotelController
  // deserializes @RequestBody twice with no @Valid anywhere — that single file is a red flag
  // on its own (the old >=2-files threshold only fired because a no-input helper also counted).
  it("flags a single Java controller taking @RequestBody without validation", () => {
    const issues = runAuditor({
      files: ["src/main/java/HotelController.java"],
      fileContents: {
        "src/main/java/HotelController.java": `@RestController\nclass HotelController {\n  @RequestMapping(method = RequestMethod.POST)\n  public Hotel create(@RequestBody Hotel hotel) { return service.create(hotel); }\n}`,
      },
      envExampleContent: null,
      deps: {},
      framework: "Java",
      language: "java",
    });
    expect(issues.some((i) => i.fixId === "auditor-api-validation")).toBe(true);
  });

  // Confirmed against the real symfony/demo: its controllers validate via the standard
  // createForm/handleRequest/isValid form flow (constraints live on entities/FormTypes).
  it("does not flag Symfony controllers using the form-validation flow", () => {
    const issues = runAuditor({
      files: [
        "src/Controller/UserController.php",
        "src/Controller/BlogController.php",
        "config/routes.yaml",
      ],
      fileContents: {
        "src/Controller/UserController.php": `#[Route('/user/edit', methods: ['GET', 'POST'])]\npublic function edit(Request $request): Response {\n    $form = $this->createForm(UserType::class, $user);\n    $form->handleRequest($request);\n    if ($form->isSubmitted() && $form->isValid()) { $this->em->flush(); }\n}`,
        "src/Controller/BlogController.php": `#[Route('/comment/{postSlug}/new', methods: ['POST'])]\npublic function commentNew(Request $request): Response {\n    $form = $this->createForm(CommentType::class, $comment);\n    $form->handleRequest($request);\n    if ($form->isSubmitted() && $form->isValid()) { $this->em->persist($comment); }\n}`,
      },
      envExampleContent: null,
      deps: {},
      framework: "PHP",
      language: "php",
    });
    expect(issues.some((i) => i.fixId === "auditor-api-validation")).toBe(false);
  });

  // Confirmed against the real davidfowl/TodoApi: minimal-API route groups validate via
  // WithParameterValidation (MiniValidation) with [Required] models in separate files.
  it("does not flag C# minimal APIs validated via WithParameterValidation", () => {
    const issues = runAuditor({
      files: ["Todo.Api/Todos/TodoApi.cs", "Todo.Api/Users/UsersApi.cs", "Todo.Api/Program.cs"],
      fileContents: {
        "Todo.Api/Todos/TodoApi.cs": `var group = routes.MapGroup("/todos");\ngroup.WithParameterValidation(typeof(TodoItem));\ngroup.MapPost("/", async (TodoItem todo, TodoDbContext db) => { db.Todos.Add(todo); });`,
        "Todo.Api/Users/UsersApi.cs": `var group = routes.MapGroup("/users");\ngroup.WithParameterValidation(typeof(ExternalUserInfo));\ngroup.MapPost("/", async (UserInfo newUser) => { await CreateUser(newUser); });`,
      },
      envExampleContent: null,
      deps: {},
      framework: "C#",
      language: "csharp",
    });
    expect(issues.some((i) => i.fixId === "auditor-api-validation")).toBe(false);
  });

  // Confirmed against the real davidfowl/TodoApi: EF Core's auto-named migration
  // RemoveIsAdmin.cs matched the admin-path heuristic but defines no routes at all.
  it("does not flag EF migration files as unguarded protected routes", () => {
    const issues = runAuditor({
      files: ["Todo.Api/Migrations/20221123165051_RemoveIsAdmin.cs", "Todo.Api/Program.cs"],
      fileContents: {
        "Todo.Api/Migrations/20221123165051_RemoveIsAdmin.cs": `public partial class RemoveIsAdmin : Migration\n{\n    protected override void Up(MigrationBuilder migrationBuilder) { migrationBuilder.DropColumn(name: "IsAdmin", table: "Users"); }\n}`,
      },
      envExampleContent: null,
      deps: {},
      framework: "C#",
      language: "csharp",
    });
    expect(issues.some((i) => i.fixId === "auditor-auth-routes")).toBe(false);
  });

  // Confirmed against the real gothinkster/rails-realworld-example-app (flagged solely for
  // BUNDLE_GEMFILE + RAILS_SERVE_STATIC_FILES, scaffold vars in every `rails new` output) and
  // the real davidfowl/TodoApi (flagged solely for OTEL_* / AppInsights telemetry toggles).
  it("does not count framework-scaffold and telemetry env vars as undocumented", () => {
    const issues = runAuditor({
      files: [
        "config/boot.rb",
        "config/environments/production.rb",
        "app/controllers/user_controller.rb",
      ],
      fileContents: {
        "config/boot.rb": `ENV['BUNDLE_GEMFILE'] ||= File.expand_path('../../Gemfile', __FILE__)`,
        "config/environments/production.rb": `config.serve_static_files = ENV['RAILS_SERVE_STATIC_FILES'].present?\nconfig.log_level = ENV['RAILS_LOG_TO_STDOUT']`,
      },
      envExampleContent: null,
      deps: {},
      framework: "Ruby",
      language: "ruby",
    });
    expect(issues.some((i) => i.fixId === "auditor-env-undocumented")).toBe(false);
  });
});

describe("enrichFinding auditor auto-fix", () => {
  it("marks security auditor findings as auto-fixable", () => {
    const f = enrichFinding({
      category: "Security",
      title: "Stripe webhook",
      severity: "critical",
      why: "x",
      timeSaved: "1h",
      fixId: "auditor-stripe-webhook",
    });
    expect(f.autoFixable).toBe(true);
  });

  it("marks TODO markers as auto-fixable (AI fix)", () => {
    const f = enrichFinding({
      category: "Maintainability",
      title: "TODOs",
      severity: "medium",
      why: "x",
      timeSaved: "1h",
      fixId: "auditor-todo-markers",
    });
    expect(f.autoFixable).toBe(true);
  });

  it("marks language AI test fixes as auto-fixable", () => {
    const f = enrichFinding({
      category: "Testing",
      title: "No Go tests",
      severity: "high",
      why: "x",
      timeSaved: "2h",
      fixId: "go-test-ai",
    });
    expect(f.autoFixable).toBe(true);
  });

  it("marks kotlin AI tests as auto-fixable", () => {
    const f = enrichFinding({
      category: "Testing",
      title: "No Kotlin tests",
      severity: "high",
      why: "x",
      timeSaved: "2h",
      fixId: "kotlin-test-ai",
    });
    expect(f.autoFixable).toBe(true);
  });
});
