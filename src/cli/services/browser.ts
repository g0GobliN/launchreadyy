import open from "open";

export interface BrowserOpenResult {
  opened: boolean;
  message: string;
}

export async function openBrowser(url: string): Promise<BrowserOpenResult> {
  // Check if we're in an environment that can open a browser
  if (isCI() || !hasGraphicalEnvironment()) {
    return {
      opened: false,
      message: "Skipped (no graphical environment or CI detected)",
    };
  }

  try {
    await open(url, { wait: false });
    return {
      opened: true,
      message: "Opening browser...",
    };
  } catch (error) {
    return {
      opened: false,
      message: `Failed to open browser: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.BUILDKITE ||
    process.env.DRONE ||
    process.env.TEAMCITY_VERSION ||
    process.env.BITBUCKET_BUILD_NUMBER
  );
}

export function hasGraphicalEnvironment(): boolean {
  // On Linux, check for DISPLAY or WAYLAND_DISPLAY
  if (process.platform === "linux") {
    return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  }

  // On macOS and Windows, assume graphical environment exists
  // unless we're in a known headless environment
  if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) {
    return false;
  }

  return true;
}

export function getGitHubTokenUrl(): string {
  return "https://github.com/settings/tokens/new?scopes=repo,read:user,workflow&description=LaunchReadyy%20Community";
}

export function getE2BApiKeyUrl(): string {
  return "https://e2b.dev/docs/api-key";
}

export function getDeepSeekApiKeyUrl(): string {
  return "https://platform.deepseek.com/api-keys";
}

export function getAnthropicApiKeyUrl(): string {
  return "https://console.anthropic.com/settings/keys";
}

export function getOpenAIApiKeyUrl(): string {
  return "https://platform.openai.com/api-keys";
}

export function getGeminiApiKeyUrl(): string {
  return "https://aistudio.google.com/apikey";
}

export function getProviderKeyUrl(provider: string): string {
  switch (provider) {
    case "deepseek":
      return getDeepSeekApiKeyUrl();
    case "anthropic":
      return getAnthropicApiKeyUrl();
    case "openai":
      return getOpenAIApiKeyUrl();
    case "gemini":
      return getGeminiApiKeyUrl();
    default:
      return "";
  }
}
