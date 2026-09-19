import { Command } from "commander";
import { select, confirm, text, password } from "@clack/prompts";
import pc from "picocolors";
import type { LaunchReadyyConfig } from "../services/config.js";
import { loadConfig, saveConfig, maskToken } from "../services/config.js";
import {
  validateGitHubToken,
  getTokenSetupUrl,
  maskToken as maskGhToken,
} from "../services/github.js";
import { openBrowser, getE2BApiKeyUrl, getProviderKeyUrl } from "../services/browser.js";
import { fileURLToPath } from "url";
import { join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");

function dirname(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

const SUPPORTED_AI_PROVIDERS = [
  { value: "deepseek", label: "DeepSeek" },
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Google Gemini" },
] as const;

export const configCommand = new Command("config")
  .description("Update configuration")
  .action(async () => {
    console.log(pc.bold("\n  LaunchReadyy Configuration\n"));

    const config = loadConfig();

    // Display current status
    console.log(pc.cyan("  Current configuration:\n"));

    console.log(
      `  GitHub:     ${config.githubToken ? pc.green(`✓ ${maskGhToken(config.githubToken)}`) : pc.gray("○ not configured")}`,
    );
    console.log(
      `  E2B:        ${config.e2bApiKey ? pc.green(`✓ ${maskToken(config.e2bApiKey)}`) : pc.gray("○ disabled")}`,
    );
    console.log(
      `  AI Provider: ${config.aiProvider ? pc.green(`✓ ${config.aiProvider}`) : pc.gray("○ disabled")}`,
    );
    console.log(
      `  Local User: ${config.localUserLogin ? pc.green(`✓ ${config.localUserLogin}`) : pc.gray("○ not set")}`,
    );
    console.log(
      `  App URL:    ${config.appUrl ? pc.green(`✓ ${config.appUrl}`) : pc.gray("○ not set")}`,
    );
    console.log("");

    const choice = (await select({
      message: "What would you like to change?",
      options: [
        { value: "github", label: "GitHub token" },
        { value: "e2b", label: "E2B API key" },
        { value: "ai", label: "AI provider" },
        { value: "user", label: "Local user" },
        { value: "app", label: "App URL" },
        { value: "secrets", label: "Regenerate secrets" },
        { value: "view", label: "View config paths" },
        { value: "exit", label: "Exit" },
      ],
    })) as string;

    if (typeof choice === "symbol" || choice === "exit") {
      console.log(pc.gray("\n  No changes made.\n"));
      return;
    }

    switch (choice) {
      case "github":
        await configureGitHub(config);
        break;
      case "e2b":
        await configureE2B(config);
        break;
      case "ai":
        await configureAI(config);
        break;
      case "user":
        await configureUser(config);
        break;
      case "app":
        await configureApp(config);
        break;
      case "secrets":
        await regenerateSecrets(config);
        break;
      case "view":
        await viewConfigPaths();
        break;
    }

    saveConfig(config);
    console.log(pc.green("\n  Configuration saved.\n"));
  });

async function configureGitHub(config: LaunchReadyyConfig) {
  console.log(pc.bold("\n  GitHub Configuration\n"));

  if (config.githubToken) {
    const validation = await validateGitHubToken(config.githubToken);
    if (validation.valid) {
      console.log(
        `  Current token: ${maskGhToken(config.githubToken)} (${validation.user?.login})`,
      );
    } else {
      console.log(
        pc.yellow(
          `  Current token: ${maskGhToken(config.githubToken)} (invalid: ${validation.error})`,
        ),
      );
    }
  } else {
    console.log(pc.gray("  No token configured."));
  }

  const action = (await select({
    message: "Choose action:",
    options: [
      { value: "update", label: "Update token" },
      { value: "remove", label: "Remove token" },
      { value: "back", label: "Back" },
    ],
  })) as string;

  if (action === "update" || (typeof action === "symbol" && action === "update")) {
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

    if (typeof token !== "symbol") {
      const validation = await validateGitHubToken(token);
      if (!validation.valid) {
        console.log(pc.red(`  ✗ ${validation.error}`));
        return;
      }
      config.githubToken = token.trim();
      console.log(pc.green(`  ✓ Updated (${validation.user?.login})`));
    }
  } else if (action === "remove") {
    config.githubToken = undefined;
    console.log(pc.gray("  GitHub token removed."));
  }
}

async function configureE2B(config: LaunchReadyyConfig) {
  console.log(pc.bold("\n  E2B Configuration\n"));

  if (config.e2bApiKey) {
    console.log(`  Current: ${maskToken(config.e2bApiKey)}`);
  } else {
    console.log(pc.gray("  E2B is disabled."));
  }

  const action = (await select({
    message: "Choose action:",
    options: [
      { value: "enable", label: "Enable/Update E2B" },
      { value: "disable", label: "Disable E2B" },
      { value: "back", label: "Back" },
    ],
  })) as string;

  if (action === "enable") {
    const openBrowserPrompt = await confirm({
      message: "Open E2B API key page in browser?",
      initialValue: true,
    });

    if (openBrowserPrompt) {
      await openBrowser(getE2BApiKeyUrl());
    }

    const apiKey = (await password({
      message: "E2B API key:",
      validate: (value) => {
        if (!value || value.trim() === "") return "API key is required";
        return undefined;
      },
    })) as string;

    if (typeof apiKey !== "symbol") {
      config.e2bApiKey = apiKey.trim();
      console.log(pc.green("  ✓ E2B configured"));
    }
  } else if (action === "disable") {
    config.e2bApiKey = undefined;
    console.log(pc.gray("  E2B disabled."));
  }
}

async function configureAI(config: LaunchReadyyConfig) {
  console.log(pc.bold("\n  AI Provider Configuration\n"));

  if (config.aiProvider) {
    const keyMap: Record<string, string | undefined> = {
      deepseek: config.deepseekApiKey,
      anthropic: config.anthropicApiKey,
      openai: config.openaiApiKey,
      gemini: config.geminiApiKey,
    };
    const key = keyMap[config.aiProvider];
    console.log(
      `  Current: ${config.aiProvider} ${key ? `(${maskToken(key)})` : pc.yellow("(no API key)")}`,
    );
  } else {
    console.log(pc.gray("  No AI provider configured."));
  }

  const action = (await select({
    message: "Choose action:",
    options: [
      { value: "change", label: "Change provider" },
      { value: "remove", label: "Remove AI provider" },
      { value: "back", label: "Back" },
    ],
  })) as string;

  if (action === "change") {
    const provider = (await select({
      message: "Select AI provider:",
      options: [
        ...SUPPORTED_AI_PROVIDERS.map((p) => ({ value: p.value, label: p.label })),
        { value: "back", label: "Back" },
      ],
    })) as string;

    if (typeof provider === "symbol" || provider === "back") return;

    config.aiProvider = provider as LaunchReadyyConfig["aiProvider"];

    const providerInfo = SUPPORTED_AI_PROVIDERS.find((p) => p.value === provider);
    const openProvider = await confirm({
      message: `Open ${providerInfo?.label} API key page in browser?`,
      initialValue: true,
    });

    if (openProvider && providerInfo) {
      await openBrowser(getProviderKeyUrl(provider));
    }

    const apiKey = (await password({
      message: `${providerInfo?.label} API key:`,
      validate: (value) => {
        if (!value || value.trim() === "") return "API key is required";
        return undefined;
      },
    })) as string;

    if (typeof apiKey !== "symbol") {
      switch (provider) {
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
  } else if (action === "remove") {
    config.aiProvider = undefined;
    config.deepseekApiKey = undefined;
    config.anthropicApiKey = undefined;
    config.openaiApiKey = undefined;
    config.geminiApiKey = undefined;
    console.log(pc.gray("  AI provider removed."));
  }
}

async function configureUser(config: LaunchReadyyConfig) {
  console.log(pc.bold("\n  Local User Configuration\n"));

  const login = (await text({
    message: "GitHub username:",
    defaultValue: config.localUserLogin || "local",
  })) as string;

  if (typeof login !== "symbol") {
    config.localUserLogin = login.trim() || "local";
  }

  const email = (await text({
    message: "Email (optional):",
    defaultValue: config.localUserEmail || "",
    placeholder: "you@example.com",
  })) as string;

  if (typeof email !== "symbol") {
    config.localUserEmail = email.trim() || undefined;
  }

  console.log(pc.green("  ✓ Local user updated"));
}

async function configureApp(config: LaunchReadyyConfig) {
  console.log(pc.bold("\n  App URL Configuration\n"));

  const url = (await text({
    message: "App URL:",
    defaultValue: config.appUrl || "http://localhost:5174",
    validate: (value) => {
      if (!value || value.trim() === "") return "URL is required";
      try {
        new URL(value.trim());
      } catch {
        return "Invalid URL";
      }
      return undefined;
    },
  })) as string;

  if (typeof url !== "symbol") {
    config.appUrl = url.trim();
    config.appUrl = config.appUrl.replace(/\/+$/, ""); // Remove trailing slash
    console.log(pc.green(`  ✓ App URL updated to ${config.appUrl}`));
  }
}

async function regenerateSecrets(config: LaunchReadyyConfig) {
  console.log(pc.bold("\n  Regenerate Secrets\n"));
  console.log(pc.yellow("  This will generate new session and encryption secrets."));
  console.log(pc.yellow("  Existing sessions and encrypted data will become invalid.\n"));

  const confirmed = await confirm({
    message: "Continue?",
    initialValue: false,
  });

  if (!confirmed) {
    console.log(pc.gray("  Cancelled."));
    return;
  }

  const crypto = await import("crypto");
  config.sessionSecret = crypto.randomBytes(32).toString("hex");
  config.envVarEncryptionSecret = crypto.randomBytes(32).toString("hex");

  console.log(pc.green("  ✓ Secrets regenerated"));
}

async function viewConfigPaths() {
  const { getConfigPath, getEnvPath } = await import("../services/config.js");
  console.log(pc.bold("\n  Configuration Paths\n"));
  console.log(`  Config file: ${getConfigPath()}`);
  console.log(`  Env file:    ${getEnvPath()}`);
  console.log(`  Database:    data/launchreadyy.db`);
  console.log("");
}
