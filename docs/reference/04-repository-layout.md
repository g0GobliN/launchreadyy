# 4. Repository Layout

```
src/
  routes/           Page routes (file-based) — app + reference, no auth split
    repo.$repoId.*  Per-repo scan / fix / sandbox / report
  components/       React UI
  ai/               Router + providers + agents
  db/               SQLite schema, migrations, query client
  lib/              Server domain logic
    scan-engine/    Fetch tree + runScan
    scanner/        Security + AST + integrations
    readiness/      Score + categories
    sandbox/        Commands, env, redaction
    sandbox-verify/ Job + verify-before-PR
    fix-executor/   Templates + PR open
    api/            createServerFn modules
    jobs.server.ts  Durable queue
    node-server.server.ts  Node HTTP front end (static files + SSR)
  cli/              `launchreadyy` CLI (setup, doctor, start, config)
launchreadyy/       E2B template build
rust/               Indexer crate (optional)
scripts/            verify tools, docs build, benches
docs/
  README.md         Docs hub (start here)
  reference/        Wiki chapters (source of truth)
  guides/           Procedures
  FULL_DOCUMENTATION.md  Generated — do not edit
```

Do not hand-edit `src/routeTree.gen.ts` — TanStack regenerates it.
