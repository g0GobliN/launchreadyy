# 8. Identity

There is no login. LaunchReadyy Community is single-operator: whoever runs the process is the
only user, identified by `LOCAL_USER_LOGIN` in config (cosmetic only, never verified) and
authorized to GitHub via a personal access token (`GITHUB_TOKEN`) read server-side.

`src/lib/auth.server.ts` applies ownership guards — `assertRepoOwner`, `assertJobOwner`, and
`assertScanOwner` — even with one identity. They stop a
stale repo id in an old tab from touching another installation's data if two operators ever share
a database, and the rate limiter still protects the operator's own GitHub/E2B/AI accounts from a
retry loop. `requireAuthUser()` always resolves to the local operator; it never fails.

`getLocalUser()` in `github-token.server.ts` is the identity source.
