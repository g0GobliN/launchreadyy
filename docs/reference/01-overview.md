# 1. Overview

**LaunchReadyy Community** is self-hosted, open-source software that scans GitHub repositories for
production readiness, scores them, and opens one-click fix PRs. It is built for a single operator
using infrastructure and provider credentials they control.

## Purpose

Close the gap between "AI wrote a working app" and "safe to ship" — tests, CI, Docker, secrets
hygiene, security middleware, and evidence-backed findings.

## Core features

| Feature               | What you get                                              |
| --------------------- | --------------------------------------------------------- |
| Readiness score       | 0–100 with category breakdown                             |
| Production Security   | Secrets, auth gaps, CORS/headers, OSV — with evidence     |
| Live website scan     | Passive checks on domains you confirm you own             |
| One-click fix PRs     | Template + AI-generated files committed via GitHub        |
| Sandbox verify        | E2B install/build/lint/test before/after fixes (optional) |
| Architecture analysis | Import-graph structural audit                             |

## Product components

| Path            | What it is                                                          |
| --------------- | ------------------------------------------------------------------- |
| `src/routes/`   | UI (TanStack Start) — app + reference pages, no auth split          |
| `src/lib/`      | Server logic — scan, fix, sandbox, database                         |
| `src/ai/`       | AI router + providers (deepseek, anthropic, openai, gemini, cursor) |
| `src/db/`       | SQLite schema, migrations, query client                             |
| `launchreadyy/` | E2B sandbox template                                                |
| `rust/`         | Optional indexer crate (WASM)                                       |

Repository:
[github.com/g0GobliN/launchreadyy](https://github.com/g0GobliN/launchreadyy).
