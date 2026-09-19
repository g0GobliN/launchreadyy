import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}));

vi.mock("os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

vi.mock("path", () => ({
  join: vi.fn((...args) => args.join("/")),
  dirname: vi.fn((p) => p.split("/").slice(0, -1).join("/")),
}));

vi.mock("url", () => ({
  fileURLToPath: vi.fn((url) => url.replace("file://", "")),
}));

const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockChmodSync = vi.mocked(chmodSync);

import * as configModule from "./config.js";

describe("config service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("loadConfig", () => {
    it("returns empty config when neither config.json nor .env exist", () => {
      mockExistsSync.mockReturnValue(false);

      const config = configModule.loadConfig();

      expect(config).toEqual({});
    });

    it("loads config from config.json when it exists", () => {
      mockExistsSync.mockImplementation((path) => {
        if (path.toString().includes("config.json")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path) => {
        if (path.toString().includes("config.json")) {
          return JSON.stringify({ githubToken: "ghp_test1234", aiProvider: "anthropic" });
        }
        return "";
      });

      const config = configModule.loadConfig();

      expect(config.githubToken).toBe("ghp_test1234");
      expect(config.aiProvider).toBe("anthropic");
    });

    it("falls back to .env when config.json is invalid", () => {
      mockExistsSync.mockImplementation((path) => {
        if (path.toString().includes("config.json")) return true;
        if (path.toString().includes(".env")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path) => {
        if (path.toString().includes("config.json")) {
          return "invalid json";
        }
        if (path.toString().includes(".env")) {
          return "GITHUB_TOKEN=ghp_env1234\nAI_PROVIDER=openai";
        }
        return "";
      });

      const config = configModule.loadConfig();

      expect(config.githubToken).toBe("ghp_env1234");
      expect(config.aiProvider).toBe("openai");
    });

    it("parses .env with quoted values", () => {
      mockExistsSync.mockImplementation((path) => path.toString().includes(".env"));
      mockReadFileSync.mockReturnValue(
        'GITHUB_TOKEN="ghp_quoted123"\n# Comment line\nAI_PROVIDER=gemini', // gitleaks:allow
      );

      const config = configModule.loadConfig();

      expect(config.githubToken).toBe("ghp_quoted123");
      expect(config.aiProvider).toBe("gemini");
    });

    it("parses all supported .env keys", () => {
      mockExistsSync.mockImplementation((path) => path.toString().includes(".env"));
      mockReadFileSync.mockReturnValue(
        "GITHUB_TOKEN=ghp_all\n" +
          "E2B_API_KEY=e2b_key\n" +
          "AI_PROVIDER=deepseek\n" +
          "DEEPSEEK_API_KEY=ds_key\n" +
          "ANTHROPIC_API_KEY=anth_key\n" +
          "OPENAI_API_KEY=oa_key\n" +
          "GEMINI_API_KEY=gem_key\n" +
          "LOCAL_USER_LOGIN=testuser\n" +
          "LOCAL_USER_EMAIL=test@example.com\n" +
          "LOCAL_USER_AVATAR_URL=https://avatar.url\n" +
          "SESSION_SECRET=secret\n" +
          "APP_URL=https://app.url\n" +
          "ENV_VAR_ENCRYPTION_SECRET=enc_secret\n" +
          "E2B_TEMPLATE_ID=template_123",
      );

      const config = configModule.loadConfig();

      expect(config.githubToken).toBe("ghp_all");
      expect(config.e2bApiKey).toBe("e2b_key");
      expect(config.aiProvider).toBe("deepseek");
      expect(config.deepseekApiKey).toBe("ds_key");
      expect(config.anthropicApiKey).toBe("anth_key");
      expect(config.openaiApiKey).toBe("oa_key");
      expect(config.geminiApiKey).toBe("gem_key");
      expect(config.localUserLogin).toBe("testuser");
      expect(config.localUserEmail).toBe("test@example.com");
      expect(config.localUserAvatarUrl).toBe("https://avatar.url");
      expect(config.sessionSecret).toBe("secret");
      expect(config.appUrl).toBe("https://app.url");
      expect(config.envVarEncryptionSecret).toBe("enc_secret");
      expect(config.e2bTemplateId).toBe("template_123");
    });
  });

  describe("saveConfig", () => {
    it("writes config to config.json and updates .env", () => {
      mockExistsSync.mockReturnValue(false);

      configModule.saveConfig({ githubToken: "ghp_save123", aiProvider: "anthropic" });

      expect(mockMkdirSync).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
      expect(mockChmodSync).toHaveBeenCalledTimes(2);
    });

    it("handles chmod errors gracefully on Windows", () => {
      mockExistsSync.mockReturnValue(false);
      mockChmodSync.mockImplementation(() => {
        throw new Error("EPERM");
      });

      expect(() => configModule.saveConfig({ githubToken: "ghp_test" })).not.toThrow();
    });
  });

  describe("maskToken", () => {
    it("returns 'not configured' for undefined", () => {
      expect(configModule.maskToken(undefined)).toBe("not configured");
    });

    it("returns 'not configured' for empty string", () => {
      expect(configModule.maskToken("")).toBe("not configured");
    });

    it("returns '****' for short tokens", () => {
      expect(configModule.maskToken("abc")).toBe("****");
      expect(configModule.maskToken("12345678")).toBe("****");
    });

    it("masks middle of long tokens", () => {
      expect(configModule.maskToken("ghp_abcdefghijklmnop")).toBe("ghp_****mnop");
      expect(configModule.maskToken("sk-1234567890abcdef")).toBe("sk-1****cdef");
    });
  });

  describe("isConfigured", () => {
    it("returns true when githubToken exists", () => {
      mockExistsSync.mockImplementation((path) => path.toString().includes("config.json"));
      mockReadFileSync.mockReturnValue(JSON.stringify({ githubToken: "ghp_test" }));

      expect(configModule.isConfigured()).toBe(true);
    });

    it("returns false when githubToken is missing", () => {
      mockExistsSync.mockImplementation((path) => path.toString().includes("config.json"));
      mockReadFileSync.mockReturnValue(JSON.stringify({ aiProvider: "anthropic" }));

      expect(configModule.isConfigured()).toBe(false);
    });
  });

  describe("getConfigPath and getEnvPath", () => {
    it("returns expected paths", () => {
      expect(configModule.getConfigPath()).toContain("data/config.json");
      expect(configModule.getEnvPath()).toContain(".env");
    });
  });
});
