# Appendix A — NPM scripts

Every command in `package.json`, in the order they are useful, with the prerequisites that make
them fail. Commands that need an external tool check for it first (`scripts/preflight.mjs`, wired
through npm `pre*` hooks) and print what is missing, so a failure names the cause instead of a stack
trace from inside a dependency.

A one-time prerequisite for a full local setup:

```bash
nvm use                        # Node 22 (.nvmrc); engines requires ^20.19 or >=22.13
npm install
npx playwright install chromium # only for test:e2e:smoke
```

The readiness indexer is a Rust crate compiled to WebAssembly, and `rust/crates/indexer/pkg/` is
build output. `npm run build` builds it when it is missing or stale, and `npm run typecheck` needs
it to exist — see `scripts/ensure-wasm.mjs`.

## Everyday

| Script | Purpose | Needs |
| ------ | ------- | ----- |
| `npm run dev` | Vite dev server (default `http://localhost:5174`) | Node 22, indexer artifact |
| `npm run build` | Build the indexer, the app, and the CLI | Rust + wasm-pack |
| `npm run start` | Run the built server (`dist/server/server.js`) | `npm run build` first |
| `npm run preview` | Serve the production build | `npm run build` first |
| `npm run lint` | ESLint over the repository | — |
| `npm run typecheck` | `tsc --noEmit` | indexer artifact |
| `npm test` | Vitest unit suite | — |
| `npm run format` | Prettier over code; docs, fixtures, and the scan baseline are excluded | — |

## Gates CI runs

| Script | Purpose | Needs |
| ------ | ------- | ----- |
| `npm run test:fixtures` | Fixture matrix plus the minimal-fixture smoke check | — |
| `npm run test:production-start` | Boots the built server and asserts it answers | `npm run build` first |
| `npm run docs:check` | Fails when `FULL_DOCUMENTATION.md` has drifted | — |
| `npm run verify:licensing` | Fails when LICENSE/NOTICE/TRADEMARKS or manifest license metadata drifts | — |
| `npm run rust:test` | Rust crate tests | Rust |
| `npm run rust:build` | Native indexer used by the parity suites and benchmarks | Rust |
| `npm run wasm:build` | WebAssembly indexer artifact | Rust + wasm-pack |

## Optional: verification and audits

These are not part of `npm test`. They run real toolchains and take minutes.

| Script | Purpose | Needs |
| ------ | ------- | ----- |
| `npm run test:e2e:smoke` | Playwright smoke test of the running app | Playwright's Chromium (`npx playwright install chromium`) |
| `npm run verify:tools` | Generates CI/Dockerfile fixes into real cloned repositories and executes them | Docker, network, `.scratch/real-fixtures` populated, up to ~15 min for the first case per language, much less once cached — add `-- --reporter=verbose` to see which case is running |
| `npm run verify:mobile` | Scans generated native-mobile, Ktor, and Dart projects and reports what the scanner got wrong | ~4 min, no external services |

### Caching in `verify:tools`

Each case runs in a container that is created and destroyed, so three things are cached between
runs: the images, each language's dependency downloads, and the `docker build` layers. A cold first
run is the slow one; every later run reuses what it fetched.

| Cache | Held in | Dropped by |
| ----- | ------- | ---------- |
| Dependency downloads (npm, pip, Go modules, cargo, Maven, Gradle, NuGet, hex, Composer, gems) | Docker named volumes named `lr-audit-cache-*` | `LR_AUDIT_CACHE_RESET=1` |
| Toolchain images | Docker's image store, pulled once per run before the first case | `docker image rm` |
| `docker build` layers | Docker's build cache, importable from `.scratch/docker-build-cache` | `docker builder prune`, or deleting that directory |

Switches, all defaulting to the cached behaviour:

- `LR_AUDIT_CACHE=0` — no toolchain cache volumes.
- `LR_AUDIT_BUILD_CACHE=off|read|read-write` — the build layer cache. `read` (the default) imports
  the durable copy if it exists; `read-write` also exports it, so running once with `read-write`
  creates a cache that survives `docker builder prune` and a fresh CI machine.
- `LR_AUDIT_WARM=0` — skip the up-front image pull. Filtered runs (`-- -t "eslint"`) want this:
  otherwise they pull every language's images for the sake of one case.
- `LR_AUDIT_PULL=0` — no pulls in the harness at all.

## Optional: sandbox template

| Script | Purpose | Needs |
| ------ | ------- | ----- |
| `npm run e2b:build:dev` | Build the E2B template with development settings | `E2B_API_KEY` |
| `npm run e2b:build:prod` | Build the E2B template for production | `E2B_API_KEY` |

Sandbox verification is optional. Without a key, scans and fixes still run and verification reports
itself as skipped.

## Benchmarks

| Script | Purpose | Needs |
| ------ | ------- | ----- |
| `npm run bench:indexer` | In-memory TypeScript vs Rust indexing | indexer artifact |
| `npm run bench:imports` | Import extraction: Rust vs the TypeScript reference | `npm run rust:build` |
| `npm run bench:indexer:disk` | Disk traversal plus indexing, TypeScript vs Rust | `npm run rust:build` |

## Documentation

| Script | Purpose |
| ------ | ------- |
| `npm run docs:build` | Regenerate `docs/FULL_DOCUMENTATION.md` from `docs/reference/` |
| `npm run docs:check` | Fail if that file drifted (CI runs this) |

## Not commands

`scripts/preflight.mjs` is invoked by the `pre*` hooks (`predev`, `prebuild`, `pretest`,
`prelint`, `pretest:e2e:smoke`, `preverify:tools`, `pree2b:build:dev`, `pree2b:build:prod`), which
is why they show up in `npm run`. They exist to turn three specific failures into instructions:
Node too old, Playwright's browser missing, Docker unavailable, `E2B_API_KEY` unset.
