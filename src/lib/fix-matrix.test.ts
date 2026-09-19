import { describe, expect, it } from "vitest";
import {
  buildCsharpHealthWiring,
  buildCsharpMiddlewareWiring,
  buildElixirPlugWiring,
  patchCsharpContent,
  patchElixirContent,
  pickJavaApplicationPath,
} from "./backend-patch.server";
import { resolvePackFixId } from "./fix-packs";
import { languageUnitTestAiFix } from "./language-test-fixes";
import { getFixPreviewDetails } from "./mock-data";
import {
  frameworkToProjectLanguage,
  getToolApplicability,
  isNonNodeFramework,
  normalizeScannerLanguage,
  type ProjectContext,
} from "./project-context.server";
import type { ProjectIntelligence } from "./project-intelligence.server";
import { detectLanguage } from "./scanner-rules";

const emptyIntelligence = (): ProjectIntelligence => ({
  monorepo: false,
  packages: [],
  envContract: { build: [], test: [], runtime: [], all: [], refs: [] },
  integrations: {
    stripe: false,
    firebase: false,
    supabase: false,
    prisma: false,
    auth: false,
    hasWebhooks: false,
    signals: [],
  },
  structure: { entryPoints: [], routePaths: [], apiPaths: [], componentPaths: [] },
  codeSamples: [],
  runtimeModel: "unknown",
});

function backendCtx(
  framework: string,
  language: ProjectContext["language"],
  filePaths: string[],
  manifests: ProjectContext["manifests"] = {},
): ProjectContext {
  return {
    fullName: "o/r",
    framework,
    resolvedFramework: framework,
    language,
    isNodeProject: false,
    packageManager: "npm",
    filePaths,
    pkg: {
      scripts: {},
      nodeVersion: "20",
      hasBackend: true,
      dependencies: {},
      devDependencies: {},
    },
    mergedDeps: {},
    stack: { frameworks: [framework], services: [], deployTargets: [], profile: "General Node" },
    manifests,
    usesTypeScript: false,
    usesReact: false,
    hasExpress: false,
    isStaticSpa: false,
    hasNextAppRouter: false,
    hasExistingCi: false,
    hasExistingDockerfile: false,
    deployConfigs: [],
    envVars: [],
    intelligence: emptyIntelligence(),
  };
}

const BACKENDS: Array<{
  framework: string;
  language: ProjectContext["language"];
  files: string[];
  manifests?: ProjectContext["manifests"];
}> = [
  { framework: "Python", language: "python", files: ["pyproject.toml", "main.py"] },
  { framework: "Java", language: "java", files: ["pom.xml", "src/main/java/App.java"] },
  {
    framework: "Kotlin",
    language: "kotlin",
    files: ["build.gradle.kts", "src/main/kotlin/App.kt"],
  },
  { framework: "Go", language: "go", files: ["go.mod", "cmd/server/main.go"] },
  { framework: "Ruby", language: "ruby", files: ["Gemfile", "config/routes.rb"] },
  { framework: "PHP", language: "php", files: ["composer.json", "artisan"] },
  { framework: "Rust", language: "rust", files: ["Cargo.toml", "src/main.rs"] },
  { framework: "C#", language: "csharp", files: ["App.csproj", "Program.cs"] },
  { framework: "Elixir", language: "elixir", files: ["mix.exs", "lib/app_web/endpoint.ex"] },
];

const MIDDLEWARE = ["helmet", "cors", "rate-limit", "logger", "health-check"] as const;

describe("fix matrix — all backends", () => {
  it("normalizeScannerLanguage maps C# and Kotlin", () => {
    expect(normalizeScannerLanguage("C#")).toBe("csharp");
    expect(normalizeScannerLanguage("Kotlin")).toBe("kotlin");
  });

  it("frameworkToProjectLanguage covers all non-Node frameworks", () => {
    for (const { framework, language } of BACKENDS) {
      expect(frameworkToProjectLanguage(framework)).toBe(language);
      expect(isNonNodeFramework(framework)).toBe(true);
    }
  });

  it("detectLanguage prefers Kotlin over Java for KT-heavy repos", () => {
    expect(
      detectLanguage(["build.gradle.kts", "src/main/kotlin/App.kt", "src/main/kotlin/Foo.kt"]),
    ).toBe("Kotlin");
  });

  for (const { framework, language, files, manifests } of BACKENDS) {
    describe(framework, () => {
      const ctx = backendCtx(framework, language, files, manifests);

      for (const tool of MIDDLEWARE) {
        it(`${tool} applicable`, () => {
          expect(getToolApplicability(tool, ctx).applicable).toBe(true);
        });
      }

      it("vitest-ai maps to language test fix", () => {
        const mapped = resolvePackFixId("vitest-ai", language, false);
        expect(mapped).toBe(languageUnitTestAiFix(language));
      });

      it("playwright-ai routes per language", () => {
        const mapped = resolvePackFixId("playwright-ai", language, false);
        if (language === "kotlin" || language === "dart" || language === "swift") {
          expect(mapped).toBe(`${language}-test-ai`);
        } else {
          expect(mapped).toBe("playwright-ai");
        }
      });

      it("api-tests applicable", () => {
        expect(getToolApplicability("api-tests", ctx).applicable).toBe(true);
      });

      it("helmet preview has paths", () => {
        const preview = getFixPreviewDetails("helmet", framework);
        expect(preview?.files_added?.length).toBeGreaterThan(0);
      });
    });
  }

  it("ASP.NET Program.cs middleware + health", () => {
    const program = `var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\napp.Run();\n`;
    let out = program;
    const mw = buildCsharpMiddlewareWiring(["helmet", "cors"], "aspnet");
    out = patchCsharpContent(out, mw!)!;
    const health = buildCsharpHealthWiring("aspnet");
    out = patchCsharpContent(out, health!)!;
    expect(out).toContain("UseMiddleware<SecurityHeadersMiddleware>");
    expect(out).toContain('MapGet("/health"');
  });

  it("Phoenix endpoint plug wiring", () => {
    const endpoint = `defmodule AppWeb.Endpoint do\n  use Phoenix.Endpoint\n  plug Plug.RequestId\nend\n`;
    const plan = buildElixirPlugWiring(["helmet", "logger"], "phoenix", "lib/app_web/endpoint.ex");
    const out = patchElixirContent(endpoint, plan!)!;
    expect(out).toContain("plug AppWeb.Plugs.SecurityHeaders");
    expect(out).toContain("plug AppWeb.Plugs.RequestLogger");
  });

  it("Java Spring Boot application detection", () => {
    expect(
      pickJavaApplicationPath([
        "src/main/java/com/foo/FooApplication.java",
        "src/main/java/com/foo/web/HomeController.java",
      ]),
    ).toBe("src/main/java/com/foo/FooApplication.java");
  });
});
