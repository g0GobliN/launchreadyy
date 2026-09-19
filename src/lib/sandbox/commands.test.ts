import { describe, expect, it } from "vitest";
import { detectSandboxCommands } from "./commands";
import { redactSecrets, truncateLog } from "./redact";

describe("detectSandboxCommands", () => {
  it("picks pnpm from lockfile and builds install/build/lint", () => {
    const result = detectSandboxCommands({
      filePaths: ["pnpm-lock.yaml", "package.json"],
      scripts: { build: "tsc", lint: "eslint .", test: "vitest" },
    });
    expect(result.packageManager).toBe("pnpm");
    expect(result.commands.map((c) => c.step)).toEqual(["install", "build", "lint"]);
    expect(result.commands[0]!.command).toContain("pnpm install");
  });

  // A plain Express API or CLI has no build script. Appending `npm run build` anyway made the
  // run fail on "Missing script: build", and a failed run hard-gates the score UI — so a
  // working repo was told it was broken and never shown a readiness score.
  it("omits build when the repo declares no build script", () => {
    const result = detectSandboxCommands({
      filePaths: ["package-lock.json", "package.json"],
      scripts: { start: "node server.js", lint: "eslint ." },
    });
    expect(result.commands.some((c) => c.step === "build")).toBe(false);
    expect(result.commands.map((c) => c.step)).toEqual(["install", "lint"]);
  });

  it("still builds when an explicit buildCommand is set without a declared script", () => {
    const result = detectSandboxCommands({
      filePaths: ["package-lock.json", "package.json"],
      scripts: { start: "node server.js" },
      buildCommand: "make release",
    });
    expect(result.commands.find((c) => c.step === "build")!.command).toBe("make release");
  });

  it("omits test unless includeTest is set", () => {
    const off = detectSandboxCommands({
      filePaths: ["package-lock.json"],
      scripts: { build: "next build", test: "vitest" },
    });
    expect(off.commands.some((c) => c.step === "test")).toBe(false);

    const on = detectSandboxCommands({
      filePaths: ["package-lock.json"],
      scripts: { build: "next build", test: "vitest" },
      includeTest: true,
    });
    expect(on.commands.some((c) => c.step === "test")).toBe(true);
  });

  it("uses npm install (not ci) when no lockfile", () => {
    const result = detectSandboxCommands({ filePaths: ["package.json"], scripts: {} });
    expect(result.packageManager).toBe("npm");
    expect(result.commands[0]!.command).toBe("npm install --no-audit --no-fund --maxsockets=4");
  });

  it("uses npm ci when package-lock.json exists", () => {
    const result = detectSandboxCommands({
      filePaths: ["package.json", "package-lock.json"],
      scripts: {},
    });
    expect(result.commands[0]!.command).toBe("npm ci --no-audit --no-fund --maxsockets=4");
  });

  it("uses yarn immutable for Berry (.yarnrc.yml)", () => {
    const result = detectSandboxCommands({
      filePaths: ["package.json", "yarn.lock", ".yarnrc.yml"],
      scripts: { build: "tsc" },
    });
    expect(result.packageManager).toBe("yarn");
    expect(result.commands[0]!.command).toBe("yarn install --immutable");
  });

  it("does not force ruff lint on poetry without a ruff config", () => {
    const result = detectSandboxCommands({
      filePaths: ["pyproject.toml", "poetry.lock", "app.py"],
    });
    expect(result.ecosystem).toBe("python");
    expect(result.commands.some((c) => c.step === "lint")).toBe(false);
  });

  it("marks polyglot ecosystems unsupported without E2B_TEMPLATE_ID", async () => {
    const prev = process.env.E2B_TEMPLATE_ID;
    delete process.env.E2B_TEMPLATE_ID;
    const { sandboxImageSupports } = await import("./commands");
    expect(sandboxImageSupports("node")).toBe(true);
    expect(sandboxImageSupports("python")).toBe(true);
    expect(sandboxImageSupports("ruby")).toBe(false);
    expect(sandboxImageSupports("go")).toBe(false);
    process.env.E2B_TEMPLATE_ID = "launchreadyy";
    expect(sandboxImageSupports("ruby")).toBe(true);
    expect(sandboxImageSupports("go")).toBe(true);
    if (prev === undefined) delete process.env.E2B_TEMPLATE_ID;
    else process.env.E2B_TEMPLATE_ID = prev;
  });

  it("leaves cwd unset when there is no root directory", () => {
    const result = detectSandboxCommands({
      filePaths: ["package-lock.json", "package.json"],
      scripts: { build: "vite build", lint: "eslint ." },
    });
    expect(result.commands.every((c) => c.cwd === undefined)).toBe(true);
  });

  it("runs the app steps in rootDir but installs where the lockfile is", () => {
    const result = detectSandboxCommands({
      filePaths: ["package-lock.json", "apps/web/package.json"],
      scripts: { build: "next build", lint: "next lint" },
      rootDir: "apps/web",
    });
    const byStep = Object.fromEntries(result.commands.map((c) => [c.step, c.cwd]));
    expect(byStep.install).toBeUndefined();
    expect(byStep.build).toBe("apps/web");
    expect(byStep.lint).toBe("apps/web");
  });

  it("installs inside rootDir when that is where the lockfile lives", () => {
    const result = detectSandboxCommands({
      filePaths: ["apps/web/package-lock.json", "apps/web/package.json"],
      scripts: { build: "next build" },
      rootDir: "apps/web",
    });
    expect(result.commands.find((c) => c.step === "install")!.cwd).toBe("apps/web");
  });

  it("detects a package manager pinned inside rootDir", () => {
    const result = detectSandboxCommands({
      filePaths: ["apps/web/pnpm-lock.yaml", "apps/web/package.json"],
      scripts: { build: "next build" },
      rootDir: "apps/web",
    });
    expect(result.packageManager).toBe("pnpm");
    expect(result.commands[0]!.cwd).toBe("apps/web");
  });

  it("uses an explicit build command over the detected script", () => {
    const result = detectSandboxCommands({
      filePaths: ["package-lock.json"],
      scripts: { build: "vite build" },
      buildCommand: "npm run build:prod",
    });
    expect(result.commands.find((c) => c.step === "build")!.command).toBe("npm run build:prod");
  });

  it("detects Go install/build from go.mod", () => {
    const result = detectSandboxCommands({
      filePaths: ["go.mod", "main.go"],
      includeTest: true,
    });
    expect(result.ecosystem).toBe("go");
    expect(result.packageManager).toBe("go");
    expect(result.commands.map((c) => c.step)).toEqual(["install", "build", "test"]);
    expect(result.commands[0]!.command).toBe("go mod download");
  });

  it("detects Python from requirements.txt", () => {
    const result = detectSandboxCommands({
      filePaths: ["requirements.txt", "app.py"],
    });
    expect(result.ecosystem).toBe("python");
    expect(result.packageManager).toBe("pip");
    expect(result.commands[0]!.command).toContain("pip install -r requirements.txt");
  });

  it("poetry install has a pip fallback for broken old locks", () => {
    const result = detectSandboxCommands({
      filePaths: ["pyproject.toml", "poetry.lock", "app.py"],
    });
    expect(result.packageManager).toBe("poetry");
    expect(result.commands[0]!.command).toContain("poetry install");
    expect(result.commands[0]!.command).toContain("pip install");
    expect(result.commands[0]!.command).toContain("PyYAML");
  });

  it("composer install ignores PHP platform skew", () => {
    const result = detectSandboxCommands({
      filePaths: ["composer.json", "artisan"],
    });
    expect(result.ecosystem).toBe("php");
    expect(result.commands[0]!.command).toContain("--ignore-platform-req=php");
  });

  it("prefers Composer for Laravel even when frontend package.json exists", () => {
    const result = detectSandboxCommands({
      filePaths: [
        "composer.json",
        "composer.lock",
        "artisan",
        "package.json",
        "package-lock.json",
        "resources/js/app.js",
      ],
      scripts: { build: "vite build" },
    });
    expect(result.ecosystem).toBe("php");
    expect(result.packageManager).toBe("composer");
    expect(result.commands[0]!.command).toContain("composer install");
  });

  it("dotnet restore can install SDK 9 on demand", () => {
    const result = detectSandboxCommands({
      filePaths: ["App.csproj", "global.json"],
    });
    expect(result.ecosystem).toBe("dotnet");
    expect(result.commands[0]!.command).toContain("dotnet-install.sh");
  });

  it("gradle enables toolchain auto-download and chmods gradlew", () => {
    const result = detectSandboxCommands({
      filePaths: ["build.gradle.kts", "src/main/kotlin/Main.kt"],
    });
    expect(result.packageManager).toBe("gradle");
    expect(result.commands[0]!.command).toContain("auto-download=true");
    expect(result.commands[0]!.command).toContain("chmod +x ./gradlew");
    expect(result.commands[0]!.command).toContain("foojay-resolver");
  });

  it("ruby pins a Bundler that works with modern RubyGems", () => {
    const result = detectSandboxCommands({
      filePaths: ["Gemfile", "config.ru"],
    });
    expect(result.ecosystem).toBe("ruby");
    expect(result.commands[0]!.command).toContain("bundler:2.5.23");
    expect(result.commands[0]!.command).toContain("ruby@2.7.8");
  });

  it("detects Rust from Cargo.toml", () => {
    const result = detectSandboxCommands({
      filePaths: ["Cargo.toml", "src/main.rs"],
    });
    expect(result.ecosystem).toBe("rust");
    expect(result.commands.map((c) => c.step)).toEqual(["install", "build"]);
  });

  it("prefers Node when package.json coexists with go.mod", () => {
    const result = detectSandboxCommands({
      filePaths: ["package.json", "go.mod"],
      scripts: { build: "tsc" },
    });
    expect(result.ecosystem).toBe("node");
  });
});

describe("redactSecrets", () => {
  it("replaces known secrets and leaves other text", () => {
    expect(redactSecrets("token=abc123xyz and done", ["abc123xyz"])).toBe(
      "token=[REDACTED] and done",
    );
  });

  it("truncates oversized logs, keeping the tail", () => {
    const big = "x".repeat(100);
    expect(truncateLog(big, 20)).toMatch(/^…\[truncated 80 earlier chars\]\nx{20}$/);
  });
});
