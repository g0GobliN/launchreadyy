import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const createMockFetch = () => vi.fn();

let mockFetch: ReturnType<typeof createMockFetch>;

vi.mock("fetch", () => ({ default: vi.fn() }));

import * as githubModule from "./github.js";

describe("github service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = createMockFetch();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("validateGitHubToken", () => {
    it("returns invalid for empty token", async () => {
      const result = await githubModule.validateGitHubToken("");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Token is empty");
    });

    it("returns invalid for whitespace-only token", async () => {
      const result = await githubModule.validateGitHubToken("   ");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Token is empty");
    });

    it("returns valid with user when token is valid and has scopes", async () => {
      const mockUser = {
        login: "testuser",
        name: "Test User",
        avatar_url: "https://avatar.url",
        email: "test@example.com",
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockUser,
          headers: new Map([["x-oauth-scopes", "repo, read:user, workflow"]]),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([["x-oauth-scopes", "repo, read:user, workflow"]]),
        } as unknown as Response);

      const result = await githubModule.validateGitHubToken("ghp_validtoken1234567890");

      expect(result.valid).toBe(true);
      expect(result.user).toEqual(mockUser);
      expect(result.scopes).toEqual(["repo", "read:user", "workflow"]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("returns invalid for 401 Unauthorized", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      } as unknown as Response);

      const result = await githubModule.validateGitHubToken("ghp_invalid");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid token (401 Unauthorized)");
    });

    it("returns invalid for 403 Forbidden", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      } as unknown as Response);

      const result = await githubModule.validateGitHubToken("ghp_forbidden");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Token forbidden (403) - may have expired or been revoked");
    });

    it("returns invalid for other HTTP errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as unknown as Response);

      const result = await githubModule.validateGitHubToken("ghp_error");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("GitHub API error: 500 Internal Server Error");
    });

    it("returns invalid when required scopes are missing", async () => {
      const mockUser = { login: "testuser", name: null, avatar_url: "", email: null };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockUser,
          headers: new Map([["x-oauth-scopes", "read:user"]]),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([["x-oauth-scopes", "read:user"]]),
        } as unknown as Response);

      const result = await githubModule.validateGitHubToken("ghp_limitedscope");

      expect(result.valid).toBe(false);
      expect(result.user).toEqual(mockUser);
      expect(result.scopes).toEqual(["read:user"]);
      expect(result.error).toContain("missing required scopes");
      expect(result.error).toContain("repo");
      expect(result.error).toContain("workflow");
    });

    it("returns invalid for network errors", async () => {
      const networkError = new TypeError("Failed to fetch");
      mockFetch.mockRejectedValueOnce(networkError);

      const result = await githubModule.validateGitHubToken("ghp_network");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Network error - check your internet connection");
    });

    it("returns invalid for other fetch errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Some other error"));

      const result = await githubModule.validateGitHubToken("ghp_error");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Validation failed: Some other error");
    });

    it("trims token before validation", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test", name: null, avatar_url: "", email: null }),
          headers: new Map([["x-oauth-scopes", "repo, read:user, workflow"]]),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([["x-oauth-scopes", "repo, read:user, workflow"]]),
        } as unknown as Response);

      await githubModule.validateGitHubToken("  ghp_trimmed  ");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/user",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_trimmed",
          }),
        }),
      );
    });

    it("uses x-accepted-oauth-scopes header when x-oauth-scopes not present", async () => {
      const mockUser = { login: "testuser", name: null, avatar_url: "", email: null };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockUser,
          headers: new Map([["x-accepted-oauth-scopes", "repo, read:user, workflow"]]),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([["x-accepted-oauth-scopes", "repo, read:user, workflow"]]),
        } as unknown as Response);

      const result = await githubModule.validateGitHubToken("ghp_test");

      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual(["repo", "read:user", "workflow"]);
    });

    it("handles empty scopes header", async () => {
      const mockUser = { login: "testuser", name: null, avatar_url: "", email: null };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockUser,
          headers: new Map([["x-oauth-scopes", ""]]),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([["x-oauth-scopes", ""]]),
        } as unknown as Response);

      const result = await githubModule.validateGitHubToken("ghp_test");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("missing required scopes");
    });
  });

  describe("getTokenSetupUrl", () => {
    it("returns correct GitHub token creation URL", () => {
      const url = githubModule.getTokenSetupUrl();
      expect(url).toBe(
        "https://github.com/settings/tokens/new?scopes=repo,read:user,workflow&description=LaunchReadyy%20Community",
      );
    });
  });

  describe("maskToken", () => {
    it("returns **** for short tokens", () => {
      expect(githubModule.maskToken("abc")).toBe("****");
      expect(githubModule.maskToken("12345678")).toBe("****");
    });

    it("masks middle of long tokens", () => {
      expect(githubModule.maskToken("ghp_abcdefghijklmnop")).toBe("ghp_****mnop");
      expect(githubModule.maskToken("sk-1234567890abcdef")).toBe("sk-1****cdef");
    });
  });
});
