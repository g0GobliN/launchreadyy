/**
 * Real E2B sandbox proof, per language.
 *
 * Runs the product's own command detection against real cloned repos and executes the install
 * step in a real E2B sandbox — the same path an operator-triggered verification takes.
 *
 *   node --env-file=.env --import tsx scripts/verify-sandbox-languages.ts
 *   LR_SB_STACKS=go-app,depth-python node --env-file=.env --import tsx scripts/verify-sandbox-languages.ts
 *   LR_SB_STEPS=install,build ...   # default: install only
 */
import fs from "node:fs";
import path from "node:path";

import { getSandboxAdapter } from "../src/lib/adapters/sandbox";
import { detectSandboxCommands, detectSandboxEcosystem } from "../src/lib/sandbox/commands";

const FIXTURES = process.env.LR_SB_DIR ?? path.join(process.cwd(), ".scratch/real-fixtures");
const TIMEOUT_MS = Number(process.env.LR_SB_TIMEOUT_MS ?? 300_000);
const FILE_CAP = Number(process.env.LR_SB_FILES ?? 500);
const STEPS = (process.env.LR_SB_STEPS ?? "install").split(",");

/** One representative repo per sandbox ecosystem in the E2B image. */
const DEFAULT_STACKS = [
  "depth-express", // node   / npm
  "express-tsc", // node   / npm + tsc build
  "depth-python", // python / pip
  "python-fastapi", // python / poetry-ish
  "go-app", // go
  "rust-app", // rust
  "depth-ruby", // ruby
  "laravel-11", // php
  "depth-java", // java
  "depth-csharp", // dotnet
  "elixir-app", // elixir
];

const SKIP = new Set([
  ".git",
  "node_modules",
  "vendor",
  "target",
  "dist",
  "build",
  ".next",
  "_build",
  "deps",
  ".gradle",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "Pods",
  "obj",
  "bin",
]);

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

function readScripts(root: string, files: string[]): Record<string, string> {
  if (!files.includes("package.json")) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

type Row = {
  stack: string;
  ecosystem: string;
  pm: string;
  commands: string;
  status: "pass" | "fail" | "skip";
  ms: number;
  detail: string;
};

async function runStack(stack: string): Promise<Row> {
  const root = path.join(FIXTURES, stack);
  const row: Row = {
    stack,
    ecosystem: "-",
    pm: "-",
    commands: "-",
    status: "fail",
    ms: 0,
    detail: "",
  };
  if (!fs.existsSync(root)) {
    row.status = "skip";
    row.detail = "fixture missing";
    return row;
  }

  const files = listFiles(root);
  row.ecosystem = detectSandboxEcosystem(files) ?? "null";
  const detected = detectSandboxCommands({
    filePaths: files,
    scripts: readScripts(root, files),
    includeTest: false,
  });
  row.pm = detected.packageManager;

  const commands = detected.commands.filter((c) => STEPS.includes(c.step));
  row.commands = commands.map((c) => c.cmd).join(" && ") || "none";
  if (commands.length === 0) {
    row.status = "skip";
    row.detail = "no commands planned";
    return row;
  }

  const fileMap: Record<string, string> = {};
  let uploaded = 0;
  for (const rel of files) {
    if (uploaded >= FILE_CAP) break;
    if (/\.(png|jpe?g|gif|webp|ico|woff2?|zip|jar|class|dll|so|dylib|pdf|mp4)$/i.test(rel))
      continue;
    try {
      const buf = fs.readFileSync(path.join(root, rel));
      if (buf.length > 400_000) continue;
      fileMap[rel] = buf.toString("utf8");
      uploaded++;
    } catch {
      /* unreadable / binary */
    }
  }

  const adapter = getSandboxAdapter();
  if (!adapter.available()) {
    row.status = "skip";
    row.detail = "sandbox adapter unavailable";
    return row;
  }

  const started = Date.now();
  try {
    const result = await adapter.run({
      source: { kind: "files", files: fileMap },
      env: {},
      commands,
      timeoutMs: TIMEOUT_MS,
    });
    row.ms = Date.now() - started;
    if (result.skipped) {
      row.status = "skip";
      row.detail = result.skipReason ?? result.providerError ?? "skipped";
      return row;
    }
    row.status = result.ok ? "pass" : "fail";
    if (!result.ok) {
      const failed = result.steps?.find((s) => s.exitCode !== 0);
      row.detail = `${failed?.command ?? "?"} → exit ${failed?.exitCode ?? "?"}: ${(
        failed?.stderr ||
        failed?.stdout ||
        ""
      )
        .split("\n")
        .filter(Boolean)
        .slice(-3)
        .join(" | ")
        .slice(0, 300)}`;
    }
  } catch (e) {
    row.ms = Date.now() - started;
    row.detail = `THREW: ${(e as Error).message}`;
  }
  return row;
}

async function main() {
  const stacks = (process.env.LR_SB_STACKS ?? DEFAULT_STACKS.join(",")).split(",").filter(Boolean);
  console.log(`E2B template: ${process.env.E2B_TEMPLATE_ID ?? "(base image)"}`);
  console.log(`steps: ${STEPS.join(",")}   stacks: ${stacks.length}\n`);

  const rows: Row[] = [];
  for (const stack of stacks) {
    process.stdout.write(`${stack.padEnd(18)} `);
    const row = await runStack(stack);
    rows.push(row);
    console.log(
      `${row.status.toUpperCase().padEnd(5)} ${row.ecosystem.padEnd(8)} ${row.pm.padEnd(8)} ${
        Math.round(row.ms / 1000) + "s"
      }  ${row.detail}`,
    );
  }

  console.log(`\n===== SUMMARY =====`);
  for (const s of ["pass", "fail", "skip"] as const) {
    const list = rows.filter((r) => r.status === s);
    console.log(
      `${s}: ${list.length}${list.length ? ` — ${list.map((r) => r.stack).join(", ")}` : ""}`,
    );
  }
  fs.writeFileSync(
    path.join(process.cwd(), ".scratch/sandbox-report.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
