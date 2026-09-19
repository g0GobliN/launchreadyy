# launchreadyy — E2B Sandbox Template

Deep-tier image for LaunchReadyy sandbox verification (install/build/lint) and the whole-repo
secret sweep.

## Prerequisites

- E2B account + `E2B_API_KEY`
- Node.js

## Build

```bash
npm run e2b:build:dev   # or e2b:build:prod
```

Set `E2B_TEMPLATE_ID` in `.env` to the built template id (e.g. `launchreadyy`). Without it the
default e2b base image is used — only Node/Python soft-claims apply; polyglot CLIs are absent.

The build **fails** if a required toolchain doesn't install — a silently missing tool would show
up as a clean scan result rather than as an error.

Analyzers added to this image must be permissively licensed; see
[§19](../docs/reference/19-tool-licensing.md). Semgrep was removed on 2026-08-18.

## What the template installs

| Tool | Source |
| ---- | ------ |
| Poetry, Ruff | pip |
| Node 22.14 + corepack pnpm + bun | `$HOME/.local/node` / `.bun` |
| PHP + Composer + intl/sqlite/mysql/gd | apt |
| libpq / libyaml (Rails native gems) | apt |
| Go 1.22 | `$HOME/go` |
| Rust + wasm-pack + wasm32 | rustup + prebuilt wasm-pack |
| Java 21, Maven, Gradle, Ruby, Erlang, Elixir | mise |
| Bundler | gem |
| .NET 8 SDK | `$HOME/.dotnet` |

After changing this template, rebuild and update `E2B_TEMPLATE_ID` before expecting live verify.

See [docs/guides/production.md](../docs/guides/production.md).
