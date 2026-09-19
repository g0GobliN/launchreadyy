# Guide — Running in production

Operator checklist for a self-hosted instance. Architecture: [reference/02](../reference/02-system-architecture.md).
Env: [§15](../reference/15-environment-variables.md).

## 1. Database

Nothing to provision. SQLite migrations in `src/db/migrations/` apply automatically on first
boot, to `data/launchreadyy.db`. Back that file up like any other application data.

## 2. Required config

Run `launchreadyy setup` (writes `.env` interactively), or copy `.env.example` → `.env` by hand
and fill in at minimum: `SESSION_SECRET`, `ENV_VAR_ENCRYPTION_SECRET`, `GITHUB_TOKEN`. Run
`launchreadyy doctor` afterward — it validates the GitHub token against the live API and flags
conflicting configuration values.

## 3. Optional providers

- **E2B** (`E2B_API_KEY`, `E2B_TEMPLATE_ID`) — sandbox verification. Skipped cleanly without it.
- **AI provider** (`AI_PROVIDER` + matching key) — AI-generated fixes/tests/explanations.
  Deterministic scanning and template fixes work without one.
- `npm run e2b:build:prod` and set `E2B_TEMPLATE_ID` after changing the sandbox template.

## 4. Network

`launchreadyy start` binds to `localhost` by default and warns loudly if you pass
`--host 0.0.0.0` — this app has no login of its own and holds your GitHub/AI/E2B credentials, so
put an authenticating reverse proxy in front of it before exposing it beyond your own machine.

## 5. Feature flags

Feature defaults are defined in `src/lib/feature-flags.ts`. All default on except
`flag_rust_indexer` and `flag_multi_agent_ai`, which remain disabled because of their current
cost and latency characteristics.

## 6. Smoke test before relying on it

1. `launchreadyy doctor` — all green
2. Scan a public repo
3. Sandbox-verify a Node or Go repo (if E2B is configured)
4. Open one fix PR on a repo you control
5. `npm run test:production-start` — confirms the built server actually answers requests

## 7. Supported matrix

Detect + scan + fixes: JS/TS, Python, Go, Ruby, PHP, Java, Kotlin, Rust, C#, Elixir, Dart, Swift
(scan limits on Linux CI). Live sandbox install/build: Node, Python, Go, Rust, Ruby, PHP, Java,
.NET, Elixir (rebuild the E2B template after toolchain changes — see [§12](../reference/12-sandbox.md)).
