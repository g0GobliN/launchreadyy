import { Command } from "commander";
import pc from "picocolors";
import { loadConfig, isConfigured } from "../services/config.js";
import { checkDatabaseHealth, databaseExists } from "../services/database.js";
import { openBrowser, isCI } from "../services/browser.js";
import { checkPortAvailable } from "./doctor.js";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

/** Poll until the server answers, so "ready" means reachable rather than logged. */
async function waitForHttpReady(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Always invoked from the project root — see PROJECT_ROOT comment in commands/doctor.ts.
const PROJECT_ROOT = process.cwd();

/** Loopback addresses are the only ones that are private by construction. */
function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

export const startCommand = new Command("start")
  .description("Start LaunchReadyy Community application")
  .option("--no-open", "Don't open browser automatically")
  .option("-p, --port <number>", "Port to run on (default: 5174)")
  .option(
    "--host <address>",
    "Interface to bind (default: localhost). Use 0.0.0.0 to expose on the network.",
  )
  .option("--verbose", "Verbose output")
  .action(async (options) => {
    console.log(pc.bold("\n  LaunchReadyy Community\n"));

    // Check if configured
    if (!isConfigured()) {
      console.log(pc.yellow("  LaunchReadyy is not configured yet."));
      console.log(pc.gray("  Run 'launchreadyy setup' to configure.\n"));
      process.exit(1);
    }

    const config = loadConfig();

    // Lightweight configuration validation
    console.log(pc.cyan("  Validating configuration..."));

    // Check database
    if (!databaseExists()) {
      console.log(pc.red("  ✗ Database not found"));
      console.log(pc.gray("  Run 'launchreadyy setup' to initialize the database.\n"));
      process.exit(1);
    }

    const dbHealth = checkDatabaseHealth();
    if (!dbHealth.healthy) {
      console.log(pc.red(`  ✗ Database: ${dbHealth.message}`));
      process.exit(1);
    }
    console.log(pc.green("  ✓ Database ready"));

    // Check GitHub
    if (config.githubToken) {
      console.log(
        pc.green(
          `  ✓ GitHub configured (${config.githubToken.slice(0, 4)}****${config.githubToken.slice(-4)})`,
        ),
      );
    } else {
      console.log(pc.yellow("  ○ GitHub not configured (repository features disabled)"));
    }

    // Check E2B
    if (config.e2bApiKey) {
      console.log(pc.green(`  ✓ E2B configured`));
    } else {
      console.log(pc.gray("  ○ E2B disabled"));
    }

    // Check AI
    if (config.aiProvider) {
      const keyMap: Record<string, string | undefined> = {
        deepseek: config.deepseekApiKey,
        anthropic: config.anthropicApiKey,
        openai: config.openaiApiKey,
        gemini: config.geminiApiKey,
      };
      const key = keyMap[config.aiProvider];
      if (key) {
        console.log(pc.green(`  ✓ AI: ${config.aiProvider}`));
      } else {
        console.log(pc.yellow(`  ⚠ AI: ${config.aiProvider} (no API key)`));
      }
    } else {
      console.log(pc.gray("  ○ AI disabled"));
    }

    console.log("");

    // Determine port
    let port =
      parseInt(options.port, 10) ||
      parseInt(new URL(config.appUrl || "http://localhost:5174").port || "5174", 10);

    // Check if port is available
    const available = await checkPortAvailable(port);
    if (!available) {
      console.log(pc.yellow(`  Port ${port} is already in use.`));

      if (options.port) {
        console.log(pc.red("  Specified port is in use. Exiting."));
        process.exit(1);
      }

      // Try to find next available port
      let newPort = port + 1;
      while (newPort < port + 100) {
        if (await checkPortAvailable(newPort)) {
          const useNewPort = await import("@clack/prompts").then(({ confirm }) =>
            confirm({ message: `Use port ${newPort} instead?`, initialValue: true }),
          );
          if (useNewPort) {
            port = newPort;
            break;
          } else {
            console.log(pc.red("  Exiting."));
            process.exit(1);
          }
        }
        newPort++;
      }

      if (
        port === parseInt(options.port, 10) ||
        port === parseInt(new URL(config.appUrl || "http://localhost:5174").port || "5174", 10)
      ) {
        console.log(pc.red("  No available ports found. Exiting."));
        process.exit(1);
      }
    }

    // Update app URL with the actual port
    const appUrl = `http://localhost:${port}`;
    config.appUrl = appUrl;

    // Bind to loopback unless the operator explicitly asks otherwise. LaunchReadyy
    // holds a GitHub token and an AI/E2B key and has no login of its own, so a
    // non-loopback bind is a deliberate, warned-about decision — not a default.
    const host = options.host || process.env.HOST || "localhost";
    if (!isLoopbackHost(host)) {
      console.log(
        pc.yellow(
          `\n  ⚠ Binding to ${host} exposes this instance beyond localhost. It has no login\n` +
            `    of its own and holds your GitHub/AI/E2B credentials — put it behind a\n` +
            `    reverse proxy with authentication before exposing it.\n`,
        ),
      );
    }

    // Start the application
    console.log(pc.cyan(`  Starting on ${appUrl}...`));

    // Set environment variables for the child process
    const env = {
      ...process.env,
      GITHUB_TOKEN: config.githubToken || "",
      E2B_API_KEY: config.e2bApiKey || "",
      AI_PROVIDER: config.aiProvider || "",
      DEEPSEEK_API_KEY: config.deepseekApiKey || "",
      ANTHROPIC_API_KEY: config.anthropicApiKey || "",
      OPENAI_API_KEY: config.openaiApiKey || "",
      GEMINI_API_KEY: config.geminiApiKey || "",
      LOCAL_USER_LOGIN: config.localUserLogin || "local",
      LOCAL_USER_EMAIL: config.localUserEmail || "",
      LOCAL_USER_AVATAR_URL: config.localUserAvatarUrl || "",
      SESSION_SECRET: config.sessionSecret || "",
      APP_URL: appUrl,
      VITE_APP_URL: appUrl,
      ENV_VAR_ENCRYPTION_SECRET: config.envVarEncryptionSecret || "",
      E2B_TEMPLATE_ID: config.e2bTemplateId || "",
      PORT: port.toString(),
      HOST: host,
      NODE_ENV: "production",
    };

    const serverEntry = join(PROJECT_ROOT, "dist", "server", "server.js");
    if (!existsSync(serverEntry)) {
      console.log(pc.red("  ✗ Application is not built."));
      console.log(pc.gray("  Run 'npm run build' first, then 'launchreadyy start'.\n"));
      process.exit(1);
    }

    // The built Node server (web + job worker + local scheduler in one process).
    const child = spawn(process.execPath, [serverEntry], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (options.verbose) {
      child.stdout?.on("data", (d) => process.stdout.write(d.toString()));
      child.stderr?.on("data", (d) => process.stderr.write(d.toString()));
    } else {
      // Still surface server errors — silence here is how a crash looks like a hang.
      child.stderr?.on("data", (d) => process.stderr.write(d.toString()));
    }

    // Readiness is an actual HTTP response, not a log line we hope to see.
    const ready = await waitForHttpReady(appUrl, 60_000);
    if (!ready) {
      console.log(pc.red(`\n  ✗ Server did not become ready at ${appUrl}`));
      child.kill("SIGTERM");
      process.exit(1);
    }

    console.log(pc.green(`\n  ✓ Server ready at ${appUrl}`));

    if (options.open === false) {
      console.log(pc.gray("  Browser opening disabled (--no-open)"));
    } else if (isCI()) {
      console.log(pc.gray("  Browser opening skipped (CI environment)"));
    } else {
      const result = await openBrowser(appUrl);
      console.log(`  ${result.message}`);
    }

    console.log(pc.gray("\n  Press Ctrl+C to stop\n"));

    child.on("error", (error) => {
      console.error(pc.red(`\n  ✗ Failed to start server: ${error.message}\n`));
      process.exit(1);
    });

    child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(pc.red(`\n  Server exited with code ${code}\n`));
        process.exit(code || 1);
      }
      console.log(pc.gray("\n  Server stopped.\n"));
      process.exit(0);
    });

    // Handle shutdown signals
    const shutdown = () => {
      console.log(pc.gray("\n  Shutting down..."));
      child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
        process.exit(1);
      }, 5000);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
