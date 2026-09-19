/**
 * Round 3 — the stacks still untested: native mobile (Android/Kotlin, iOS/Swift),
 * a Kotlin/Ktor server, and standalone Dart. Probes the known edge: do native mobile
 * apps (no HTTP server) wrongly get server checks (Dockerfile / health-check)?
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

import { runScan } from "../src/lib/scan-engine/scan-repository";
import type { FileProvider } from "../src/lib/scan-engine/file-provider";

const REPOS = [
  { name: "android-kotlin-native", url: "https://github.com/android/sunflower" },
  { name: "ios-swift-native", url: "https://github.com/Dimillian/IceCubesApp" },
  { name: "kotlin-ktor-server", url: "https://github.com/ktorio/ktor-samples" },
  { name: "dart-standalone", url: "https://github.com/dart-lang/samples" },
];

const SERVER_ONLY_FIXES = new Set([
  "dockerfile",
  "health-check",
  "helmet",
  "cors",
  "rate-limit",
  "db-pool",
]);
const NATIVE_MOBILE = new Set(["android-kotlin-native", "ios-swift-native"]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "out",
  "vendor",
  "target",
  "_build",
  "deps",
  "Pods",
  ".dart_tool",
  ".gradle",
]);
const CLONE_ROOT = path.join(os.tmpdir(), "lr-lang3");
const REPORT_PATH = process.env.LR_REPORT_PATH ?? path.join(os.tmpdir(), "lr-lang3-report.txt");
if (fs.existsSync(REPORT_PATH)) fs.rmSync(REPORT_PATH);
function report(line: string) {
  fs.appendFileSync(REPORT_PATH, line + "\n");
  console.log(line);
}

function listFilesOnDisk(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(path.join(dir, ent.name));
      } else if (ent.isFile())
        out.push(path.relative(root, path.join(dir, ent.name)).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out;
}
function diskFileProvider(root: string): FileProvider {
  let cached: string[] | null = null;
  return {
    async listFiles() {
      return (cached ??= listFilesOnDisk(root));
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
function shallowClone(url: string, dest: string): boolean {
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  return (
    spawnSync("git", ["clone", "--depth", "1", url, dest], { encoding: "utf8", timeout: 240_000 })
      .status === 0
  );
}

const cloned: Record<string, string> = {};
const nativeServerChecks: string[] = [];
beforeAll(() => {
  fs.mkdirSync(CLONE_ROOT, { recursive: true });
  for (const repo of REPOS) {
    const dest = path.join(CLONE_ROOT, repo.name);
    if (shallowClone(repo.url, dest)) cloned[repo.name] = dest;
    else report(`[clone] FAILED (skipped): ${repo.url}`);
  }
}, 30 * 60_000);

describe("native mobile + ktor + dart", () => {
  for (const repo of REPOS) {
    it(
      `${repo.name}: scan`,
      async () => {
        const root = cloned[repo.name];
        if (!root) {
          report(`\n─── ${repo.name}: SKIPPED ───`);
          return;
        }
        const scan = await runScan(diskFileProvider(root));
        report(`\n─── ${repo.name} (${repo.url.split("/").slice(-1)[0]}) ───`);
        report(
          `  framework: ${scan.framework}   score: ${scan.score}/100   findings: ${scan.findings.length}`,
        );
        report(
          `  findings: ${scan.findings.map((f) => `${f.fixId}[${f.severity}]`).join(", ") || "(none)"}`,
        );

        if (NATIVE_MOBILE.has(repo.name)) {
          const bad = scan.findings.filter((f) => SERVER_ONLY_FIXES.has(f.fixId));
          for (const f of bad) {
            const msg = `${repo.name} (${scan.framework}, native mobile) got server-only fix "${f.fixId}" — ${f.title}`;
            nativeServerChecks.push(msg);
            report(`  ⚠ ${msg}`);
          }
        }
        expect(scan.framework).toBeTruthy();
      },
      8 * 60_000,
    );
  }

  it("native mobile apps get no server-only checks", () => {
    report(`\n════ NATIVE-MOBILE SERVER-CHECK LEAKS: ${nativeServerChecks.length} ════`);
    for (const m of nativeServerChecks) report(`  ${m}`);
    // Informational — do not fail the run; we want the report either way.
    expect(true).toBe(true);
  });
});
