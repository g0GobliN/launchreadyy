import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { existsSync, accessSync, constants } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  accessSync: vi.fn(),
  constants: { W_OK: 2 },
}));

vi.mock("path", () => ({
  join: vi.fn((...args) => args.join("/")),
  dirname: vi.fn((p) => p.split("/").slice(0, -1).join("/")),
}));

vi.mock("url", () => ({
  fileURLToPath: vi.fn((url) => url.replace("file://", "")),
}));

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockAccessSync = vi.mocked(accessSync);

import * as envModule from "./environment.js";

describe("environment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("process", {
      ...process,
      version: "v22.14.0",
      platform: "linux",
      env: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("checkNodeVersion", () => {
    it("returns ok for Node 22.13+", () => {
      vi.stubGlobal("process", { ...process, version: "v22.14.0" });

      const check = envModule.runEnvironmentChecks().checks.find((c) => c.name === "Node.js");

      expect(check?.status).toBe("ok");
      expect(check?.message).toContain("v22.14.0");
    });

    it("returns ok for Node 20.19+", () => {
      vi.stubGlobal("process", { ...process, version: "v20.19.0" });

      const check = envModule.runEnvironmentChecks().checks.find((c) => c.name === "Node.js");

      expect(check?.status).toBe("ok");
    });

    it("returns error for Node 20.18", () => {
      vi.stubGlobal("process", { ...process, version: "v20.18.0" });

      const check = envModule.runEnvironmentChecks().checks.find((c) => c.name === "Node.js");

      expect(check?.status).toBe("error");
      expect(check?.fix).toContain("nodejs.org");
    });

    it("returns error for Node 18", () => {
      vi.stubGlobal("process", { ...process, version: "v18.20.0" });

      const check = envModule.runEnvironmentChecks().checks.find((c) => c.name === "Node.js");

      expect(check?.status).toBe("error");
    });
  });

  describe("checkGit", () => {
    it("returns ok when git is available", () => {
      mockExecSync.mockReturnValue("git version 2.43.0");

      const check = envModule.runEnvironmentChecks().checks.find((c) => c.name === "Git");

      expect(check?.status).toBe("ok");
      expect(check?.message).toBe("git version 2.43.0");
    });

    it("returns error when git is not found", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      const check = envModule.runEnvironmentChecks().checks.find((c) => c.name === "Git");

      expect(check?.status).toBe("error");
      expect(check?.message).toBe("not found");
      expect(check?.fix).toContain("git-scm.com");
    });
  });

  describe("checkProjectDirectory", () => {
    it("returns ok when package.json exists", () => {
      mockExistsSync.mockImplementation((path) => path.toString().includes("package.json"));

      const check = envModule
        .runEnvironmentChecks()
        .checks.find((c) => c.name === "Project directory");

      expect(check?.status).toBe("ok");
      expect(check?.message).toBe("Valid LaunchReadyy project");
    });

    it("returns error when package.json is missing", () => {
      mockExistsSync.mockReturnValue(false);

      const check = envModule
        .runEnvironmentChecks()
        .checks.find((c) => c.name === "Project directory");

      expect(check?.status).toBe("error");
      expect(check?.fix).toContain("LaunchReadyy project root");
    });
  });

  describe("checkDataDirectory", () => {
    it("returns ok when directory is writable", () => {
      mockAccessSync.mockImplementation(() => {});

      const check = envModule
        .runEnvironmentChecks()
        .checks.find((c) => c.name === "Data directory");

      expect(check?.status).toBe("ok");
      expect(check?.message).toBe("Writable");
    });

    it("returns error when directory is not writable", () => {
      mockAccessSync.mockImplementation(() => {
        throw new Error("EACCES");
      });

      const check = envModule
        .runEnvironmentChecks()
        .checks.find((c) => c.name === "Data directory");

      expect(check?.status).toBe("error");
      expect(check?.message).toBe("Not writable");
      expect(check?.fix).toContain("writable by the current user");
    });
  });

  describe("checkPackageManager", () => {
    it("returns ok when npm is available", () => {
      mockExecSync.mockImplementation((cmd) => {
        if (cmd === "npm --version") return "10.8.1";
        throw new Error("not found");
      });

      const check = envModule.runEnvironmentChecks().checks.find((c) => c.name === "npm");

      expect(check?.status).toBe("ok");
      expect(check?.message).toBe("v10.8.1");
    });

    it("returns warning when npm is not available", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      const check = envModule.runEnvironmentChecks().checks.find((c) => c.name === "npm");

      expect(check?.status).toBe("warning");
      expect(check?.message).toBe("not available");
    });
  });

  describe("runEnvironmentChecks", () => {
    it("returns hasErrors true when any check fails", () => {
      mockExecSync.mockImplementation((cmd) => {
        if (cmd === "git --version") throw new Error("not found");
        if (cmd === "npm --version") return "10.8.1";
        throw new Error("not found");
      });
      mockExistsSync.mockImplementation((path) => path.toString().includes("package.json"));
      mockAccessSync.mockImplementation(() => {});
      vi.stubGlobal("process", { ...process, version: "v22.14.0" });

      const result = envModule.runEnvironmentChecks();

      expect(result.hasErrors).toBe(true);
      expect(result.hasWarnings).toBe(false);
    });

    it("returns hasWarnings true when any check warns", () => {
      mockExecSync.mockImplementation((cmd) => {
        if (cmd === "git --version") return "git version 2.43.0";
        if (cmd === "npm --version") throw new Error("not found");
        throw new Error("not found");
      });
      mockExistsSync.mockImplementation((path) => path.toString().includes("package.json"));
      mockAccessSync.mockImplementation(() => {});
      vi.stubGlobal("process", { ...process, version: "v22.14.0" });

      const result = envModule.runEnvironmentChecks();

      expect(result.hasErrors).toBe(false);
      expect(result.hasWarnings).toBe(true);
    });

    it("returns all ok when everything passes", () => {
      mockExecSync.mockImplementation((cmd) => {
        if (cmd === "git --version") return "git version 2.43.0";
        if (cmd === "npm --version") return "10.8.1";
        throw new Error("not found");
      });
      mockExistsSync.mockImplementation((path) => path.toString().includes("package.json"));
      mockAccessSync.mockImplementation(() => {});
      vi.stubGlobal("process", { ...process, version: "v22.14.0" });

      const result = envModule.runEnvironmentChecks();

      expect(result.hasErrors).toBe(false);
      expect(result.hasWarnings).toBe(false);
      expect(result.checks.every((c) => c.status === "ok")).toBe(true);
    });
  });

  describe("formatCheck", () => {
    it("formats ok check with checkmark", () => {
      const check = { name: "Test", status: "ok" as const, message: "All good" };
      const formatted = envModule.formatCheck(check);

      expect(formatted).toContain("✓");
      expect(formatted).toContain("Test: All good");
    });

    it("formats error check with cross", () => {
      const check = { name: "Test", status: "error" as const, message: "Failed", fix: "Do this" };
      const formatted = envModule.formatCheck(check);

      expect(formatted).toContain("✗");
      expect(formatted).toContain("Test: Failed");
      expect(formatted).toContain("Fix: Do this");
    });

    it("formats warning check with warning sign", () => {
      const check = { name: "Test", status: "warning" as const, message: "Warning" };
      const formatted = envModule.formatCheck(check);

      expect(formatted).toContain("⚠");
      expect(formatted).toContain("Test: Warning");
    });

    it("formats optional check with circle", () => {
      const check = { name: "Test", status: "optional" as const, message: "Optional" };
      const formatted = envModule.formatCheck(check);

      expect(formatted).toContain("○");
      expect(formatted).toContain("Test: Optional");
    });
  });
});
