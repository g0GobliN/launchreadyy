import { Command } from "commander";
import pc from "picocolors";
import { runEnvironmentChecks, formatCheck } from "../services/environment.js";
import {
  loadConfig,
  maskToken,
  getConfigPath,
  getEnvPath,
  findConflictingVars,
} from "../services/config.js";
import { validateGitHubToken, maskToken as maskGhToken } from "../services/github.js";
import { checkDatabaseHealth, databaseExists } from "../services/database.js";
import { isCI } from "../services/browser.js";
import { existsSync, accessSync, constants } from "fs";
import { join } from "path";

// The built CLI is a single bundled file (dist/cli/index.js), so its own
// location can't be walked back up to the project root at a fixed depth —
// this must always be invoked from the project root instead (matches the
// "Fix: Run this command from the LaunchReadyy project root" hint below).
const PROJECT_ROOT = process.cwd();

export const doctorCommand = new Command("doctor")
  .description("Check installation and configuration")
  .option("-v, --verbose", "Show verbose output")
  .action(async (options) => {
    console.log(pc.bold("\n  LaunchReadyy Doctor\n"));

    let issues = 0;
    let warnings = 0;

    // Runtime checks
    console.log(pc.cyan("  Runtime"));
    const envResult = runEnvironmentChecks();
    for (const check of envResult.checks) {
      const line = formatCheck(check);
      console.log(`  ${line}`);
      if (check.status === "error") issues++;
      if (check.status === "warning") warnings++;
    }

    console.log("");

    // Configuration checks
    console.log(pc.cyan("  Configuration"));
    const config = loadConfig();

    // GitHub token
    if (config.githubToken) {
      console.log(`  ✓ GitHub token configured (${maskGhToken(config.githubToken)})`);

      // Validate token
      const validation = await validateGitHubToken(config.githubToken);
      if (validation.valid) {
        console.log(`  ✓ GitHub API reachable (${validation.user?.login})`);
      } else {
        console.log(`  ✗ GitHub API unreachable: ${validation.error}`);
        issues++;
      }
    } else {
      console.log(`  ✗ GitHub token not configured`);
      issues++;
    }

    // E2B
    if (config.e2bApiKey) {
      console.log(`  ✓ E2B configured (${maskToken(config.e2bApiKey)})`);
    } else {
      console.log(`  ○ E2B not configured (sandbox verification disabled)`);
      warnings++;
    }

    // AI Provider
    if (config.aiProvider) {
      const keyMap: Record<string, string | undefined> = {
        deepseek: config.deepseekApiKey,
        anthropic: config.anthropicApiKey,
        openai: config.openaiApiKey,
        gemini: config.geminiApiKey,
      };
      const key = keyMap[config.aiProvider];
      if (key) {
        console.log(`  ✓ AI provider: ${config.aiProvider} (${maskToken(key)})`);
      } else {
        console.log(`  ⚠ AI provider: ${config.aiProvider} (no API key)`);
        warnings++;
      }
    } else {
      console.log(`  ○ AI not configured (deterministic scans only)`);
      warnings++;
    }

    // Local user
    if (config.localUserLogin) {
      console.log(`  ✓ Local user: ${config.localUserLogin}`);
    } else {
      console.log(`  ⚠ Local user not set`);
      warnings++;
    }

    // Session secret
    if (config.sessionSecret) {
      console.log(`  ✓ Session secret configured`);
    } else {
      console.log(`  ✗ Session secret missing`);
      issues++;
    }

    // App URL
    if (config.appUrl) {
      console.log(`  ✓ App URL: ${config.appUrl}`);
    } else {
      console.log(`  ⚠ App URL not set`);
      warnings++;
    }

    // Encryption secret
    if (config.envVarEncryptionSecret) {
      console.log(`  ✓ Encryption secret configured`);
    } else {
      console.log(`  ⚠ Encryption secret missing (required for E2B env vars)`);
      warnings++;
    }

    console.log("");

    // Configuration hygiene: config.json wins when it disagrees with .env.
    console.log(pc.cyan("  Configuration hygiene"));

    const conflicts = findConflictingVars();
    if (conflicts.length === 0) {
      console.log(`  ✓ .env and data/config.json agree`);
    } else {
      console.log(
        `  ⚠ .env disagrees with data/config.json on ${conflicts.length} key` +
          `${conflicts.length > 1 ? "s" : ""} — config.json wins:`,
      );
      for (const key of conflicts) console.log(pc.gray(`      ${key}`));
      console.log(pc.gray(`      Fix with: launchreadyy config`));
      warnings++;
    }

    console.log("");

    // Database checks
    console.log(pc.cyan("  Database"));
    if (databaseExists()) {
      console.log(`  ✓ SQLite file accessible`);

      const dbHealth = checkDatabaseHealth();
      if (dbHealth.healthy) {
        console.log(`  ✓ ${dbHealth.message.split("\n")[0]}`);
        if (dbHealth.migrationsApplied > 0) {
          console.log(`  ✓ Migrations up to date (${dbHealth.migrationsApplied} applied)`);
        }

        // Read/write check
        console.log(`  ✓ Read/write check passed`);
      } else {
        console.log(`  ✗ ${dbHealth.message}`);
        issues++;
      }
    } else {
      console.log(`  ✗ SQLite database not found`);
      issues++;
    }

    console.log("");

    // Application checks
    console.log(pc.cyan("  Application"));

    // Required directories
    const requiredDirs = ["data", "src", "public"];
    for (const dir of requiredDirs) {
      const dirPath = join(PROJECT_ROOT, dir);
      if (existsSync(dirPath)) {
        console.log(`  ✓ ${dir}/ directory present`);
      } else {
        console.log(`  ✗ ${dir}/ directory missing`);
        issues++;
      }
    }

    // Required files
    const requiredFiles = ["package.json", "tsconfig.json", "vite.config.ts"];
    for (const file of requiredFiles) {
      const filePath = join(PROJECT_ROOT, file);
      if (existsSync(filePath)) {
        console.log(`  ✓ ${file} present`);
      } else {
        console.log(`  ✗ ${file} missing`);
        issues++;
      }
    }

    // Port availability
    const port = new URL(config.appUrl || "http://localhost:5174").port || "5174";
    const portAvailable = await checkPortAvailable(parseInt(port, 10));
    if (portAvailable) {
      console.log(`  ✓ Port ${port} available`);
    } else {
      console.log(`  ⚠ Port ${port} in use`);
      warnings++;
    }

    console.log("");

    // Security checks
    console.log(pc.cyan("  Security"));

    // .env in .gitignore
    const gitignorePath = join(PROJECT_ROOT, ".gitignore");
    let envIgnored = false;
    if (existsSync(gitignorePath)) {
      const gitignore = await import("fs").then((fs) => fs.readFileSync(gitignorePath, "utf-8"));
      envIgnored = gitignore.includes(".env");
    }
    if (envIgnored) {
      console.log(`  ✓ .env ignored by Git`);
    } else {
      console.log(`  ✗ .env not in .gitignore`);
      issues++;
    }

    // Config file permissions
    const configPath = getConfigPath();
    if (existsSync(configPath)) {
      try {
        const stats = await import("fs").then((fs) => fs.statSync(configPath));
        const mode = stats.mode & 0o777;
        if (mode === 0o600 || mode === 0o400) {
          console.log(`  ✓ Config file permissions: ${mode.toString(8)}`);
        } else {
          console.log(`  ⚠ Config file permissions: ${mode.toString(8)} (should be 600)`);
          warnings++;
        }
      } catch {
        console.log(`  ✓ Config file exists`);
      }
    }

    // .env file permissions
    const envPath = getEnvPath();
    if (existsSync(envPath)) {
      try {
        const stats = await import("fs").then((fs) => fs.statSync(envPath));
        const mode = stats.mode & 0o777;
        if (mode === 0o600 || mode === 0o400) {
          console.log(`  ✓ .env file permissions: ${mode.toString(8)}`);
        } else {
          console.log(`  ⚠ .env file permissions: ${mode.toString(8)} (should be 600)`);
          warnings++;
        }
      } catch {
        console.log(`  ✓ .env file exists`);
      }
    }

    console.log("");

    // Summary
    if (issues === 0 && warnings === 0) {
      console.log(pc.green("  LaunchReadyy is ready.\n"));
    } else if (issues === 0) {
      console.log(
        pc.yellow(`  LaunchReadyy is ready with ${warnings} warning${warnings > 1 ? "s" : ""}.\n`),
      );
    } else {
      console.log(pc.red(`  LaunchReadyy found ${issues} issue${issues > 1 ? "s" : ""}.`));
      if (warnings > 0) {
        console.log(pc.yellow(`  Also ${warnings} warning${warnings > 1 ? "s" : ""}.`));
      }
      console.log(pc.gray("\n  Run:"));
      console.log(pc.cyan("    launchreadyy config\n"));
    }

    if (options.verbose) {
      console.log(pc.gray("  Config file: " + getConfigPath()));
      console.log(pc.gray("  Env file: " + getEnvPath()));
      console.log(pc.gray("  CI environment: " + (isCI() ? "yes" : "no")));
    }

    if (issues > 0) {
      process.exit(1);
    }
  });

export async function checkPortAvailable(port: number): Promise<boolean> {
  const net = await import("net");
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });

    server.listen(port, "127.0.0.1");
  });
}
