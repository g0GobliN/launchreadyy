/**
 * Monorepo / repo-shape proof.
 *
 * Runs the real product engines (scan, intelligence, sandbox planning, fix generation)
 * against monorepo and edge-shape fixtures under `.scratch/mono-fixtures`.
 *
 *   npx tsx scripts/verify-monorepo-matrix.ts
 *   LR_MONO_DIR=... npx tsx scripts/verify-monorepo-matrix.ts
 */
import fs from "node:fs";
import path from "node:path";

import { runScan } from "../src/lib/scan-engine/scan-repository";
import type { FileProvider } from "../src/lib/scan-engine/file-provider";
import { buildProjectIntelligence } from "../src/lib/project-intelligence.server";
import { detectSandboxCommands, detectSandboxEcosystem } from "../src/lib/sandbox/commands";
import { detectFramework, detectLanguage } from "../src/lib/scanner-rules";
import { resolveProjectLanguage } from "../src/lib/project-context.server";
import { dockerfile } from "../src/lib/fix-executor/body/docker";
import { buildLanguageCiWorkflow } from "../src/lib/project-ci-lang.server";
import { baseCtx } from "../src/lib/fix-tool-catalog";

const ROOT = process.env.LR_MONO_DIR ?? path.join(process.cwd(), ".scratch/mono-fixtures");

const SKIP = new Set([".git", "node_modules", "dist", "build", ".next", "target", "vendor"]);

