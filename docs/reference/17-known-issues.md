# 17. Known Issues / product scope

| Item | Status | Notes |
| ---- | ------ | ----- |
| Multi-agent AI | Off by default | Optional cost-heavy pipeline; enable after live validation |
| Semgrep, CodeQL | Removed 2026-08-18 | Both licences forbid offering the tool as a service. Replaced the same day by rules we own: dependency inventory from lockfiles, 41 provider secret patterns, GitHub Actions security, container security, code patterns — [§19](19-tool-licensing.md) |
| SAST depth vs breadth | By design | All analysis is now our own rules: precise on the classes that block a launch, without a rule pack's breadth or dataflow tracking. Adding a class means adding a rule — [§19](19-tool-licensing.md) |
| Rust indexer | Off by default | Current bridge slower than TS path |
| Swift Docker on Linux CI | Scan-only | Limitation of Linux CI hosts |
| Schema apply | Automatic | SQLite migrations in `src/db/migrations/` apply on boot — no manual step |
| E2B template rebuild | Required after toolchain changes | `npm run e2b:build:prod` then set `E2B_TEMPLATE_ID`; verify with `scripts/verify-sandbox-languages.ts` |
| Subdirectory apps | Supported | Scan and fix both resolve the app directory via `scan-engine/app-root.ts`; generated files land beneath it, CI workflows stay at the repo root. |
| Closing a pull request | Not a product feature | `cancelFixRequest` discards a job **before** the PR exists; nothing closes an opened PR. Users close/merge on GitHub. |
| Repo monitoring | On by default | `flag_repo_monitoring` is the installation-wide kill switch; the operator still opts in per repo from Settings — [§18](18-monitoring.md) |
| Push / PR webhook gate | Not built | Needs a GitHub App: webhook registration over a personal access token requires re-consent per repo, check runs are App-only, `getRepoSnapshot` takes no ref, and `repos` stores no installation id |
| `intelligence.monorepo` | `package.json`-only | Scanning is language-agnostic via `app-root.ts`, but the intelligence flag still misses polyglot repos (Go API + Next web). |

Live sandbox: Node, Python, Go, Rust, Ruby, PHP, Java, .NET, Elixir (see `launchreadyy/template.ts`).

Ops checklist: [Production guide](../guides/production.md).
