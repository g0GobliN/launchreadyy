/**
 * Deep code intelligence — reads source files to understand structure,
 * env contracts, integrations, and monorepo layout. Feeds CI, AI tools, and fixes.
 */

export type EnvPhase = "build" | "test" | "runtime";

export interface EnvVarRef {
  name: string;
  phases: EnvPhase[];
  files: string[];
}

export interface EnvContract {
  build: string[];
  test: string[];
  runtime: string[];
  all: string[];
  refs: EnvVarRef[];
}

export type PackageKind = "frontend" | "backend" | "library" | "unknown";

export interface WorkspacePackage {
  dir: string;
  name: string;
  kind: PackageKind;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  hasLint: boolean;
  hasTest: boolean;
  hasBuild: boolean;
  lockfile?: "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock" | "bun.lockb";
}

export interface IntegrationGraph {
  stripe: boolean;
  firebase: boolean;
  supabase: boolean;
  prisma: boolean;
  auth: boolean;
  hasWebhooks: boolean;
  signals: string[];
}

export interface CodeStructure {
  entryPoints: string[];
  routePaths: string[];
  apiPaths: string[];
  componentPaths: string[];
}

export interface CodeSample {
  path: string;
  excerpt: string;
}

export interface ProjectIntelligence {
  monorepo: boolean;
  packages: WorkspacePackage[];
  envContract: EnvContract;
  integrations: IntegrationGraph;
  structure: CodeStructure;
  codeSamples: CodeSample[];
  runtimeModel: "static-spa" | "fullstack" | "api-backend" | "monorepo" | "library" | "unknown";
}

const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/;
const SKIP_PATH = /node_modules|dist\/|build\/|\.next\/|coverage\/|(^|\/)(\.git|vendor)\//;
const TODO_SAMPLE = /\.(test|spec)\.|\.d\.ts$|(^|\/)(__tests__|tests|e2e)\//;

const VITE_ENV_RE = /import\.meta\.env\.([A-Z0-9_]+)/g;
const NEXT_PUBLIC_RE = /process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g;
const PROCESS_ENV_RE = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
const PROCESS_ENV_BRACKET_RE = /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]]/g;

// Typed-env-schema pattern (zod, etc.): the whole `process.env` object is validated in one shot
// (e.g. `envSchema.parse(process.env)`), so individual var names never appear as a
// `process.env.NAME` property access anywhere in the file — every regex above sees nothing.
// Confirmed against a real repo (w3cj/express-api-starter-ts's src/env.ts): NODE_ENV and PORT
// are real, validated env vars, but PROCESS_ENV_RE matches zero names there, because the schema
// only ever receives `process.env` as a whole object. Detect the `.parse(process.env)` /
// `.safeParse(process.env)` call, then pull key names out of `z.object({ ... })` literals in the
// same file (schema and parse call are almost always co-located in one small env file).
const TYPED_ENV_PARSE_RE = /\.(?:parse|safeParse)\(\s*process\.env\s*\)/;
const ZOD_OBJECT_RE = /z\.object\(\{([\s\S]*?)\}\)/g;

function scanTypedEnvSchemaKeys(content: string): string[] {
  if (!TYPED_ENV_PARSE_RE.test(content)) return [];
  const keys: string[] = [];
  for (const m of content.matchAll(ZOD_OBJECT_RE)) {
    for (const km of m[1]!.matchAll(/^\s*([A-Z_][A-Z0-9_]*)\s*:/gm)) {
      keys.push(km[1]!);
    }
  }
  return keys;
}

const INTEGRATION_DEPS: Record<keyof Omit<IntegrationGraph, "signals" | "hasWebhooks">, string[]> =
  {
    stripe: ["stripe", "@stripe/stripe-js", "@stripe/react-stripe-js"],
    firebase: ["firebase", "firebase-admin", "@firebase/app"],
    supabase: ["@supabase/supabase-js", "@supabase/auth-helpers-nextjs"],
    prisma: ["@prisma/client", "prisma"],
    auth: ["next-auth", "@clerk/nextjs", "@auth/core", "passport", "jsonwebtoken"],
  };

function parsePkgJson(raw: string): {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  try {
    return JSON.parse(raw) as ReturnType<typeof parsePkgJson>;
  } catch {
    return {};
  }
}

export function detectWorkspacePackages(filePaths: string[]): string[] {
  return filePaths
    .filter((p) => p.endsWith("package.json") && !p.includes("node_modules"))
    .map((p) => (p === "package.json" ? "." : p.replace(/\/package\.json$/, "")))
    .sort((a, b) => a.split("/").length - b.split("/").length);
}

