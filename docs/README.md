# LaunchReadyy Community — Documentation

Self-hosted GitHub repo readiness tool: scan → score → fix PRs, with optional E2B sandbox
verification. One Node.js process runs the app, the scheduler, and background jobs together — no
one operator and no external application database.

| Component       | What it is                                                 |
| --------------- | ---------------------------------------------------------- |
| `src/routes/`   | Marketing + app UI (React / TanStack Start), no auth split |
| `src/lib/`      | Scan, fix, sandbox, jobs                                   |
| `src/db/`       | SQLite schema, migrations, query client                    |
| `src/ai/`       | AI router + providers                                      |
| `launchreadyy/` | E2B sandbox image template                                 |
| `rust/`         | Optional indexer                                           |

## I want to…

| Goal                                             | Read                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| Understand how the whole thing fits together     | [2. System Architecture](reference/02-system-architecture.md)            |
| Start developing on this repo today              | [Developer Onboarding](guides/developer-onboarding.md)                   |
| Find an API / route                              | [14. API](reference/14-api.md) · [5. Frontend](reference/05-frontend.md) |
| Add or change an environment variable            | [15. Environment Variables](reference/15-environment-variables.md)       |
| Deploy to production                             | [Deployment](guides/deployment.md)                                       |
| Go-live / ops checklist                          | [Production](guides/production.md)                                       |
| Debug a live incident                            | [Operations](guides/operations.md)                                       |
| Know what a table holds                          | [7. Database](reference/07-database.md)                                  |
| Understand provider costs and limits | [9. Costs and limits](reference/09-costs-and-limits.md) |
| Know current scope / deferred features           | [17. Known Issues](reference/17-known-issues.md)                         |
| Understand scheduled re-scans                    | [18. Continuous monitoring](reference/18-monitoring.md)                  |

---

## Reference — the wiki

Living technical documentation. Each chapter stands alone.

| #   | Chapter                                                        | Covers                               |
| --- | -------------------------------------------------------------- | ------------------------------------ |
| 1   | [Overview](reference/01-overview.md)                           | Product, features, components        |
| 2   | [System Architecture](reference/02-system-architecture.md)     | Process topology, flows              |
| 3   | [Technology Stack](reference/03-technology-stack.md)           | Languages, frameworks                |
| 4   | [Repository Layout](reference/04-repository-layout.md)         | Folders                              |
| 5   | [Frontend](reference/05-frontend.md)                           | Routes, pages                        |
| 6   | [Backend](reference/06-backend.md)                             | Server entry, server fns             |
| 7   | [Database](reference/07-database.md)                           | SQLite tables                        |
| 8   | [Identity](reference/08-authentication.md)                     | Single operator, no login            |
| 9   | [Costs and limits](reference/09-costs-and-limits.md)            | External provider usage and local concurrency |
| 10  | [Scan system](reference/10-scan-system.md)                     | Pipeline                             |
| 11  | [Fix system](reference/11-fix-system.md)                       | PR flow                              |
| 12  | [Sandbox](reference/12-sandbox.md)                             | E2B verify                           |
| 13  | [AI layer](reference/13-ai-layer.md)                           | Router, provider selection           |
| 14  | [API](reference/14-api.md)                                     | Server function modules              |
| 15  | [Environment Variables](reference/15-environment-variables.md) | Env / secrets                        |
| 16  | [Security](reference/16-security.md)                           | Identity, credential handling, gaps  |
| 17  | [Known Issues](reference/17-known-issues.md)                   | Debt / limits                        |
| 18  | [Continuous monitoring](reference/18-monitoring.md)            | Scheduled re-scans, score history    |
| 19  | [Third-party tool licensing](reference/19-tool-licensing.md)   | Which analyzers we may ship, and why |
| —   | [Appendix A — Scripts](reference/appendix-a-scripts.md)        | npm scripts                          |
| —   | [Appendix B — Ports](reference/appendix-b-ports.md)            | Local URLs                           |

---

## Guides — procedures

| Guide                                                  | For                            |
| ------------------------------------------------------ | ------------------------------ |
| [Production](guides/production.md)                     | Schema, secrets, smoke, matrix |
| [Deployment](guides/deployment.md)                     | Build, run, rollback           |
| [Operations](guides/operations.md)                     | Health, troubleshooting        |
| [Developer Onboarding](guides/developer-onboarding.md) | Day 1 setup                    |

---

## Everything in one file

[`FULL_DOCUMENTATION.md`](FULL_DOCUMENTATION.md) — all reference chapters concatenated, for Ctrl-F, printing, or handover.

It is **generated**. Do not edit it. Edit the chapter in `reference/`, then run:

```bash
npm run docs:build
```

`npm run docs:check` fails if it drifted (usable in CI).

---

## Editing these docs

| Rule                                                   | Why                                    |
| ------------------------------------------------------ | -------------------------------------- |
| `reference/` chapters are the single source of truth   | Prose lives in one place               |
| Never hand-edit `FULL_DOCUMENTATION.md`                | Overwritten by the build               |
| Run `npm run docs:build` after any `reference/` change | Keeps the combined file in sync        |
| `npm run docs:check` fails if drifted                  | Catchable in CI                        |
| Chapter order lives in `scripts/build-docs.js`         | Adding a chapter means adding it there |
| Link between docs with relative paths                  | Works in Git and editors               |
