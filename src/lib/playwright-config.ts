import type { ProjectLanguage } from "./project-context.server";
import type { LanguageManifests } from "./project-context.server";
import type { DetectedRepoStack } from "./language-setup";
import { resolveLanguageWebCommand } from "./web-playwright";

export const PLAYWRIGHT_TEST_VERSION = "^1.61.1";

export const MINIMAL_PLAYWRIGHT_PACKAGE = {
  private: true,
  scripts: { "test:e2e": "playwright test" },
} as const;

const CONFIG_PATH_PATTERNS = [
  /^vite\.config\.(ts|js|mts|mjs|cjs)$/i,
  /^next\.config\.(ts|js|mts|mjs|cjs)$/i,
  /^nuxt\.config\.(ts|js|mts|mjs|cjs)$/i,
  /^astro\.config\.(ts|js|mts|mjs|cjs)$/i,
  /^svelte\.config\.(ts|js|mts|mjs|cjs)$/i,
  /^remix\.config\.(ts|js|mts|mjs|cjs)$/i,
  /^angular\.json$/i,
];

const PREFERRED_DEV_SCRIPTS = [
  "dev:vite",
  "dev:web",
  "dev:client",
  "dev:frontend",
  "dev:app",
  "dev:next",
  "dev:nuxt",
  "dev:remix",
  "dev:astro",
  "electron:dev",
  "tauri:dev",
  "expo:web",
  "web",
  "start:dev",
  "serve",
  "dev",
  "start",
] as const;

const FRAMEWORK_DEFAULT_PORTS: Record<string, number> = {
  Vite: 5173,
  React: 5173,
  "Next.js": 3000,
  Nuxt: 3000,
  Angular: 4200,
  Astro: 4321,
  Remix: 3000,
  SvelteKit: 5173,
  Express: 3000,
  Fastify: 3000,
  NestJS: 3000,
  Electron: 5173,
  Tauri: 1420,
  Expo: 8081,
  "React Native": 8081,
};

export interface PlaywrightTarget {
  port: number;
  baseUrl: string;
  devScript: string;
  runCommand: string;
}

export interface PlaywrightConfigInput {
  packageManager?: "npm" | "pnpm" | "yarn" | "bun";
  framework?: string;
  language?: ProjectLanguage;
  isNodeProject?: boolean;
  stack?: DetectedRepoStack;
  manifests?: Partial<LanguageManifests>;
  scripts?: Record<string, string>;
  filePaths?: string[];
  configFiles?: Record<string, string>;
  envExample?: string;
  mergedDeps?: Record<string, string>;
}

export function pickPlaywrightConfigPaths(filePaths: string[]): string[] {
  const matches = filePaths.filter((p) => {
    const base = p.split("/").pop() ?? p;
    return CONFIG_PATH_PATTERNS.some((re) => re.test(base));
  });
  if (matches.length === 0) return [];

  const score = (p: string): number => {
    let s = 0;
    if (/(^|\/)apps\/[^/]+\//.test(p)) s += 20;
    if (/(^|\/)packages\/(web|frontend|app|client)\//.test(p)) s += 18;
    if (p.includes("vite.config")) s += 10;
    if (p.includes("next.config")) s += 8;
    s -= p.split("/").length;
    return s;
  };

  return [...matches].sort((a, b) => score(b) - score(a));
}

function firstPortMatch(text: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const port = Number.parseInt(m[1], 10);
      if (port > 0 && port < 65536) return port;
    }
  }
  return null;
}

