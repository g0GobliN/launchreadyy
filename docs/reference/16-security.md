# 16. Security

| Area | Approach |
| ---- | -------- |
| Identity | Single local operator — see [§8](08-authentication.md) |
| GitHub token | `.env`/`data/config.json` only, never sent to the browser — [§15](15-environment-variables.md) |
| Secrets in logs | Sandbox redactor before persist/UI |
| Live site | Passive probes; bodies not downloaded on sensitive paths |
| Env vars UI | AES-256-GCM at rest, write-only after save |
| Background GitHub token | Reads the operator's `GITHUB_TOKEN` from local configuration at execution time |

## GitHub credential for background monitoring

Scheduled monitoring ([§18](18-monitoring.md)) runs with no request in flight, so each job reads
the operator's `GITHUB_TOKEN` from local configuration at execution time. The token is never put
in a job payload or stored in SQLite. A 401/403 disables monitoring until the operator fixes the
credential and enables monitoring again.

## Known soft spots

- Multi-agent AI flag off until validated; Semgrep off on licensing grounds — [§19](19-tool-licensing.md).
- Non-image sandbox ecosystems soft-skip (not fail closed).
- No rotation reminder for a long-lived `GITHUB_TOKEN` — that's on the operator, same as any personal access token.
