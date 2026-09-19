# 6. Backend

## Entry point (`src/server.ts`)

A single `handleRequest(request: Request): Promise<Response>` — the only export. It boots the
background halves (scheduler + job worker) on first call, then runs the request through
TanStack Start SSR. `node-server.server.ts` is what actually calls it: it serves `dist/client`
directly for static assets and hands everything else to `handleRequest`. See
[§2](02-system-architecture.md).

There is no separate queue consumer or scheduled-function entry point — the in-process poll loop
in `src/lib/jobs.server.ts` drains durable jobs and covers repo/live-site monitoring
([§18](18-monitoring.md)) on its own timer.

## Server functions

Business logic is exposed via `createServerFn` in `src/lib/api/*.functions.ts`, which call
`*.server.ts` modules. See [§14 API](14-api.md).

## Errors

Thrown errors from server functions surface as UI errors. There's no separate runtime normalizing
error responses — Node's own error handling in `node-server.server.ts` and TanStack Start's SSR
error boundary cover it.
