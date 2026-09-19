# Guide — Operations

## Health

- `launchreadyy doctor` — runtime, config, database, and security checks in one command
- Node.js process logs (stdout) for job worker and scheduler activity

## Cost control

There's no bill from LaunchReadyy to control — you pay GitHub (free), and optionally E2B and your
AI provider, directly at their own rates. The only knobs:

- `SANDBOX_MAX_CONCURRENT` — caps how many sandboxes run at once, protecting your E2B account
  from a burst of enqueued verifications ([§12](../reference/12-sandbox.md))
- Unset `AI_PROVIDER`/`E2B_API_KEY` entirely to disable those features and their spend

Kill switches: feature flags in `src/lib/feature-flags.ts` (`flag_ai_fixes`,
`flag_sandbox_verify`, `flag_repo_monitoring`, …), editable as `site_config` rows.

## Common checks

| Symptom | Look at |
| ------- | ------- |
| Scans stuck | `background_jobs` table (status/attempts/last_error), job worker logs |
| Sandbox skipped | `E2B_API_KEY` set? Check the run's skip reason — no key vs. unsupported ecosystem |
| AI failing | `AI_PROVIDER` and its matching key in `.env`; `launchreadyy doctor` reports "no API key" |
| Repo monitoring not firing | `GITHUB_TOKEN` valid? [§16](../reference/16-security.md) covers how the token reaches the scheduler |
| Fix PR blocked | verify-before-PR logs on the job page |

## Maintenance

- Sandbox run records are purged on a retention schedule (`retention.server.ts`)
- Rotate `SESSION_SECRET` / `ENV_VAR_ENCRYPTION_SECRET` carefully — rotating the latter makes
  previously saved project env vars unreadable
- Back up `data/launchreadyy.db` like any other application state
