export const FIX_LABEL: Record<string, string> = {
  vitest: "Vitest",
  playwright: "Playwright",
  "github-actions": "GitHub Actions CI",
  eslint: "ESLint",
  prettier: "Prettier",
  dockerfile: "Dockerfile",
  "env-example": ".env.example",
  readme: "Setup documentation",
  "error-boundary": "error boundary",
  monitoring: "Sentry monitoring",
  helmet: "Helmet security headers",
  "rate-limit": "rate limiting",
  logger: "Winston logger",
  "ci-ai": "AI-tailored GitHub Actions CI",
  "dependency-audit-ci": "Dependency audit CI workflow",
  "readme-ai": "AI-written setup docs",
  "env-example-ai": "AI-scanned .env.example",
  "vitest-ai": "AI-generated Vitest tests",
  "playwright-ai": "AI-generated Playwright tests",
  "api-tests": "AI-generated API tests",
  "pytest-ai": "AI-generated pytest tests",
  "go-test-ai": "AI-generated Go tests",
  "rspec-ai": "AI-generated RSpec tests",
  "phpunit-ai": "AI-generated PHPUnit tests",
  "junit-ai": "AI-generated JUnit tests",
  "cargo-test-ai": "AI-generated Rust tests",
  "dart-test-ai": "AI-generated Flutter tests",
  "swift-test-ai": "AI-generated Swift tests",
  "kotlin-test-ai": "AI-generated Kotlin tests",
  "xunit-ai": "AI-generated xUnit tests",
  "exunit-ai": "AI-generated ExUnit tests",
  "ts-strict": "TypeScript null safety (strictNullChecks)",
  "health-check": "health check endpoint (GET /health)",
  cors: "CORS policy",
  "security-cookie-flags": "Secure cookie attributes",
  "https-redirect": "HTTPS redirect",
  "db-pool": "database connection pool",
  "gitignore-env": ".env protection",
  pytest: "Pytest test suite",
  ruff: "Ruff linter",
  rspec: "RSpec test suite",
  rubocop: "RuboCop linter",
  "golangci-lint": "golangci-lint",
  phpcs: "PHP CS Fixer (code style)",
  checkstyle: "Checkstyle (Java code quality)",
  credo: "Credo (Elixir linter)",
  phpunit: "PHPUnit test suite",
  "auditor-stripe-webhook": "Stripe webhook signature verification",
  "auditor-env-undocumented": ".env.example from codebase scan",
  "auditor-env-gap": ".env.example gap fill",
  "auditor-api-validation": "API request validation",
  "auditor-auth-routes": "route authentication guard",
  "auditor-prisma-migrations": "Prisma migrate deploy script",
  "auditor-localhost-api": "production API URL env vars",
};

