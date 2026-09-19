# 15. Environment Variables

Source of truth: [`.env.example`](../../.env.example) — every variable is documented there inline,
including which are required vs. optional and what happens when an optional one is unset.
`launchreadyy setup` writes `.env` for you; `launchreadyy doctor` flags conflicting values.
Precedence between `.env` and `data/config.json` is documented at the top of
`.env.example`.

## Required

| Variable | Role |
| -------- | ---- |
| `SESSION_SECRET` | Signs local sessions |
| `ENV_VAR_ENCRYPTION_SECRET` | Encrypts saved project env vars at rest — required if you use sandbox verification with project env vars |
| `GITHUB_TOKEN` | Personal access token (`repo`, `read:user`, `workflow`) — the only thing required for repository features |

## Optional — everything else degrades to "disabled," never to an error

| Variable | Role |
| -------- | ---- |
| `APP_URL` / `VITE_APP_URL` / `HOST` / `PORT` | Where this installation is reachable and binds |
| `LOCAL_USER_LOGIN` / `LOCAL_USER_EMAIL` / `LOCAL_USER_AVATAR_URL` | Cosmetic display identity |
| `E2B_API_KEY` / `E2B_TEMPLATE_ID` | Sandbox verification — unset means sandbox steps report as skipped |
| `AI_PROVIDER` + one of `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `CURSOR_API_KEY` | AI-generated fixes/tests/explanations — unset means deterministic-only |
| `CLAUDE_MODEL` / `CLAUDE_FAST_MODEL` / `CLAUDE_OPUS_MODEL` / `DEEPSEEK_MODEL` / etc. | Model overrides per provider |
| `SANDBOX_MAX_CONCURRENT` | Maximum simultaneous sandbox runs — [§12](12-sandbox.md) |
| `RATE_LIMIT_DISABLED` | Set to `1` to disable rate limiting (trusted local demo only) |
| `PUBLIC_GITHUB_URL` / `VITE_PUBLIC_GITHUB_URL` / `PUBLIC_APP_URL` | Public metadata for marketing pages and shared launch report links |