function listFiles(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(root)) {
    if (SKIP.has(name)) continue;
    const full = path.join(root, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

function diskProvider(root: string): FileProvider {
  let cached: string[] | null = null;
  return {
    async listFiles() {
      return (cached ??= listFiles(root));
    },
    async readFile(rel: string) {
      try {
        return fs.readFileSync(path.join(root, rel.replace(/^\/+/, "")), "utf8");
      } catch {
        return null;
      }
    },
  };
}

type Expectation = {
  /** Directory the real app lives in, "." when the repo root is the app. */
  appDir: string;
  /** What a competent human would call this repo's stack. */
  stack: string;
  monorepo: boolean;
};

// Where a repo ships both an API and a web app the backend is the expected pick — readiness and
// security are mostly server properties, so auditing the client and staying silent about the
// server is the more expensive miss. See `app-root.ts`.
const EXPECT: Record<string, Expectation> = {
  "mono-npm": { appDir: "apps/web", stack: "Next.js", monorepo: true },
  "mono-pnpm": { appDir: "apps/api", stack: "Express", monorepo: true },
  "mono-turbo": { appDir: "apps/docs", stack: "Next.js", monorepo: true },
  "mono-nx": { appDir: "apps/store", stack: "Vite", monorepo: true },
  "mono-polyglot": { appDir: "services/api", stack: "Go", monorepo: false },
  "mono-subdir": { appDir: "backend", stack: "Python", monorepo: false },
  "probe-sec-root": { appDir: ".", stack: "Python", monorepo: false },
  "probe-sec-sub": { appDir: "backend", stack: "Python", monorepo: false },
  "edge-empty": { appDir: ".", stack: "none", monorepo: false },
  "edge-docs": { appDir: ".", stack: "none", monorepo: false },
};

type Row = {
  fixture: string;
  files: number;
  score: number | string;
  framework: string;
  language: string;
  monorepo: string;
  runtimeModel: string;
  packages: string;
  ecosystemRoot: string;
  ecosystemApp: string;
  installRoot: string;
  installApp: string;
  dockerfile: string;
  ci: string;
  notes: string[];
};

function readJson(p: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function checkFixture(name: string): Promise<Row> {
  const root = path.join(ROOT, name);
  const files = listFiles(root);
  const expect = EXPECT[name];
  const notes: string[] = [];

  const row: Row = {
    fixture: name,
    files: files.length,
    score: "-",
    framework: "-",
    language: "-",
    monorepo: "-",
    runtimeModel: "-",
    packages: "-",
    ecosystemRoot: "-",
    ecosystemApp: "-",
    installRoot: "-",
    installApp: "-",
    dockerfile: "-",
    ci: "-",
    notes,
  };

  // ---- 1. scan -------------------------------------------------------------
  try {
    const scan = await runScan(diskProvider(root));
    row.score = scan.score;
    row.framework = scan.framework;
  } catch (e) {
    notes.push(`SCAN THREW: ${(e as Error).message}`);
    return row;
  }

  const rootPkg = readJson(path.join(root, "package.json"));
  row.language = detectLanguage(files);
  if (expect && expect.stack !== "none" && row.framework !== expect.stack) {
    notes.push(`framework=${row.framework}, expected ${expect.stack} (app in ${expect.appDir})`);
  }

  // ---- 2. intelligence -----------------------------------------------------
  try {
    const intel = await buildProjectIntelligence({
      filePaths: files,
      mergedDeps: {
        ...((rootPkg?.dependencies as Record<string, string>) ?? {}),
        ...((rootPkg?.devDependencies as Record<string, string>) ?? {}),
      },
      isStaticSpa: false,
      fetchFile: async (p) => {
        try {
          return fs.readFileSync(path.join(root, p), "utf8");
        } catch {
          return null;
        }
      },
    });
    row.monorepo = String(intel.monorepo);
    row.runtimeModel = intel.runtimeModel;
    row.packages = intel.packages.map((p) => `${p.dir}:${p.kind}`).join(" ") || "none";
    if (expect && intel.monorepo !== expect.monorepo) {
      notes.push(`monorepo=${intel.monorepo} expected ${expect.monorepo}`);
    }
  } catch (e) {
    notes.push(`INTEL THREW: ${(e as Error).message}`);
  }

  // ---- 3. sandbox planning, at repo root and at the true app dir -----------
  const appDir = expect?.appDir === "." ? null : (expect?.appDir ?? null);
  const scriptsAt = (dir: string | null) => {
    const pkg = readJson(path.join(root, dir ? `${dir}/package.json` : "package.json"));
    return ((pkg?.scripts as Record<string, string>) ?? {}) as Record<string, string>;
  };

  try {
    const eco = detectSandboxEcosystem(files, null);
    row.ecosystemRoot = eco ?? "null";
    const cmds = detectSandboxCommands({ filePaths: files, scripts: scriptsAt(null) });
    row.installRoot =
      cmds.commands
        .filter((c) => c.step === "install")
        .map((c) => `${c.cmd}${c.cwd ? ` @${c.cwd}` : ""}`)
        .join("; ") || "none";
  } catch (e) {
    notes.push(`SANDBOX-ROOT THREW: ${(e as Error).message}`);
  }

  if (appDir) {
    try {
      const eco = detectSandboxEcosystem(files, appDir);
      row.ecosystemApp = eco ?? "null";
      const cmds = detectSandboxCommands({
        filePaths: files,
        scripts: scriptsAt(appDir),
        rootDir: appDir,
      });
      row.installApp =
        cmds.commands
          .filter((c) => c.step === "install")
          .map((c) => `${c.cmd}${c.cwd ? ` @${c.cwd}` : ""}`)
          .join("; ") || "none";
    } catch (e) {
      notes.push(`SANDBOX-APP THREW: ${(e as Error).message}`);
    }
  }

  // ---- 4. fix generation ---------------------------------------------------
  const getContent = (p: string) => {
    try {
      return fs.readFileSync(path.join(root, p), "utf8");
    } catch {
      return undefined;
    }
  };
  const resolved = resolveProjectLanguage(row.framework, files, files.includes("package.json"));
  try {
    const content = dockerfile(
      row.framework === "unknown" ? resolved.resolvedFramework : row.framework,
      "npm",
      files,
      {
        requirements: getContent("requirements.txt") ?? "",
        pyprojectToml: getContent("pyproject.toml") ?? "",
        gemfile: getContent("Gemfile") ?? "",
        cargoToml: getContent("Cargo.toml") ?? "",
      },
      "",
      getContent,
    );
    row.dockerfile = content?.trim() ? `${content.split("\n").length} lines` : "empty";
    if (content?.trim()) {
      fs.mkdirSync(path.join(ROOT, ".generated", name), { recursive: true });
      fs.writeFileSync(path.join(ROOT, ".generated", name, "Dockerfile"), content);
      // This raw generator intentionally knows nothing about repository placement. Production
      // places its returned `Dockerfile` under the detected app directory in
      // `collectFixFiles` → `placeGeneratedFile`; the real-GitHub placement harness proves that
      // separate responsibility end to end.
    }
  } catch (e) {
    row.dockerfile = `THREW: ${(e as Error).message}`;
  }

  try {
    const ctx = baseCtx({
      language: resolved.language,
      resolvedFramework: resolved.resolvedFramework,
      isNodeProject: files.includes("package.json"),
      filePaths: files,
    });
    const ci = buildLanguageCiWorkflow(ctx, "");
    row.ci = ci?.trim() ? `${ci.split("\n").length} lines` : "none";
    if (ci?.trim()) {
      fs.mkdirSync(path.join(ROOT, ".generated", name), { recursive: true });
      fs.writeFileSync(path.join(ROOT, ".generated", name, "ci.yml"), ci);
    }
  } catch (e) {
    row.ci = `THREW: ${(e as Error).message}`;
  }

  return row;
}

async function main() {
  if (!fs.existsSync(ROOT)) throw new Error(`fixtures missing: ${ROOT}`);
  const names = fs
    .readdirSync(ROOT)
    .filter((n) => !n.startsWith(".") && fs.statSync(path.join(ROOT, n)).isDirectory())
    .sort();

  const rows: Row[] = [];
  for (const name of names) {
    process.stdout.write(`\n=== ${name} ===\n`);
    const row = await checkFixture(name);
    rows.push(row);
    console.log(`  files          ${row.files}`);
    console.log(`  score          ${row.score}`);
    console.log(`  framework      ${row.framework}   (language ${row.language})`);
    console.log(`  monorepo       ${row.monorepo}   runtimeModel=${row.runtimeModel}`);
    console.log(`  packages       ${row.packages}`);
    console.log(`  ecosystem      root=${row.ecosystemRoot} app=${row.ecosystemApp}`);
    console.log(`  install root   ${row.installRoot}`);
    console.log(`  install app    ${row.installApp}`);
    console.log(`  dockerfile     ${row.dockerfile}`);
    console.log(`  ci             ${row.ci}`);
    for (const n of row.notes) console.log(`  ! ${n}`);
  }

  const problems = rows.filter((r) => r.notes.length > 0);
  console.log(`\n\n===== SUMMARY =====`);
  console.log(`fixtures: ${rows.length}   with findings: ${problems.length}`);
  for (const r of problems) {
    console.log(`\n${r.fixture}`);
    for (const n of r.notes) console.log(`  - ${n}`);
  }
  fs.writeFileSync(
    path.join(ROOT, "report.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
