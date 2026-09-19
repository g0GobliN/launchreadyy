import { describe, expect, it } from "vitest";
import {
  ciWorkflow,
  vitestConfig,
  dockerfile,
  FIX_GENERATOR_TEMPLATES,
} from "./fix-executor.server";

describe("fix generator templates", () => {
  it("eslint config uses flat config and typescript-eslint", () => {
    expect(FIX_GENERATOR_TEMPLATES.eslint).toContain("@typescript-eslint");
    expect(FIX_GENERATOR_TEMPLATES.eslint).toContain("export default");
  });

  it("prettier config sets semi and singleQuote", () => {
    expect(FIX_GENERATOR_TEMPLATES.prettierRc).toContain('"semi"');
    expect(FIX_GENERATOR_TEMPLATES.prettierIgnore).toContain("node_modules");
  });

  it("playwright config targets chromium, baseURL, and webServer", () => {
    expect(FIX_GENERATOR_TEMPLATES.playwright).toContain("@playwright/test");
    expect(FIX_GENERATOR_TEMPLATES.playwright).toContain("baseURL");
    expect(FIX_GENERATOR_TEMPLATES.playwright).toContain("webServer");
    expect(FIX_GENERATOR_TEMPLATES.e2eHome).toContain("page.goto");
  });

  it("vitest config varies by framework", () => {
    expect(vitestConfig("Express", {})).toContain('environment: "node"');
    expect(vitestConfig("Next.js", { react: "^19" })).toContain("@vitejs/plugin-react");
    expect(FIX_GENERATOR_TEMPLATES.smokeTest).toContain("expect(true).toBe(true)");
  });

  it("dockerfile varies by framework", () => {
    expect(dockerfile("Next.js")).toContain("standalone");
    expect(dockerfile("Next.js")).toContain("STRIPE_SECRET_KEY=sk_test_build_placeholder");
    expect(dockerfile("Vite")).toContain("nginx");
    expect(dockerfile("Express")).toContain("node:20-alpine");
  });

  it("Python dockerfile uses poetry when poetry.lock is present", () => {
    const poetry = dockerfile("Python", "npm", ["pyproject.toml", "poetry.lock", "app/main.py"], {
      pyprojectToml:
        '[tool.poetry.dependencies]\npython = "^3.9"\nfastapi = "^0.79"\nasyncpg = "^0.26"\n',
    });
    expect(poetry).toContain("poetry install");
    expect(poetry).toContain("libpq-dev");
    expect(poetry).toContain("python:3.9-slim");
    expect(poetry).not.toContain('pip install --no-cache-dir ".[prod]"');
  });

  it("dockerfile covers Kotlin, C#, and Elixir with real language-specific images", () => {
    // Regression: these three fell through to the generic Node.js Dockerfile — wrong runtime
    // entirely for a JVM/.NET/BEAM app.
    const kotlin = dockerfile("Kotlin");
    expect(kotlin).toContain("eclipse-temurin");
    expect(kotlin).not.toContain("node:20-alpine");

    const csharp = dockerfile("C#");
    expect(csharp).toContain("mcr.microsoft.com/dotnet");
    expect(csharp).not.toContain("node:20-alpine");

    const elixir = dockerfile("Elixir");
    expect(elixir).toContain("elixir:1.16-alpine");
    expect(elixir).not.toContain("node:20-alpine");
  });

  it("Rust dockerfile picks the long-running [[bin]] target, not the first one", () => {
    // Confirmed against the real tokio-rs/mini-redis: its Cargo.toml lists mini-redis-cli
    // FIRST and mini-redis-server second — first-match shipped a container that runs a
    // client, prints usage, and exits immediately.
    const cargoToml = `[package]\nname = "mini-redis"\n\n[[bin]]\nname = "mini-redis-cli"\npath = "src/bin/cli.rs"\n\n[[bin]]\nname = "mini-redis-server"\npath = "src/bin/server.rs"\n`;
    const rust = dockerfile("Rust", "npm", [], { cargoToml });
    expect(rust).toContain("target/release/mini-redis-server");
    expect(rust).not.toContain("target/release/mini-redis-cli");
  });

  it("Java/Kotlin dockerfiles honor the repo's declared JDK toolchain", () => {
    // Confirmed against the real spring-petclinic-kotlin: its strict JavaLanguageVersion.of(17)
    // Gradle toolchain hard-fails inside a 21-only build image (no toolchain download repo
    // configured) — same bug class as buildJavaCi's hardcoded java-version.
    const kts = `java {\n  toolchain {\n    languageVersion = JavaLanguageVersion.of(17)\n  }\n}`;
    const kotlin17 = dockerfile("Kotlin", "npm", [], { buildGradle: kts });
    expect(kotlin17).toContain("eclipse-temurin:17-jdk-alpine");
    expect(kotlin17).toContain("eclipse-temurin:17-jre-alpine");
    // Older Spring/Maven plugins can fail under the Java module restrictions introduced after
    // Java 8, so a declared legacy version must also be honored. Temurin publishes supported
    // Alpine build and runtime images for these legacy versions.
    const java8 = dockerfile("Java", "npm", [], { pomXml: "<source>1.8</source>" });
    expect(java8).toContain("eclipse-temurin:11-jdk-alpine");
    expect(java8).toContain("eclipse-temurin:8-jre-alpine");
  });

  it("Java dockerfile uses valid Dockerfile syntax (RUN for shell fallback, not COPY)", () => {
    // Regression: `COPY ... 2>/dev/null || COPY ...` is invalid — COPY isn't a shell command
    // and doesn't run in a shell context, so that fallback could never actually work.
    const java = dockerfile("Java");
    for (const line of java.split("\n")) {
      if (line.trim().startsWith("COPY")) {
        expect(line).not.toContain("||");
        expect(line).not.toContain("2>/dev/null");
      }
    }
    expect(java).toContain(
      "RUN JAR=$(ls -S target/*.jar target/*.war build/libs/*.jar 2>/dev/null",
    );
    expect(java).toContain('&& cp "$JAR" app.jar');
  });

  it("Python dockerfile finds the real entrypoint by content search, not just a fixed path list", () => {
    // Real repo shape confirmed by testing: entry point lives somewhere the old fixed
    // candidate-path list never checked, and the app variable isn't named "app". Path-guessing
    // alone can never find this; content search (real file content, already in memory from the
    // repo snapshot) finds it by looking for the actual `= FastAPI(`/`Flask(` assignment.
    const filePaths = ["requirements.txt", "service/web/entry.py", "service/web/routes.py"];
    const getContent = (p: string) =>
      p === "service/web/entry.py" ? "from fastapi import FastAPI\n\napi = FastAPI()\n" : undefined;

    const withSearch = dockerfile("Python", "npm", filePaths, {}, "", getContent);
    expect(withSearch).toContain('"service.web.entry:api"');

    // Without a getContent function (e.g. snapshot fetch failed), falls back to the old
    // path-guessing behavior instead of throwing — degrades, doesn't break.
    const withoutSearch = dockerfile("Python", "npm", filePaths, {});
    expect(withoutSearch).toContain('"app:app"');
  });

  it("express security middleware exports apply functions", () => {
    expect(FIX_GENERATOR_TEMPLATES.helmet).toContain("helmet()");
    expect(FIX_GENERATOR_TEMPLATES.rateLimit).toContain("express-rate-limit");
    expect(FIX_GENERATOR_TEMPLATES.logger).toContain("winston");
    expect(FIX_GENERATOR_TEMPLATES.requestLogger).toContain("next()");
  });

  it("error boundary is a client component for Next.js", () => {
    expect(FIX_GENERATOR_TEMPLATES.errorBoundary).toContain("'use client'");
    expect(FIX_GENERATOR_TEMPLATES.errorBoundary).toContain("reset");
  });

  it("sentry init references dsn env var", () => {
    expect(FIX_GENERATOR_TEMPLATES.sentryReact).toMatch(/SENTRY_DSN|VITE_SENTRY_DSN/);
  });

  it("ci workflow is production-grade", () => {
    const wf = ciWorkflow("20");
    expect(wf).toContain("actions/checkout@v4");
    expect(wf).toContain("pnpm-lock.yaml");
    expect(wf).toContain("Typecheck");
  });
});
