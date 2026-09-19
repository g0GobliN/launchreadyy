# Security Policy

## Reporting a vulnerability

Open a **private** security advisory: GitHub → **Security** → **Advisories** → _Report a
vulnerability_ on this repository. That is the fastest route and keeps the report private until
there is a fix.

Please include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- The commit you tested against

There is no bug bounty and no guaranteed response time — this is a single-maintainer project, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Scope

This project is **self-hosted**: every deployment is the operator's own, on their own machine,
with their own credentials. So the interesting vulnerabilities are ones that break a trust
boundary the design actually claims:

- **SSRF or sandbox escape** from repository-controlled content (a malicious repo, branch name,
  or file name reaching somewhere it should not)
- **Secret disclosure** — leaking `GITHUB_TOKEN`, `SESSION_SECRET`, `ENV_VAR_ENCRYPTION_SECRET`, project env vars
  or scan payloads into the browser bundle, logs, findings, or evidence
- **Injection** through repo file names, branches, diffs, or scan payloads
- **Fix-PR pipeline** opening a pull request that contains something other than the reviewed diff

Out of scope, because they are the operator's responsibility by design:

- Anyone who can reach the app can use it. There is no login. Exposing it publicly without a
  reverse proxy in front is a deployment choice, not a vulnerability — see
  [§8 Identity and configuration](docs/reference/08-authentication.md).
- Costs incurred at your own vendors (AI tokens, e2b sandbox minutes)
- The contents of your own `.env`

## Deployment hardening

- `SESSION_SECRET` and `ENV_VAR_ENCRYPTION_SECRET` are server-only.
  Never move one to a `VITE_` name — `VITE_*` values ship to the browser.
- The local SQLite database holds all application data. Treat access to the data directory as
  access to everything scanned.
- The database file is local: enable backups, and treat access to it as access to
  everything scanned.
- Put a reverse proxy or VPN in front of the app if it is not localhost-only.
- Rate limits (`src/lib/rate-limit.server.ts`) are per-instance and in-memory; they bound runaway
  loops, not abuse.
- Rotate `GITHUB_TOKEN` at github.com/settings/tokens if it is ever exposed — revocation takes
  effect on the next API call.

## Supported versions

Single-branch project: the latest `main` is the only supported version.
