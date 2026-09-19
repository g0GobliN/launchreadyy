# Contributing to LaunchReadyy Community

Thanks for taking an interest. This is a self-hosted, single-operator application readiness tool. A few notes to make working on it easier.

Before anything else: this is a **single-operator, self-hosted** app. There is no login, no
one operator and no multi-tenancy. `LOCAL_USER_LOGIN` in `.env` is the operator, and
`GITHUB_TOKEN` is their GitHub credential — see [§8 Identity and configuration](docs/reference/08-authentication.md).
PRs that introduce multi-user account or product-tier concepts will not be merged.

## Ground rules

- **Apache-2.0** for all contributions, same as the project.
- Keep changes focused. One logical change per PR beats a drive-by refactor.
- `npm run typecheck`, `npm run lint`, and `npm run test` must pass. CI enforces this —
  don't open a PR that reds the pipeline. (Both assume the wasm artifact exists; see below.)
- Match the tone of the surrounding code. Comments explain _why_, not _what_; many
  comments document a specific regression that a clean-looking edit could reintroduce.
  Read them before "simplifying" the thing they annotate.

## Getting set up

```bash
npm install
cp .env.example .env   # your own keys; see README Quick start
npm run build          # first run compiles the wasm indexer (needs Rust + wasm-pack)
npm run dev
```

**Rust and `wasm-pack` are required for a full local setup.** The readiness indexer is a Rust
crate compiled to WebAssembly, and its build output is git-ignored, so a fresh clone cannot even
`npm run typecheck` until the artifact exists — `tsc` cannot resolve `rust/crates/indexer/pkg/*`.
Run `npm run build` (or just `npm run wasm:build`) once and the rest works from there.

You do not need paid accounts on any vendor to hack on the app: a GitHub personal access token,
and any AI provider key (DeepSeek is the cheapest) covers everything, and E2B's free tier covers
sandbox verification. Check `.env.example` for the full list — most variables are optional and simply switch a feature off when unset.

## Where things live

| Path                      | What it is                                                                 |
| ------------------------- | -------------------------------------------------------------------------- |
| `src/routes/`             | TanStack file-based routes (pages + server functions in `src/lib/api/`)    |
| `src/lib/readiness/`      | The scan engine: checks, scoring, auditor                                  |
| `src/lib/fix-*.server.ts` | Fix generation (templates + AI) and the PR pipeline                        |
| `src/lib/sandbox-verify/` | E2B sandbox verification                                                   |
| `src/lib/services/`       | Monitoring (repo re-scans, live-site checks)                               |
| `src/db/schema.sql`       | Single-file database schema — applied on startup via the SQLite data layer |
| `docs/`                   | Architecture, guides, and reference docs                                   |

## Pull requests

1. Fork, branch, make the change.
2. `npm run typecheck && npm run lint && npm run test`
3. Touch generated docs? Run `npm run docs:build` and commit the result — `npm run docs:check`
   fails on a stale `docs/FULL_DOCUMENTATION.md`, and CI runs it.
4. Write a clear PR description: what breaks today, what changes, how you tested it.
5. For scanner/check changes, add or update a fixture under `fixtures/` where practical.

## What's worth contributing

- New readiness/security checks with evidence-backed findings
- New stack/framework detection and fix templates
- Sandbox toolchain coverage (more languages in the E2B template)
- Documentation: the docs are good but the surface area is huge
- Performance: the scan pipeline has known hot spots (see `scripts/bench-*`)

## Reporting bugs

Open a GitHub issue with: what you did, what you expected, what happened, and the
relevant log lines. For security issues, see [SECURITY.md](SECURITY.md) — please don't
open public issues for those.
