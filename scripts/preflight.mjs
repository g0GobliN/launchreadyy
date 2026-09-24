#!/usr/bin/env node
/**
 * Fail fast, with an instruction, when a command's prerequisite is missing.
 *
 * Each check here exists because the underlying tool reports the problem somewhere unhelpful:
 *
 *   node        → `vite dev` on Node 18 dies with "crypto.hash is not a function", and `vitest`
 *                 with a stack trace from inside its own loader. The project needs Node 20.19+/22.13+.
 *   e2b         → the sandbox template build throws AuthenticationError from the E2B SDK.
 *   playwright  → the smoke suite reports two failed tests; the real cause is a missing browser.
 *   docker      → `verify:tools` builds real containers and reports failures as test failures.
 *
 * Usage: node scripts/preflight.mjs <check> [check…]   (wired through npm pre-hooks, so it is not
 * something anyone has to remember to run.)
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** One failure per check, printed together, so a run reports everything missing at once. */
const problems = [];

/** True when `version` satisfies a single alternative of an engines range (^X.Y.Z or >=X.Y.Z). */
function satisfies(version, range) {
  const [major, minor, patch] = version.split(".").map(Number);
  const match = range.match(/^(\^|>=)(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null; // Unrecognized shape: say so rather than silently passing.
  const [, operator, rMajor, rMinor, rPatch] = match;
  const atLeast =
    major > Number(rMajor) ||
    (major === Number(rMajor) &&
      (minor > Number(rMinor) || (minor === Number(rMinor) && patch >= Number(rPatch))));
  return operator === "^" ? atLeast && major === Number(rMajor) : atLeast;
}

function checkNode() {
  const engines = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).engines?.node;
  if (!engines) return;

  const current = process.versions.node;
  const verdicts = engines.split("||").map((range) => satisfies(current, range.trim()));
  if (verdicts.includes(true)) return;
  if (verdicts.includes(null)) {
    problems.push(
      `package.json declares engines.node as "${engines}", which this check cannot evaluate. ` +
        `Update scripts/preflight.mjs to match.`,
    );
    return;
  }

  problems.push(
    `Node ${current} is too old. This project requires ${engines} (.nvmrc pins ` +
      `${readFileSync(path.join(root, ".nvmrc"), "utf8").trim()}). Run: nvm use`,
  );
}

/** Reads a variable from the process or from `.env`, without printing the value. */
function envValue(name) {
  if (process.env[name]) return process.env[name];
  const file = path.join(root, ".env");
  if (!existsSync(file)) return null;
  const match = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  return match?.[1].trim() || null;
}

function checkE2b() {
  if (envValue("E2B_API_KEY")) return;
  problems.push(
    "E2B_API_KEY is not set, so the sandbox template cannot be built. Create a key at " +
      "https://e2b.dev/dashboard?tab=keys and add E2B_API_KEY=… to .env (see .env.example). " +
      "Sandbox verification is optional: every other command works without it.",
  );
}

function checkPlaywright() {
  // Resolve the browser the way Playwright does, so a partially installed cache is reported here
  // rather than as two failed tests.
  const resolved = spawnSync(
    "node",
    [
      "--input-type=module",
      "--eval",
      'import { chromium } from "@playwright/test"; console.log(chromium.executablePath());',
    ],
    { cwd: root, encoding: "utf8" },
  );
  const executable = resolved.status === 0 ? resolved.stdout.trim() : "";
  if (executable && existsSync(executable)) return;
  problems.push(
    "Playwright's browser is not installed, so the smoke suite has nothing to launch. Run once: " +
      "npx playwright install chromium",
  );
}

function checkDocker() {
  const info = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (info.status === 0) return;
  problems.push(
    "Docker is not available, and verify:tools builds real containers. Start Docker (and make " +
      "sure this user can reach the daemon), or skip this audit — it is not part of `npm test`.",
  );
}

const checks = process.argv.slice(2);
const available = {
  node: checkNode,
  e2b: checkE2b,
  playwright: checkPlaywright,
  docker: checkDocker,
};

for (const check of checks) {
  if (!available[check]) {
    console.error(
      `preflight: unknown check "${check}" (expected one of ${Object.keys(available)})`,
    );
    process.exit(2);
  }
  available[check]();
}

if (problems.length > 0) {
  console.error(
    `\nCannot continue (${problems.length} prerequisite problem${problems.length === 1 ? "" : "s"}):\n`,
  );
  for (const problem of problems) console.error(`  ✗ ${problem}\n`);
  process.exit(1);
}