function inferPackageKind(
  dir: string,
  deps: Record<string, string>,
  filePaths: string[],
): PackageKind {
  const prefix = dir === "." ? "" : `${dir}/`;
  const local = filePaths.filter((p) => p.startsWith(prefix) || dir === ".");
  const all = { ...deps };
  if (all.express || all.fastify || all["@nestjs/core"] || all.hono) return "backend";
  if (
    local.some(
      (p) => /(^|\/)server\.(ts|js)$/.test(p) || (/(^|\/)index\.(ts|js)$/.test(p) && all.express),
    )
  )
    return "backend";
  if (all.vite || all.react || all.next || local.some((p) => /vite\.config\./.test(p)))
    return "frontend";
  if (all["react-native"]) return "frontend";
  if (Object.keys(all).length <= 2 && all.typescript) return "library";
  return "unknown";
}

function detectLockfile(dir: string, filePaths: string[]): WorkspacePackage["lockfile"] {
  const prefix = dir === "." ? "" : `${dir}/`;
  if (filePaths.includes(`${prefix}pnpm-lock.yaml`)) return "pnpm-lock.yaml";
  if (filePaths.includes(`${prefix}yarn.lock`)) return "yarn.lock";
  if (filePaths.includes(`${prefix}bun.lockb`) || filePaths.includes(`${prefix}bun.lock`))
    return "bun.lockb";
  if (filePaths.includes(`${prefix}package-lock.json`)) return "package-lock.json";
  return undefined;
}

export function isRealTestScript(test?: string): boolean {
  if (!test?.trim()) return false;
  if (/no test specified/i.test(test)) return false;
  if (/^echo\s+/i.test(test)) return false;
  return true;
}

export async function buildWorkspacePackages(
  dirs: string[],
  filePaths: string[],
  fetchFile: (path: string) => Promise<string | null>,
): Promise<WorkspacePackage[]> {
  const packages: WorkspacePackage[] = [];
  for (const dir of dirs) {
    const pkgPath = dir === "." ? "package.json" : `${dir}/package.json`;
    const raw = await fetchFile(pkgPath);
    if (!raw) continue;
    const parsed = parsePkgJson(raw);
    const scripts = parsed.scripts ?? {};
    const dependencies = parsed.dependencies ?? {};
    const devDependencies = parsed.devDependencies ?? {};
    packages.push({
      dir,
      name: parsed.name ?? dir,
      kind: inferPackageKind(dir, { ...dependencies, ...devDependencies }, filePaths),
      scripts,
      dependencies,
      devDependencies,
      hasLint: Boolean(scripts.lint?.trim()),
      hasTest: isRealTestScript(scripts.test),
      hasBuild: Boolean(scripts.build?.trim()),
      lockfile: detectLockfile(dir, filePaths),
    });
  }
  return packages;
}

