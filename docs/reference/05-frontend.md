# 5. Frontend

File-based routes under `src/routes/`. Loaders + TanStack Query for data; no separate global store.

## Route map

There's no auth split — every route is reachable by the one local operator. Reference pages
(`/docs`, `/changelog`, `/license`, …) sit alongside the app in the same file-based route tree; the
public landing site is a separate deployment under `site/` and is not a route here.

```mermaid
flowchart TB
  subgraph Reference
    DocsUI["/docs"]
    ChangelogUI["/changelog"]
    Legal["/license · /privacy · /terms · /security"]
  end
  subgraph App
    Dash["/dashboard"]
    Repos["/repos"]
    Repo["/repo/$repoId/*"]
  end
  Dash --> Repos --> Repo
```

| Path | Purpose |
| ---- | ------- |
| `/` | Redirect to `/dashboard` |
| `/docs` · `/changelog` | Reference UI |
| `/license` · `/privacy` · `/terms` · `/security` | Legal and policy pages |
| `/dashboard` | Home base across connected repos |
| `/repos` · `/scans` · `/reports` | Cross-repo lists |
| `/repo/$repoId` | Scan overview |
| `/repo/$repoId/fix` | Fix picker |
| `/repo/$repoId/blockers` | Launch verdict |
| `/repo/$repoId/sandbox` · `/repo/$repoId/runs` | Sandbox trigger + build history |
| `/repo/$repoId/env` | Encrypted env vars |
| `/repo/$repoId/live-security` | Live domain scan |
| `/repo/$repoId/arch` | Architecture analysis |
| `/repo/$repoId/report` | Shareable report |
| `/repo/$repoId/job/$jobId` | Fix job detail |
| `/pr/$repoId` | Public shared launch report |
| `/settings` | Vendor credentials, background monitoring, data, security |

Public product docs UI: `/docs` (in-app help center). `/changelog` is a static list of product
updates, not a content feed. Repo technical docs: `docs/` in git. Marketing pages live in `site/`,
not in this route tree.