export const FIX_WHY: Record<string, string> = {
  monitoring:
    "You'll know about crashes before your users do. Every unhandled error gets captured with a full stack trace, environment, and release — so you can ship with confidence.",
  vitest:
    "Adds a Vitest scaffold with a passing smoke test so CI has a runnable test command. Replace the placeholder with tests for your real components and logic.",
  "ts-strict":
    "strictNullChecks enabled — TypeScript now catches null/undefined dereferences at compile time. Enable full strict mode once these errors are resolved.",
  "vitest-ai": "AI-written tests cover your real components and logic — not boilerplate.",
  playwright: "Broken user flows get caught before users hit them.",
  "playwright-ai": "AI-written E2E tests cover your actual routes and interactions.",
  "github-actions": "Every push now runs lint, typecheck, and tests automatically.",
  "ci-ai": "CI workflow tailored to your framework, package manager, and scripts.",
  "dependency-audit-ci":
    "Known vulnerable packages get caught on every PR and in a weekly scheduled audit.",
  "readme-ai": "Setup docs written for your actual repo name, stack, and scripts.",
  "env-example-ai": "Env vars scanned from your codebase with descriptions for each.",
  eslint: "Catches bugs and enforces consistent style across the codebase.",
  dockerfile: "Reproducible builds everywhere — local, CI, and production.",
  "env-example": "New contributors can run the app without asking what env vars are needed.",
  readme: "Anyone can clone and run the project in minutes.",
  helmet: "Secure HTTP headers protect against XSS, clickjacking, and other common attacks.",
  "rate-limit": "Brute-force and denial-of-service attacks are now blocked at the edge.",
  logger:
    "Production issues are debuggable. Every request is logged with method, status, and latency.",
  "api-tests": "Your API endpoints are verified — regressions get caught before deploy.",
  "health-check":
    "Deployment platforms ping /health to decide if your app is alive. Without it, failed deploys go undetected.",
  cors: "Cross-origin requests are locked to allowed origins — any website can no longer call your API on behalf of users.",
  "security-cookie-flags":
    "Cookies now carry Secure, HttpOnly, and SameSite by default — they can't be read by injected scripts or sent over plain HTTP.",
  "https-redirect":
    "Every request is forced onto HTTPS — no session, credential, or data ever travels unencrypted.",
  "db-pool": "Database connections are pooled and reused — no connection exhaustion under load.",
  "gitignore-env": ".env files are now git-ignored. Rotate every credential that was committed.",
  pytest: "Pytest installed and configured — every push can now verify your Python logic.",
  ruff: "Ruff catches bugs and style issues across your Python codebase in milliseconds.",
  rspec: "RSpec installed and configured — every push can now verify your Ruby logic.",
  rubocop: "RuboCop enforces consistent Ruby style and catches common mistakes.",
  "golangci-lint":
    "golangci-lint runs a curated set of Go linters — catches bugs static analysis misses.",
  phpcs: "PHP CS Fixer enforces consistent code style and catches formatting issues before review.",
  checkstyle: "Checkstyle enforces Java coding standards and catches common style violations.",
  credo: "Credo enforces Elixir style guidelines and flags common anti-patterns early.",
  phpunit: "PHPUnit installed and configured — every push can now verify your PHP logic.",
};

export const ENV_VAR_SCAN_FILES = [
  "src/index.ts",
  "src/index.js",
  "index.ts",
  "index.js",
  "src/app.ts",
  "src/app.js",
  "app.ts",
  "app.js",
  "src/server.ts",
  "src/server.js",
  "server.ts",
  "server.js",
  "src/config.ts",
  "config.ts",
  "src/env.ts",
  "src/lib/env.ts",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "vite.config.ts",
  "vite.config.js",
];

export const ENV_VAR_BUILTINS = new Set([
  "NODE_ENV",
  "PATH",
  "HOME",
  "USER",
  "PORT",
  "HOST",
  "PWD",
]);

export const ENV_EXAMPLE = `# Copy to .env and fill in
DATABASE_URL=
NEXTAUTH_SECRET=
STRIPE_SECRET_KEY=
SENTRY_DSN=
`;

export const BACKEND_DEPS = [
  "express",
  "fastify",
  "koa",
  "hapi",
  "@hapi/hapi",
  "nestjs",
  "@nestjs/core",
  "restify",
  "polka",
  "h3",
];

export const EXPRESS_ENTRY_CANDIDATES = [
  "src/index.ts",
  "src/index.js",
  "index.ts",
  "index.js",
  "src/server.ts",
  "src/server.js",
  "server.ts",
  "server.js",
  "src/app.ts",
  "src/app.js",
  "app.ts",
  "app.js",
];

export const REACT_VITE_ENTRY_CANDIDATES = [
  "src/main.tsx",
  "src/main.ts",
  "src/index.tsx",
  "src/index.ts",
  "main.tsx",
  "main.ts",
  // TanStack Start — router.tsx runs on both client and server
  "src/router.tsx",
  "src/router.ts",
];

export const PYTHON_ENTRYPOINT_EXCLUDE =
  /(^|\/)(tests?|migrations|\.venv|venv|__pycache__|site-packages|node_modules)(\/|$)/i;

export const PYTHON_APP_ASSIGNMENT = /^[ \t]*(\w+)\s*=\s*(?:FastAPI|Flask|Sanic|Bottle)\s*\(/m;