function scoreSourcePath(p: string): number {
  let s = 0;
  if (/webhook|stripe/i.test(p)) s -= 3;
  if (/(^|\/)api\//.test(p) || /routes?\//.test(p)) s -= 2;
  if (/(^|\/)app\//.test(p) || /pages?\//.test(p)) s -= 1;
  if (/src\/(main|App|index)\./.test(p)) s -= 2;
  if (TODO_SAMPLE.test(p)) s += 5;
  return s;
}

const CONFIG_PRIORITY = [
  /^vite\.config\.(ts|js|mjs)$/,
  /^next\.config\.(ts|js|mjs)$/,
  /(^|\/)nuxt\.config\.(ts|js)$/,
  /^svelte\.config\.(ts|js)$/,
  /^astro\.config\.(ts|js|mjs)$/,
  /(^|\/)webpack\.config\.(ts|js)$/,
  /(^|\/)tsconfig(\.[\w-]+)?\.json$/,
];

export function pickSourcePathsForAnalysis(filePaths: string[], max = 60): string[] {
  const configPaths = filePaths.filter((p) => CONFIG_PRIORITY.some((re) => re.test(p)));
  const ranked = filePaths
    .filter((p) => SOURCE_EXT.test(p) && !SKIP_PATH.test(p) && !TODO_SAMPLE.test(p))
    .sort((a, b) => scoreSourcePath(a) - scoreSourcePath(b));

  const merged: string[] = [];
  for (const p of [...configPaths, ...ranked]) {
    if (!merged.includes(p)) merged.push(p);
    if (merged.length >= max) break;
  }
  return merged;
}

export function scanEnvContract(fileContents: Record<string, string>): EnvContract {
  const refs = new Map<string, EnvVarRef>();

  const add = (name: string, phase: EnvPhase, file: string) => {
    if (name === "DEV" || name === "PROD" || name === "MODE") return;
    const existing = refs.get(name) ?? { name, phases: [], files: [] };
    if (!existing.phases.includes(phase)) existing.phases.push(phase);
    if (!existing.files.includes(file)) existing.files.push(file);
    refs.set(name, existing);
  };

  for (const [file, content] of Object.entries(fileContents)) {
    for (const m of content.matchAll(VITE_ENV_RE)) {
      add(m[1]!, "build", file);
    }
    for (const m of content.matchAll(NEXT_PUBLIC_RE)) {
      add(m[1]!, "build", file);
    }
    const isServerFile =
      /(^|\/)(api|routes?|server|controllers?|middleware)\//i.test(file) ||
      /server\.(ts|js)$/.test(file);
    for (const m of content.matchAll(PROCESS_ENV_RE)) {
      const name = m[1]!;
      if (name.startsWith("NEXT_PUBLIC_")) add(name, "build", file);
      else if (isServerFile || /^STRIPE_|^DATABASE_|^SUPABASE_|^FIREBASE_/i.test(name))
        add(name, "test", file);
      else add(name, "runtime", file);
    }
    for (const m of content.matchAll(PROCESS_ENV_BRACKET_RE)) {
      add(m[1]!, isServerFile ? "test" : "runtime", file);
    }
    for (const name of scanTypedEnvSchemaKeys(content)) {
      if (name.startsWith("NEXT_PUBLIC_")) add(name, "build", file);
      else if (isServerFile || /^STRIPE_|^DATABASE_|^SUPABASE_|^FIREBASE_/i.test(name))
        add(name, "test", file);
      else add(name, "runtime", file);
    }
  }

  const allRefs = [...refs.values()];
  const build = allRefs.filter((r) => r.phases.includes("build")).map((r) => r.name);
  const test = allRefs
    .filter((r) => r.phases.includes("test") || r.phases.includes("runtime"))
    .map((r) => r.name);
  const runtime = allRefs.filter((r) => r.phases.includes("runtime")).map((r) => r.name);

  return {
    build: [...new Set(build)].sort(),
    test: [...new Set(test)].sort(),
    runtime: [...new Set(runtime)].sort(),
    all: [...new Set([...build, ...test, ...runtime])].sort(),
    refs: allRefs,
  };
}

export function detectIntegrations(
  mergedDeps: Record<string, string>,
  fileContents: Record<string, string>,
): IntegrationGraph {
  const allContent = Object.values(fileContents).join("\n");
  const signals: string[] = [];

  const hasDep = (pkgs: string[]) => pkgs.some((d) => d in mergedDeps);

  const stripe =
    hasDep(INTEGRATION_DEPS.stripe) ||
    /stripe\.webhooks|constructEvent|@stripe\//i.test(allContent);
  if (stripe) signals.push("Stripe payments/webhooks");

  const firebase =
    hasDep(INTEGRATION_DEPS.firebase) ||
    /firebase\.initializeApp|getFirestore|VITE_FIREBASE_/i.test(allContent);
  if (firebase) signals.push("Firebase");

  const supabase =
    hasDep(INTEGRATION_DEPS.supabase) || /createClient.*supabase|@supabase\//i.test(allContent);
  if (supabase) signals.push("Supabase");

  const prisma = hasDep(INTEGRATION_DEPS.prisma) || /PrismaClient|@prisma\//i.test(allContent);
  if (prisma) signals.push("Prisma ORM");

  const auth =
    hasDep(INTEGRATION_DEPS.auth) ||
    /getServerSession|clerkMiddleware|signInWith|useAuth\(/i.test(allContent);
  if (auth) signals.push("Authentication");

  const hasWebhooks =
    /webhook/i.test(allContent) && (stripe || /\/api\/.*webhook/i.test(allContent));

  return { stripe, firebase, supabase, prisma, auth, hasWebhooks, signals };
}

export function detectCodeStructure(filePaths: string[]): CodeStructure {
  const entryPoints = filePaths.filter(
    (p) =>
      /^(src\/)?(main|index|App)\.(tsx?|jsx?)$/.test(p) ||
      /^app\/(page|layout)\.(tsx?|jsx?)$/.test(p),
  );
  const routePaths = filePaths
    .filter((p) => /(^|\/)(pages?|app|routes?)\//i.test(p) && SOURCE_EXT.test(p))
    .slice(0, 40);
  const apiPaths = filePaths
    .filter((p) => /(^|\/)api\//i.test(p) && SOURCE_EXT.test(p))
    .slice(0, 30);
  const componentPaths = filePaths
    .filter((p) => /(^|\/)components?\//i.test(p) && SOURCE_EXT.test(p))
    .slice(0, 30);
  return { entryPoints, routePaths, apiPaths, componentPaths };
}

export function inferRuntimeModel(
  packages: WorkspacePackage[],
  structure: CodeStructure,
  integrations: IntegrationGraph,
  isStaticSpa: boolean,
): ProjectIntelligence["runtimeModel"] {
  if (packages.length > 1) return "monorepo";
  const pkg = packages[0];
  if (!pkg) return "unknown";
  if (pkg.kind === "backend" || integrations.hasWebhooks) return "api-backend";
  if (isStaticSpa || pkg.kind === "frontend") return "static-spa";
  if (structure.apiPaths.length > 0 && structure.routePaths.length > 0) return "fullstack";
  if (pkg.kind === "library") return "library";
  return "unknown";
}

/** Packages that should get their own CI matrix row (excludes empty workspace roots). */
export function ciMatrixPackages(packages: WorkspacePackage[]): WorkspacePackage[] {
  if (packages.length <= 1) return packages;
  const subs = packages.filter((p) => p.dir !== ".");
  if (subs.length === 0) return packages;
  const meaningful = subs.filter(
    (p) => p.hasBuild || p.hasTest || p.hasLint || p.kind !== "unknown",
  );
  return meaningful.length > 0 ? meaningful : subs;
}

export async function buildProjectIntelligence(opts: {
  filePaths: string[];
  mergedDeps: Record<string, string>;
  isStaticSpa: boolean;
  fetchFile: (path: string) => Promise<string | null>;
}): Promise<ProjectIntelligence> {
  const dirs = detectWorkspacePackages(opts.filePaths);
  const packages = await buildWorkspacePackages(dirs, opts.filePaths, opts.fetchFile);

  const sourcePaths = pickSourcePathsForAnalysis(opts.filePaths);
  const fileContents: Record<string, string> = {};
  const codeSamples: CodeSample[] = [];

  await Promise.all(
    sourcePaths.map(async (p) => {
      const content = await opts.fetchFile(p);
      if (!content) return;
      fileContents[p] = content;
      if (codeSamples.length < 8) {
        codeSamples.push({ path: p, excerpt: content.slice(0, 2000) });
      }
    }),
  );

  const envContract = scanEnvContract(fileContents);
  const integrations = detectIntegrations(opts.mergedDeps, fileContents);
  const structure = detectCodeStructure(opts.filePaths);
  const runtimeModel = inferRuntimeModel(packages, structure, integrations, opts.isStaticSpa);

  return {
    monorepo: packages.length > 1,
    packages,
    envContract,
    integrations,
    structure,
    codeSamples,
    runtimeModel,
  };
}

export function intelligenceToAiFiles(intel: ProjectIntelligence): Record<string, string> {
  const files: Record<string, string> = {};
  files["__runtime_model"] = intel.runtimeModel;
  files["__monorepo"] = intel.monorepo ? "true" : "false";

  if (intel.packages.length > 0) {
    files["__ci_packages"] = JSON.stringify(
      intel.packages.map((p) => ({
        dir: p.dir,
        name: p.name,
        kind: p.kind,
        scripts: p.scripts,
        dependencies: p.dependencies,
        devDependencies: p.devDependencies,
        hasLint: p.hasLint,
        hasTest: p.hasTest,
        hasBuild: p.hasBuild,
        lockfile: p.lockfile,
      })),
    );
  }

  if (intel.packages.length > 1) {
    files["__workspace_packages"] = intel.packages
      .map((p) => `${p.dir} (${p.kind}): ${Object.keys(p.scripts).join(", ") || "no scripts"}`)
      .join("\n");
  }

  if (intel.envContract.build.length) files["__env_build"] = intel.envContract.build.join(", ");
  if (intel.envContract.test.length) files["__env_test"] = intel.envContract.test.join(", ");
  if (intel.integrations.signals.length) {
    files["__integrations"] = intel.integrations.signals.join(", ");
  }

  if (intel.structure.routePaths.length) {
    files["__routes"] = intel.structure.routePaths.slice(0, 25).join("\n");
  }
  if (intel.structure.apiPaths.length) {
    files["__api_paths"] = intel.structure.apiPaths.slice(0, 20).join("\n");
  }

  for (const sample of intel.codeSamples.slice(0, 6)) {
    files[sample.path] = sample.excerpt;
  }

  return files;
}