export function parsePortFromText(text: string): number | null {
  return firstPortMatch(text, [
    /\bport\s*[:=]\s*(\d{2,5})\b/i,
    /["']port["']\s*:\s*(\d{2,5})/i,
    /\blisten\s*\(\s*(\d{2,5})\s*[,)]/i,
    /\bPORT\s*=\s*(\d{2,5})\b/,
    /--port(?:=|\s+)(\d{2,5})\b/,
    /(?:^|\s)-p\s+(\d{2,5})\b/,
  ]);
}

function parsePortFromScripts(scripts: Record<string, string>): number | null {
  for (const script of Object.values(scripts)) {
    const port = parsePortFromText(script);
    if (port) return port;
  }
  return null;
}

function parsePortFromConfigFiles(configFiles: Record<string, string>): number | null {
  for (const [path, content] of Object.entries(configFiles)) {
    const port = parsePortFromText(content);
    if (port) return port;
    if (/angular\.json$/i.test(path)) {
      try {
        const json = JSON.parse(content) as {
          projects?: Record<string, { architect?: { serve?: { options?: { port?: number } } } }>;
        };
        for (const project of Object.values(json.projects ?? {})) {
          const p = project.architect?.serve?.options?.port;
          if (typeof p === "number" && p > 0) return p;
        }
      } catch {
        /* ignore invalid json */
      }
    }
  }
  return null;
}

function frameworkDefaultPort(
  framework: string | undefined,
  configFiles: Record<string, string>,
): number {
  if (framework && FRAMEWORK_DEFAULT_PORTS[framework]) return FRAMEWORK_DEFAULT_PORTS[framework];

  const names = Object.keys(configFiles)
    .map((p) => p.split("/").pop() ?? p)
    .join(" ")
    .toLowerCase();
  if (names.includes("vite.config")) return 5173;
  if (names.includes("next.config")) return 3000;
  if (names.includes("nuxt.config")) return 3000;
  if (names.includes("astro.config")) return 4321;
  if (names.includes("angular.json")) return 4200;
  if (names.includes("remix.config")) return 3000;
  return 3000;
}

export function isCompositeDevScript(script: string): boolean {
  return /concurrently|npm-run-all|run-p\b|run-s\b|turbo\s+run|nx\s+run|&&|\s&\s|\|\|/i.test(
    script,
  );
}

function isProductionStartScript(script: string): boolean {
  return /next\s+start|vite\s+preview|nuxt\s+start|node\s+dist|serve\s+-s|http-server\s+dist/i.test(
    script,
  );
}

function hasE2eBlockingSidecar(script: string): boolean {
  return /stripe\s+listen|docker\s+compose|docker-compose|supabase\s+start|firebase\s+emulators/i.test(
    script,
  );
}

/** Web server for Playwright — must boot without Stripe/Docker sidecars. */
export function resolveWebServerScript(scripts: Record<string, string>): string {
  const dev = scripts.dev;
  if (dev && (isCompositeDevScript(dev) || hasE2eBlockingSidecar(dev))) {
    for (const name of PREFERRED_DEV_SCRIPTS) {
      if (name === "dev" || name === "start") continue;
      const cmd = scripts[name];
      if (cmd && !isCompositeDevScript(cmd) && !hasE2eBlockingSidecar(cmd)) return name;
    }
    const devScoped = Object.keys(scripts)
      .filter((k) => k.startsWith("dev:"))
      .sort();
    for (const name of devScoped) {
      const cmd = scripts[name]!;
      if (!isCompositeDevScript(cmd) && !hasE2eBlockingSidecar(cmd)) return name;
    }
  }
  return resolveDevScript(scripts);
}

export function resolveDevScript(scripts: Record<string, string>): string {
  // Use the repo's primary dev script when present — matches how teams actually run the app.
  if (scripts.dev && !isProductionStartScript(scripts.dev)) return "dev";

  for (const name of PREFERRED_DEV_SCRIPTS) {
    if (name === "dev" || name === "start") continue;
    const cmd = scripts[name];
    if (!cmd || isCompositeDevScript(cmd)) continue;
    return name;
  }

  const devScoped = Object.keys(scripts)
    .filter((k) => k.startsWith("dev:"))
    .sort();
  for (const name of devScoped) {
    if (!isCompositeDevScript(scripts[name]!)) return name;
  }

  if (scripts.start && !isProductionStartScript(scripts.start)) return "start";
  return "dev";
}

export function scriptRunCommand(
  packageManager: PlaywrightConfigInput["packageManager"],
  devScript: string,
): string {
  const pm = packageManager ?? "npm";
  if (pm === "npm") {
    if (devScript === "start" || devScript === "test") return `npm ${devScript}`;
    return `npm run ${devScript}`;
  }
  if (pm === "yarn") return `yarn ${devScript}`;
  if (pm === "pnpm") return `pnpm ${devScript}`;
  return `bun run ${devScript}`;
}

export function resolvePlaywrightTarget(input: PlaywrightConfigInput): PlaywrightTarget {
  const scripts = input.scripts ?? {};
  const configFiles = input.configFiles ?? {};
  const hasNodeScripts = Object.keys(scripts).some((k) => Boolean(scripts[k]?.trim()));
  const useLanguageCommand = input.language && input.language !== "node" && !hasNodeScripts;

  let devScript = resolveWebServerScript(scripts);
  let runCommand: string;
  let langPort: number | null = null;

  if (useLanguageCommand) {
    const lang = resolveLanguageWebCommand({
      language: input.language!,
      filePaths: input.filePaths ?? [],
      framework: input.framework ?? "unknown",
      manifests: input.manifests,
      envExample: input.envExample,
    });
    devScript = "serve";
    runCommand = lang.command;
    langPort = lang.port;
  } else {
    runCommand = scriptRunCommand(input.packageManager, devScript);
  }

  const port =
    parsePortFromConfigFiles(configFiles) ??
    parsePortFromScripts(scripts) ??
    (input.envExample ? parsePortFromText(input.envExample) : null) ??
    langPort ??
    frameworkDefaultPort(input.framework, configFiles);

  const baseUrl = `http://localhost:${port}`;

  return { port, baseUrl, devScript, runCommand };
}

export function minimalPlaywrightPackageJson(mergedDeps?: Record<string, string>): string {
  return (
    JSON.stringify(
      {
        ...MINIMAL_PLAYWRIGHT_PACKAGE,
        devDependencies: {
          "@playwright/test": playwrightTestDevDepVersion(mergedDeps),
        },
      },
      null,
      2,
    ) + "\n"
  );
}

export function playwrightTestDevDepVersion(mergedDeps?: Record<string, string>): string {
  const existing = mergedDeps?.["@playwright/test"] ?? mergedDeps?.playwright;
  if (existing) {
    const semver = existing.replace(/^[\^~>=<]+/, "");
    const exact = semver.match(/^(\d+\.\d+\.\d+)/);
    if (exact) return `^${exact[1]}`;
    const minor = semver.match(/^(\d+\.\d+)/);
    if (minor) return `^${minor[1]}.0`;
  }
  return PLAYWRIGHT_TEST_VERSION;
}

/** Build config input from AI fetch / project-context file maps. */
export function playwrightInputFromFiles(files: Record<string, string>): PlaywrightConfigInput {
  let scripts: Record<string, string> = {};
  let mergedDeps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(files["package.json"] ?? "{}") as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    scripts = pkg.scripts ?? {};
    mergedDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    /* ignore */
  }

  const filePaths = files["__file_paths"]?.split("\n").filter(Boolean) ?? Object.keys(files);
  const configPaths = new Set(pickPlaywrightConfigPaths(filePaths));
  const configFiles: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (configPaths.has(path) || pickPlaywrightConfigPaths([path]).length > 0) {
      configFiles[path] = content;
    }
  }

  const pm = files["__package_manager"];
  const packageManager =
    pm === "pnpm" || pm === "yarn" || pm === "bun" || pm === "npm" ? pm : undefined;

  return {
    packageManager,
    framework: files["__framework"],
    language: (files["__language"] as ProjectLanguage | undefined) ?? "node",
    isNodeProject: files["__is_node_project"] === "true" || Boolean(files["package.json"]),
    scripts,
    filePaths,
    configFiles,
    envExample: files[".env.example"],
    mergedDeps,
  };
}

export function buildPlaywrightConfig(input: PlaywrightConfigInput = {}): string {
  const target = resolvePlaywrightTarget(input);

  return `import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.BASE_URL ?? "${target.baseUrl}",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "${target.runCommand}",
    url: "${target.baseUrl}",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
`;
}
