import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChildProcess } from "node:child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock("open", () => ({
  default: vi.fn(),
}));

import * as browserModule from "./browser.js";
import open from "open";

const mockOpen = vi.mocked(open);

describe("browser service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockReset();
    vi.stubGlobal("process", {
      ...process,
      platform: "linux",
      env: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("openBrowser", () => {
    it("skips opening in CI environment", async () => {
      vi.stubGlobal("process", { ...process, env: { CI: "true" }, platform: "linux" });

      const result = await browserModule.openBrowser("https://example.com");

      expect(result.opened).toBe(false);
      expect(result.message).toContain("Skipped (no graphical environment or CI detected)");
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it("skips opening in GitHub Actions", async () => {
      vi.stubGlobal("process", { ...process, env: { GITHUB_ACTIONS: "true" }, platform: "linux" });

      const result = await browserModule.openBrowser("https://example.com");

      expect(result.opened).toBe(false);
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it("skips opening on Linux without display", async () => {
      vi.stubGlobal("process", { ...process, platform: "linux", env: {} });

      const result = await browserModule.openBrowser("https://example.com");

      expect(result.opened).toBe(false);
      expect(result.message).toContain("Skipped");
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it("opens browser on Linux with DISPLAY", async () => {
      vi.stubGlobal("process", { ...process, platform: "linux", env: { DISPLAY: ":0" } });
      mockOpen.mockResolvedValue({} as ChildProcess);

      const result = await browserModule.openBrowser("https://example.com");

      expect(result.opened).toBe(true);
      expect(result.message).toBe("Opening browser...");
      expect(mockOpen).toHaveBeenCalledWith("https://example.com", { wait: false });
    });

    it("opens browser on Linux with WAYLAND_DISPLAY", async () => {
      vi.stubGlobal("process", {
        ...process,
        platform: "linux",
        env: { WAYLAND_DISPLAY: "wayland-0" },
      });
      mockOpen.mockResolvedValue({} as ChildProcess);

      const result = await browserModule.openBrowser("https://example.com");

      expect(result.opened).toBe(true);
      expect(mockOpen).toHaveBeenCalled();
    });

    it("opens browser on macOS without SSH", async () => {
      vi.stubGlobal("process", { ...process, platform: "darwin", env: {} });
      mockOpen.mockResolvedValue({} as ChildProcess);

      const result = await browserModule.openBrowser("https://example.com");

      expect(result.opened).toBe(true);
      expect(mockOpen).toHaveBeenCalled();
    });

    it("skips opening on macOS with SSH", async () => {
      vi.stubGlobal("process", { ...process, platform: "darwin", env: { SSH_CONNECTION: "1" } });

      const result = await browserModule.openBrowser("https://example.com");

      expect(result.opened).toBe(false);
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it("opens browser on Windows without SSH", async () => {
      vi.stubGlobal("process", { ...process, platform: "win32", env: {} });
      mockOpen.mockResolvedValue({} as ChildProcess);

      const result = await browserModule.openBrowser("https://example.com");

      expect(result.opened).toBe(true);
      expect(mockOpen).toHaveBeenCalled();
    });

    it("returns error when open fails", async () => {
      vi.stubGlobal("process", { ...process, platform: "darwin", env: {} });
      mockOpen.mockRejectedValue(new Error("Permission denied"));

      const result = await browserModule.openBrowser("https://example.com");

      expect(result.opened).toBe(false);
      expect(result.message).toContain("Failed to open browser: Permission denied");
    });

    it("returns error for non-Error rejection", async () => {
      vi.stubGlobal("process", { ...process, platform: "darwin", env: {} });
      mockOpen.mockRejectedValue("string error");

      const result = await browserModule.openBrowser("https://example.com");

      expect(result.opened).toBe(false);
      expect(result.message).toContain("Failed to open browser: string error");
    });
  });

  describe("isCI", () => {
    it("returns true for various CI environment variables", () => {
      const ciVars = [
        "CI",
        "GITHUB_ACTIONS",
        "GITLAB_CI",
        "CIRCLECI",
        "TRAVIS",
        "BUILDKITE",
        "DRONE",
        "TEAMCITY_VERSION",
        "BITBUCKET_BUILD_NUMBER",
      ];

      for (const varName of ciVars) {
        vi.stubGlobal("process", { ...process, env: { [varName]: "true" } });
        expect(browserModule.isCI()).toBe(true);
      }
    });

    it("returns false when no CI vars set", () => {
      vi.stubGlobal("process", { ...process, env: {} });
      expect(browserModule.isCI()).toBe(false);
    });
  });

  describe("hasGraphicalEnvironment", () => {
    it("returns true on Linux with DISPLAY", () => {
      vi.stubGlobal("process", { ...process, platform: "linux", env: { DISPLAY: ":0" } });
      expect(browserModule.hasGraphicalEnvironment()).toBe(true);
    });

    it("returns true on Linux with WAYLAND_DISPLAY", () => {
      vi.stubGlobal("process", {
        ...process,
        platform: "linux",
        env: { WAYLAND_DISPLAY: "wayland-0" },
      });
      expect(browserModule.hasGraphicalEnvironment()).toBe(true);
    });

    it("returns false on Linux without display", () => {
      vi.stubGlobal("process", { ...process, platform: "linux", env: {} });
      expect(browserModule.hasGraphicalEnvironment()).toBe(false);
    });

    it("returns false on macOS with SSH_CONNECTION", () => {
      vi.stubGlobal("process", { ...process, platform: "darwin", env: { SSH_CONNECTION: "1" } });
      expect(browserModule.hasGraphicalEnvironment()).toBe(false);
    });

    it("returns false on macOS with SSH_CLIENT", () => {
      vi.stubGlobal("process", { ...process, platform: "darwin", env: { SSH_CLIENT: "1" } });
      expect(browserModule.hasGraphicalEnvironment()).toBe(false);
    });

    it("returns false on macOS with SSH_TTY", () => {
      vi.stubGlobal("process", { ...process, platform: "darwin", env: { SSH_TTY: "1" } });
      expect(browserModule.hasGraphicalEnvironment()).toBe(false);
    });

    it("returns true on macOS without SSH", () => {
      vi.stubGlobal("process", { ...process, platform: "darwin", env: {} });
      expect(browserModule.hasGraphicalEnvironment()).toBe(true);
    });

    it("returns true on Windows without SSH", () => {
      vi.stubGlobal("process", { ...process, platform: "win32", env: {} });
      expect(browserModule.hasGraphicalEnvironment()).toBe(true);
    });

    it("returns false on Windows with SSH", () => {
      vi.stubGlobal("process", { ...process, platform: "win32", env: { SSH_CONNECTION: "1" } });
      expect(browserModule.hasGraphicalEnvironment()).toBe(false);
    });
  });

  describe("getProviderKeyUrl", () => {
    it("returns correct URL for deepseek", () => {
      expect(browserModule.getProviderKeyUrl("deepseek")).toBe(
        "https://platform.deepseek.com/api-keys",
      );
    });

    it("returns correct URL for anthropic", () => {
      expect(browserModule.getProviderKeyUrl("anthropic")).toBe(
        "https://console.anthropic.com/settings/keys",
      );
    });

    it("returns correct URL for openai", () => {
      expect(browserModule.getProviderKeyUrl("openai")).toBe(
        "https://platform.openai.com/api-keys",
      );
    });

    it("returns correct URL for gemini", () => {
      expect(browserModule.getProviderKeyUrl("gemini")).toBe("https://aistudio.google.com/apikey");
    });

    it("returns empty string for unknown provider", () => {
      expect(browserModule.getProviderKeyUrl("unknown")).toBe("");
    });
  });

  describe("getGitHubTokenUrl", () => {
    it("returns correct GitHub token URL", () => {
      expect(browserModule.getGitHubTokenUrl()).toBe(
        "https://github.com/settings/tokens/new?scopes=repo,read:user,workflow&description=LaunchReadyy%20Community",
      );
    });
  });

  describe("getE2BApiKeyUrl", () => {
    it("returns correct E2B API key URL", () => {
      expect(browserModule.getE2BApiKeyUrl()).toBe("https://e2b.dev/docs/api-key");
    });
  });

  describe("getDeepSeekApiKeyUrl", () => {
    it("returns correct DeepSeek API key URL", () => {
      expect(browserModule.getDeepSeekApiKeyUrl()).toBe("https://platform.deepseek.com/api-keys");
    });
  });

  describe("getAnthropicApiKeyUrl", () => {
    it("returns correct Anthropic API key URL", () => {
      expect(browserModule.getAnthropicApiKeyUrl()).toBe(
        "https://console.anthropic.com/settings/keys",
      );
    });
  });

  describe("getOpenAIApiKeyUrl", () => {
    it("returns correct OpenAI API key URL", () => {
      expect(browserModule.getOpenAIApiKeyUrl()).toBe("https://platform.openai.com/api-keys");
    });
  });

  describe("getGeminiApiKeyUrl", () => {
    it("returns correct Gemini API key URL", () => {
      expect(browserModule.getGeminiApiKeyUrl()).toBe("https://aistudio.google.com/apikey");
    });
  });
});
