/**
 * Proof that a fix for an app in a subdirectory lands beside the app, on real GitHub.
 *
 * Pushes a monorepo fixture to a throwaway private repo, runs the real fix pipeline
 * (buildProjectContext → collectFixFiles → preflight → createPRFromFiles), asserts every
 * generated build file sits under the detected app directory, then deletes the repo.
 *
 *   node --env-file=.env --import tsx scripts/verify-subdir-fix-placement.ts
 *   LR_KEEP=1 ...   # keep the repos for inspection
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildProjectContext } from "../src/lib/project-context.server";
import { collectFixFiles } from "../src/lib/fix-executor/body/collect-fix-files";
import { runFixPreflight, preflightBlockMessage } from "../src/lib/fix-preflight.server";
import { createPRFromFiles } from "../src/lib/fix-executor/pr";

const FIXTURES = path.join(process.cwd(), ".scratch/mono-fixtures");
const KEEP = process.env.LR_KEEP === "1";

/** fixture → the directory the app really lives in, and the fixes to generate. */
const CASES: { fixture: string; expectAppDir: string; fixIds: string[] }[] = [
  { fixture: "mono-subdir", expectAppDir: "backend", fixIds: ["dockerfile"] },
  { fixture: "mono-npm", expectAppDir: "apps/web", fixIds: ["dockerfile"] },
  { fixture: "mono-polyglot", expectAppDir: "services/api", fixIds: ["dockerfile"] },
];

/** Files that are correct at the repository root even for a subdirectory app. */
const ROOT_OK =
  /^(\.github\/|README(\.md)?$|LICENSE|\.gitignore$|\.env\.example$|\.editorconfig$)/i;

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function sh(cmd: string, cwd: string) {
  const r = spawnSync("bash", ["-lc", cmd], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd}\n${r.stderr || r.stdout}`);
}

type Row = { fixture: string; appDir: string; files: string[]; ok: boolean; detail: string };

async function runCase(c: (typeof CASES)[number], owner: string, token: string): Promise<Row> {
  const row: Row = { fixture: c.fixture, appDir: "-", files: [], ok: false, detail: "" };
  const src = path.join(FIXTURES, c.fixture);
  if (!fs.existsSync(src)) {
    row.detail = "fixture missing";
    return row;
  }

  const repoName = `lr-subdir-${c.fixture}-${Date.now().toString(36)}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `lr-subdir-${c.fixture}-`));
  let created = false;

  try {
    fs.cpSync(src, tmp, { recursive: true });
    fs.rmSync(path.join(tmp, ".git"), { recursive: true, force: true });
    sh("git init -b main", tmp);
    sh('git config user.email "smoke@example.com"', tmp);
    sh('git config user.name "LaunchReadyy Smoke"', tmp);
    sh("git add -A", tmp);
    sh('git commit -m "chore: fixture baseline" --allow-empty', tmp);
    gh([
      "repo",
      "create",
      `${owner}/${repoName}`,
      "--private",
      "--source",
      tmp,
      "--remote",
      "origin",
      "--push",
    ]);
    created = true;

    const fullName = `${owner}/${repoName}`;

    // 1. Does the fix pipeline resolve the same app directory the scan did?
    const ctx = await buildProjectContext(token, fullName, "unknown");
    row.appDir = ctx.appDir ?? "(root)";
    if (ctx.appDir !== c.expectAppDir) {
      row.detail = `appDir=${ctx.appDir ?? "null"} expected ${c.expectAppDir}`;
      return row;
    }

    // 2. Generate the fix for real.
    const collected = await collectFixFiles(token, fullName, c.fixIds, { framework: "unknown" });
    const files = collected.files ?? [];
    row.files = files.map((f) => f.path);
    if (files.length === 0) {
      row.detail = "no files generated";
      return row;
    }

    // 3. Every build file must sit under the app directory.
    const stray = row.files.filter((p) => !ROOT_OK.test(p) && !p.startsWith(`${c.expectAppDir}/`));
    if (stray.length > 0) {
      row.detail = `outside ${c.expectAppDir}: ${stray.join(", ")}`;
      return row;
    }

    // 4. Preflight must agree.
    const pre = runFixPreflight({
      files,
      ctx,
      fixIds: c.fixIds,
      repoFilePaths: ctx.filePaths,
      verificationNotes: collected.verificationNotes,
    });
    if (!pre.passed) {
      row.detail = `preflight blocked: ${preflightBlockMessage(pre)}`;
      return row;
    }

    // 5. And it must survive a real PR.
    const pr = await createPRFromFiles(
      token,
      fullName,
      "main",
      `lr/subdir-${c.fixture}`,
      c.fixIds,
      files,
    );
    gh(["pr", "close", String(pr.prNumber), "--repo", fullName]);

    row.ok = true;
    row.detail = `PR #${pr.prNumber}`;
  } catch (e) {
    row.detail = e instanceof Error ? e.message.slice(0, 260) : String(e);
  } finally {
    if (created && !KEEP) {
      try {
        gh(["repo", "delete", `${owner}/${repoName}`, "--yes"]);
      } catch {
        console.error(`  ! could not delete ${owner}/${repoName} — delete it manually`);
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return row;
}

async function main() {
  const token = gh(["auth", "token"]).trim();
  const owner = gh(["api", "user", "-q", ".login"]).trim();
  console.log(`owner=${owner}  cases=${CASES.length}\n`);

  const rows: Row[] = [];
  for (const c of CASES) {
    process.stdout.write(`${c.fixture.padEnd(16)} `);
    const row = await runCase(c, owner, token);
    rows.push(row);
    console.log(
      `${row.ok ? "PASS" : "FAIL"}  appDir=${row.appDir.padEnd(14)} ${row.files.join(", ")}  ${row.detail}`,
    );
  }

  const failed = rows.filter((r) => !r.ok);
  console.log(`\n${rows.length - failed.length}/${rows.length} placed correctly`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
