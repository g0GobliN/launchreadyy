import { NodePm, PmDockerCommands } from "../shared/types";

export const PM_DOCKER_COMMANDS: Record<NodePm, PmDockerCommands> = {
  pnpm: {
    lockfileFiles: ["package.json", "pnpm-lock.yaml*"],
    // Two compounding issues confirmed in testing: (1) bare `corepack enable` lets Corepack
    // fetch whatever pnpm major is latest at build time — the current latest (11.x) requires
    // Node >= 22 and hard-crashes on the node:20 base image below, so pin a Node-18+-compatible
    // version; (2) `corepack prepare` caches under $HOME/.cache, and it runs as root here but
    // CMD later runs as the non-root `app` user (different $HOME) — without a shared
    // COREPACK_HOME, the pin is invisible at container startup and corepack silently re-resolves
    // latest again, right back into problem (1). Point both at the same shared location.
    setupLine:
      "ENV COREPACK_HOME=/opt/corepack\nRUN corepack enable && corepack prepare pnpm@9 --activate && chmod -R a+rX /opt/corepack\n",
    install: "pnpm install --frozen-lockfile",
    installProd: "pnpm install --frozen-lockfile --prod",
    run: (s) => `pnpm run ${s}`,
    startCmd: '["pnpm", "start"]',
  },
  yarn: {
    lockfileFiles: ["package.json", "yarn.lock*"],
    setupLine:
      "ENV COREPACK_HOME=/opt/corepack\nRUN corepack enable && mkdir -p /opt/corepack && chmod -R a+rX /opt/corepack\n",
    install: "yarn install --frozen-lockfile",
    installProd: "yarn install --frozen-lockfile --production",
    run: (s) => `yarn ${s}`,
    startCmd: '["yarn", "start"]',
  },
  bun: {
    lockfileFiles: ["package.json", "bun.lock*", "bun.lockb*"],
    setupLine: "RUN npm install -g bun\n",
    install: "bun install --frozen-lockfile",
    installProd: "bun install --frozen-lockfile --production",
    run: (s) => `bun run ${s}`,
    startCmd: '["bun", "start"]',
  },
  npm: {
    lockfileFiles: ["package*.json"],
    setupLine: "",
    // "npm" is also what packageManager detection falls through to when a repo commits NO
    // lockfile at all (confirmed by real docker build: vercel/next.js's hello-world example
    // ships without one, and `npm ci` hard-fails with usage help when package-lock.json is
    // missing). Branch on the file at build time instead of `npm ci || npm install`, so a real
    // out-of-sync lockfile still fails loudly rather than silently installing mismatched deps.
    install: "if [ -f package-lock.json ]; then npm ci; else npm install; fi",
    installProd:
      "if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi",
    run: (s) => `npm run ${s}`,
    startCmd: '["npm", "start"]',
  },
};

export function pmDockerCommands(pm: NodePm): PmDockerCommands {
  return PM_DOCKER_COMMANDS[pm] ?? PM_DOCKER_COMMANDS.npm;
}

export function copyLockfiles(c: PmDockerCommands): string {
  return `COPY ${c.lockfileFiles.join(" ")} ./`;
}

export function copyLockfilesFrom(c: PmDockerCommands, stage: string): string {
  return `COPY --from=${stage} ${c.lockfileFiles.map((f) => `/app/${f}`).join(" ")} ./`;
}

export function dockerfileNode(pm: NodePm): string {
  const c = pmDockerCommands(pm);
  return `FROM node:20-alpine AS build
WORKDIR /app
${c.setupLine}${copyLockfiles(c)}
RUN ${c.install}
COPY . .
RUN ${c.run("build")}

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Non-root user for security
RUN (getent group app || addgroup -S app) && (getent passwd app || adduser -S app -G app)
${c.setupLine}${copyLockfilesFrom(c, "build")}
RUN ${c.installProd}
COPY --from=build /app/dist ./dist
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3000/health || exit 1
CMD ${c.startCmd}
`;
}

export function dockerfileNodeRuntime(pm: NodePm): string {
  const c = pmDockerCommands(pm);
  return `FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN (getent group app || addgroup -S app) && (getent passwd app || adduser -S app -G app)
${c.setupLine}${copyLockfiles(c)}
RUN ${c.install}
COPY . .
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3000/health || exit 1
CMD ${c.startCmd}
`;
}

export function dockerfileNextjs(pm: NodePm): string {
  const c = pmDockerCommands(pm);
  return `FROM node:20-alpine AS deps
WORKDIR /app
${c.setupLine}${copyLockfiles(c)}
RUN ${c.install}

FROM node:20-alpine AS builder
WORKDIR /app
${c.setupLine}COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/ is optional (a minimal or API-only Next.js app may not ship one) — the runner stage
# below always copies it, so it must exist even when empty or that COPY fails the whole build.
RUN mkdir -p public
# Next evaluates route modules at build time. Module-scope SDK clients (Stripe, Supabase, …)
# throw on empty API keys. Seed non-empty placeholders so \`next build\` can collect page data;
# real secrets must still be injected at runtime by the host/platform.
ENV STRIPE_SECRET_KEY=sk_test_build_placeholder \\
    STRIPE_WEBHOOK_SECRET=whsec_build_placeholder \\
    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \\
    NEXT_PUBLIC_SUPABASE_ANON_KEY=build-placeholder \\
    SUPABASE_SERVICE_ROLE_KEY=build-placeholder \\
    NEXT_PUBLIC_SITE_URL=http://localhost:3000 \\
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_build_placeholder
RUN ${c.run("build")}

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Non-root user for security
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
`;
}

export function dockerfileVite(pm: NodePm): string {
  const c = pmDockerCommands(pm);
  return `FROM node:20-alpine AS build
WORKDIR /app
${c.setupLine}${copyLockfiles(c)}
RUN ${c.install}
COPY . .
RUN ${c.run("build")}

FROM nginx:alpine
# Non-root nginx
RUN addgroup -S web && adduser -S web -G web
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN chown -R web:web /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
`;
}

export const DOCKER_IGNORE = `node_modules
.git
.env
.env.local
.env.development
.env.production
.env.test
# Keep *.example env files — Next.js build uses them for non-secret placeholders.
dist
build
coverage
tests
e2e
.github
*.log
*.md
Dockerfile*
`;
