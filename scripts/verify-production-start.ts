/**
 * Proves `npm start` actually answers a request — the same entry point a real deployment runs.
 *
 * Boots dist/server/server.js as a real child process (not an import — that would skip the
 * `isProcessEntry()` gate the same way `vite dev` does) in a scratch cwd so its SQLite file
 * never touches the repo's own data/, then hits it over the real network stack and shuts it
 * down. This is what npm run test:production-start / CI's "Production startup smoke" step runs.
 *
 *   npm run build && npm run test:production-start
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SERVER_ENTRY = join(ROOT, "dist", "server", "server.js");
const BOOT_TIMEOUT_MS = 15_000;

function randomHex(bytes: number): string {
  return Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0"),
  ).join("");
}

async function main() {
  if (!existsSync(SERVER_ENTRY)) {
    console.error(
      `[verify-production-start] ${SERVER_ENTRY} does not exist — run "npm run build" first.`,
    );
    process.exit(1);
  }

  const scratchDir = mkdtempSync(join(tmpdir(), "lr-prod-start-"));
  let child: ReturnType<typeof spawn> | undefined;

  try {
    const url = await new Promise<string>((resolvePromise, reject) => {
      child = spawn(process.execPath, [SERVER_ENTRY], {
        cwd: scratchDir,
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: "0",
          SESSION_SECRET: randomHex(32),
          ENV_VAR_ENCRYPTION_SECRET: randomHex(32),
          // Deliberately no GITHUB_TOKEN / AI_PROVIDER / E2B_API_KEY — a fresh install has none
          // of those, and the server must still boot and serve the marketing homepage.
          GITHUB_TOKEN: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        reject(new Error(`Server did not report "listening on" within ${BOOT_TIMEOUT_MS}ms`));
      }, BOOT_TIMEOUT_MS);

      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.stdout?.on("data", (chunk) => {
        const match = /listening on (\S+)/.exec(chunk.toString());
        if (match) {
          clearTimeout(timer);
          resolvePromise(match[1]!);
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Server exited early with code ${code}.\nstderr:\n${stderr}`));
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    console.log(`[verify-production-start] server up at ${url}`);

    const res = await fetch(url, { redirect: "manual" });
    if (res.status >= 500) {
      throw new Error(`GET / returned ${res.status}`);
    }
    console.log(`[verify-production-start] GET / -> ${res.status} OK`);

    const health = await fetch(new URL("/status", url), { redirect: "manual" });
    if (health.status >= 500) {
      throw new Error(`GET /status returned ${health.status}`);
    }
    console.log(`[verify-production-start] GET /status -> ${health.status} OK`);

    console.log("[verify-production-start] PASS");
  } finally {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      if (!child.killed) child.kill("SIGKILL");
    }
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[verify-production-start] FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
