import { Command } from "commander";
import { select, confirm, text, password } from "@clack/prompts";
import pc from "picocolors";
import { runEnvironmentChecks, formatCheck } from "../services/environment.js";
import { loadConfig, saveConfig, isConfigured, maskToken } from "../services/config.js";
import {
  validateGitHubToken,
  getTokenSetupUrl,
  maskToken as maskGhToken,
} from "../services/github.js";
import { openBrowser, getE2BApiKeyUrl, getProviderKeyUrl } from "../services/browser.js";
import { initializeDatabase, checkDatabaseHealth } from "../services/database.js";
import { existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");

function dirname(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

const SUPPORTED_AI_PROVIDERS = [
  { value: "deepseek", label: "DeepSeek", keyUrl: "https://platform.deepseek.com/api-keys" },
  {
    value: "anthropic",
    label: "Anthropic (Claude)",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  { value: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys" },
  { value: "gemini", label: "Google Gemini", keyUrl: "https://aistudio.google.com/apikey" },
] as const;

export const setupCommand = new Command("setup")
  .description("Configure LaunchReadyy for first use")
  .option("--non-interactive", "Run in non-interactive mode (requires env vars)")
  .action(async (options) => {
    console.log(pc.bold("\n  LaunchReadyy Community\n"));

    // Check if already configured
    if (isConfigured() && !options.nonInteractive) {
      console.log(pc.yellow("  LaunchReadyy is already configured."));
      const reconfigure = await confirm({
        message: "Re-run setup? This will overwrite existing configuration.",
        initialValue: false,
      });
      if (!reconfigure) {
        console.log(
          pc.gray("  Setup cancelled. Run 'launchreadyy start' to start the application.\n"),
        );
        process.exit(0);
      }
    }

    // Non-interactive mode
    if (options.nonInteractive || !process.stdin.isTTY) {
      await runNonInteractiveSetup();
      return;
    }

    await runInteractiveSetup();
  });

async function runInteractiveSetup() {
  console.log(pc.cyan("  Checking your system...\n"));

  // Environment checks
  const envResult = runEnvironmentChecks();
  for (const check of envResult.checks) {
    console.log(`  ${formatCheck(check)}`);
  }

  if (envResult.hasErrors) {
    console.log(
      pc.red("\n  Some checks failed. Please fix the errors above and run setup again.\n"),
    );
    process.exit(1);
  }

  console.log("");

  // Load existing config
  const config = loadConfig();

  // GitHub Token
  console.log(pc.bold("  GitHub"));
  if (!config.githubToken) {
    console.log(pc.gray("  No token configured.\n"));

    const openBrowserPrompt = await confirm({
      message: "Open GitHub token settings in browser?",
      initialValue: true,
    });

    if (openBrowserPrompt) {
      await openBrowser(getTokenSetupUrl());
    }

    const token = (await password({
      message: "GitHub personal access token:",
      validate: (value) => {
        if (!value || value.trim() === "") return "Token is required";
        return undefined;
      },
    })) as string;

    if (typeof token === "symbol") {
      console.log(pc.red("\n  Setup cancelled.\n"));
      process.exit(1);
    }

    console.log("  Validating token...");
    const validation = await validateGitHubToken(token);

    if (!validation.valid) {
      console.log(pc.red(`  ✗ ${validation.error}\n`));
      process.exit(1);
    }

    config.githubToken = token.trim();
    console.log(pc.green(`  ✓ GitHub connected as ${validation.user?.login}`));
  } else {
    console.log(pc.green(`  ✓ Already configured (${maskGhToken(config.githubToken)})`));

    // Validate existing token
    console.log("  Validating existing token...");
    const validation = await validateGitHubToken(config.githubToken);
    if (!validation.valid) {
      console.log(pc.yellow(`  ⚠ Token validation failed: ${validation.error}`));
      const reconfigure = await confirm({
        message: "Reconfigure GitHub token?",
        initialValue: true,
      });
      if (reconfigure) {
        const token = (await password({
          message: "GitHub personal access token:",
          validate: (value) => {
            if (!value || value.trim() === "") return "Token is required";
            return undefined;
          },
        })) as string;
        if (typeof token !== "symbol") {
          const newValidation = await validateGitHubToken(token);
          if (newValidation.valid) {
            config.githubToken = token.trim();
            console.log(pc.green(`  ✓ GitHub connected as ${newValidation.user?.login}`));
          }
        }
      }
    } else {
      console.log(pc.green(`  ✓ Token valid (${validation.user?.login})`));
    }
  }

  console.log("");

  // E2B Setup
  console.log(pc.bold("  Sandbox verification"));
  console.log(
    pc.gray("  E2B lets LaunchReadyy run install/build/lint/test inside isolated sandboxes."),
  );
  console.log(pc.gray("  You can skip this and enable it later.\n"));

  const useE2B = await confirm({
    message: "Enable sandbox verification with E2B?",
    initialValue: true,
  });

  if (useE2B) {
    const openE2B = await confirm({
      message: "Open E2B API key page in browser?",
      initialValue: true,
    });

    if (openE2B) {
      await openBrowser(getE2BApiKeyUrl());
    }

    const e2bKey = (await password({
      message: "E2B API key:",
      validate: (value) => {
        if (!value || value.trim() === "") return "API key is required";
        return undefined;
      },
    })) as string;

    if (typeof e2bKey !== "symbol") {
      config.e2bApiKey = e2bKey.trim();
      console.log(pc.green("  ✓ E2B configured"));
    }
  } else {
    config.e2bApiKey = undefined;
    console.log(pc.gray("  ○ E2B disabled (sandbox verification will not run)"));
  }

  console.log("");

  // AI Provider Setup
  console.log(pc.bold("  AI provider"));
  console.log(pc.gray("  AI is optional. Deterministic scans work without it.\n"));

  const aiChoice = (await select({
    message: "Choose an AI provider (or skip):",
    options: [
      ...SUPPORTED_AI_PROVIDERS.map((p) => ({ value: p.value, label: p.label })),
      { value: "skip", label: "Skip AI configuration" },
    ],
  })) as string;

  if (typeof aiChoice === "symbol") {
    console.log(pc.red("\n  Setup cancelled.\n"));
    process.exit(1);
  }

  if (aiChoice !== "skip") {
    config.aiProvider = aiChoice as "deepseek" | "anthropic" | "openai" | "gemini";

    const providerInfo = SUPPORTED_AI_PROVIDERS.find((p) => p.value === aiChoice);
    const openProvider = await confirm({
      message: `Open ${providerInfo?.label} API key page in browser?`,
      initialValue: true,
    });

    if (openProvider && providerInfo) {
      await openBrowser(providerInfo.keyUrl);
    }

    const keyName = `${aiChoice.toUpperCase()}_API_KEY`;
    const apiKey = (await password({
      message: `${providerInfo?.label} API key:`,
      validate: (value) => {
        if (!value || value.trim() === "") return "API key is required";
        return undefined;
      },
    })) as string;

    if (typeof apiKey !== "symbol") {
      switch (aiChoice) {
        case "deepseek":
          config.deepseekApiKey = apiKey.trim();
          break;
        case "anthropic":
          config.anthropicApiKey = apiKey.trim();
          break;
        case "openai":
          config.openaiApiKey = apiKey.trim();
          break;
        case "gemini":
          config.geminiApiKey = apiKey.trim();
          break;
      }
      console.log(pc.green(`  ✓ ${providerInfo?.label} configured`));
    }
  } else {
    config.aiProvider = undefined;
    console.log(pc.gray("  ○ AI disabled (deterministic scans only)"));
  }

  console.log("");

  // Local user config
  console.log(pc.bold("  Local user"));
  if (!config.localUserLogin) {
    const login = (await text({
      message: "GitHub username (for display):",
      placeholder: "your-github-username",
      defaultValue: "local",
    })) as string;

    if (typeof login !== "symbol") {
      config.localUserLogin = login.trim() || "local";
    }
  }

  if (!config.localUserEmail) {
    const email = (await text({
      message: "Email (optional, for display only):",
      placeholder: "you@example.com",
    })) as string;

    if (typeof email !== "symbol" && email.trim()) {
      config.localUserEmail = email.trim();
    }
  }

  // Generate session secret if not exists
  if (!config.sessionSecret) {
    const crypto = await import("crypto");
    config.sessionSecret = crypto.randomBytes(32).toString("hex");
  }

  // Generate encryption secret if not exists
  if (!config.envVarEncryptionSecret) {
    const crypto = await import("crypto");
    config.envVarEncryptionSecret = crypto.randomBytes(32).toString("hex");
  }

  // Set default app URL
  if (!config.appUrl) {
    config.appUrl = "http://localhost:5174";
  }

  console.log("");

  // Database initialization
  console.log(pc.bold("  Database"));
  const dbHealth = initializeDatabase();
  if (dbHealth.healthy) {
    console.log(pc.green(`  ✓ ${dbHealth.message.replace(/\n/g, "\n  ✓ ")}`));
  } else {
    console.log(pc.red(`  ✗ ${dbHealth.message}`));
    process.exit(1);
  }

  console.log("");

  // Save configuration
  saveConfig(config);
  console.log(pc.green("  Configuration saved"));

  // Final summary
  console.log(pc.bold("\n  Final check"));
  console.log(pc.green(`  ✓ GitHub: ${maskGhToken(config.githubToken || "")}`));
  console.log(
    pc.green(config.e2bApiKey ? `  ✓ E2B: ${maskToken(config.e2bApiKey)}` : `  ○ E2B: disabled`),
  );
  console.log(pc.green(config.aiProvider ? `  ✓ AI: ${config.aiProvider}` : `  ○ AI: disabled`));
  console.log(pc.green("  ✓ Database: ready"));
  console.log(pc.green("  ✓ Local user: configured"));

  console.log(pc.bold("\n  LaunchReadyy is ready.\n"));

  // Offer to start
  const startNow = await confirm({
    message: "Start LaunchReadyy now?",
    initialValue: true,
  });

  if (startNow) {
    // Import and run start command
    const { startCommand } = await import("./start.js");
    // We'll handle this in the main entry point
    process.exit(0); // Let main handle starting
  } else {
    console.log(pc.gray("\n  Run 'launchreadyy start' to start the application.\n"));
  }
}

async function runNonInteractiveSetup() {
  console.log("Running non-interactive setup...");

  // Read from environment variables
  const config = loadConfig();

  if (process.env.GITHUB_TOKEN) {
    config.githubToken = process.env.GITHUB_TOKEN;
    const validation = await validateGitHubToken(config.githubToken);
    if (!validation.valid) {
      console.error(`GitHub token validation failed: ${validation.error}`);
      process.exit(1);
    }
  }

  if (process.env.E2B_API_KEY) {
    config.e2bApiKey = process.env.E2B_API_KEY;
  }

  if (process.env.AI_PROVIDER) {
    config.aiProvider = process.env.AI_PROVIDER as "deepseek" | "anthropic" | "openai" | "gemini";
  }

  if (process.env.DEEPSEEK_API_KEY) config.deepseekApiKey = process.env.DEEPSEEK_API_KEY;
  if (process.env.ANTHROPIC_API_KEY) config.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) config.openaiApiKey = process.env.OPENAI_API_KEY;
  if (process.env.GEMINI_API_KEY) config.geminiApiKey = process.env.GEMINI_API_KEY;

  if (process.env.LOCAL_USER_LOGIN) config.localUserLogin = process.env.LOCAL_USER_LOGIN;
  if (process.env.LOCAL_USER_EMAIL) config.localUserEmail = process.env.LOCAL_USER_EMAIL;
  if (process.env.SESSION_SECRET) config.sessionSecret = process.env.SESSION_SECRET;
  if (process.env.APP_URL) config.appUrl = process.env.APP_URL;
  if (process.env.ENV_VAR_ENCRYPTION_SECRET)
    config.envVarEncryptionSecret = process.env.ENV_VAR_ENCRYPTION_SECRET;
  if (process.env.E2B_TEMPLATE_ID) config.e2bTemplateId = process.env.E2B_TEMPLATE_ID;

  // Generate secrets if not provided
  if (!config.sessionSecret) {
    const crypto = await import("crypto");
    config.sessionSecret = crypto.randomBytes(32).toString("hex");
  }

  if (!config.envVarEncryptionSecret) {
    const crypto = await import("crypto");
    config.envVarEncryptionSecret = crypto.randomBytes(32).toString("hex");
  }

  if (!config.appUrl) {
    config.appUrl = "http://localhost:5174";
  }

  if (!config.localUserLogin) {
    config.localUserLogin = "local";
  }

  // Initialize database
  const dbHealth = initializeDatabase();
  if (!dbHealth.healthy) {
    console.error(`Database initialization failed: ${dbHealth.message}`);
    process.exit(1);
  }

  saveConfig(config);
  console.log("Setup complete.");
}
