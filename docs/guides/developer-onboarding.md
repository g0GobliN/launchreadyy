# Guide — Developer onboarding

## Day 1

1. Clone repo; `npm install` (needs Rust + `wasm-pack` too — `npm run wasm:build` once after
   cloning, since `rust/crates/indexer/pkg/` is git-ignored build output)
2. Copy `.env.example` → `.env`; fill in `SESSION_SECRET`, `ENV_VAR_ENCRYPTION_SECRET`, and a
   `GITHUB_TOKEN` (personal access token — no OAuth app to register)
3. `npm run dev`
4. Open the printed local URL — no login, you're straight into the app as the local operator

## Useful commands

| Command | Why |
| ------- | --- |
| `npm test` | Unit suite |
| `npm run typecheck` | tsc |
| `npm run docs:build` | Regenerate full wiki dump |
| `npm run e2b:build:dev` | Local E2B template experiments |
| `npm run test:production-start` | Smoke-tests a built server actually answers requests |

## Read next

1. [Overview](../reference/01-overview.md)
2. [Architecture](../reference/02-system-architecture.md)
3. [API](../reference/14-api.md)
4. [Repo layout](../reference/04-repository-layout.md)

## Debugging tips

- Server-only code: files ending `*.server.ts`
- Jobs: `background_jobs` table, drained by the in-process poll loop in `jobs.server.ts` — no
  external queue
- AI provider: `AI_PROVIDER` in `.env`
