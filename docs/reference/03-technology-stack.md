# 3. Technology Stack

| Layer | Choice |
| ----- | ------ |
| UI | React 19 + TanStack Start / Router / Query |
| Styling | Tailwind CSS 4 + Radix (shadcn-style) |
| Backend | Same repo — server functions + `src/server.ts` |
| Hosting | Local Node.js server |
| Database | SQLite, always local (`data/launchreadyy.db`) |
| Identity | Single operator — GitHub personal access token, no login |
| AI (optional) | DeepSeek, Claude, OpenAI, Gemini, or Cursor — pick one |
| Sandbox (optional) | E2B disposable VMs |
| Tests | Vitest · Playwright smoke |
| Deploy | `npm run build && npm run start` |

Node: `^20.19.0 || >=22.13.0` (see `package.json` `engines`).
