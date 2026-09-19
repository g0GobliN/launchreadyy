import type { ProjectLanguage } from "./project-context.server";
import type { LanguageManifests } from "./project-context.server";
import { detectRepoStack, type DetectedRepoStack } from "./language-setup";
import { isNativeMobileFramework } from "./platform-stacks";

export interface LanguageWebCommand {
  command: string;
  port: number;
}

const LANGUAGE_DEFAULT_PORTS: Partial<Record<ProjectLanguage, number>> = {
  python: 8000,
  ruby: 3000,
  php: 8000,
  go: 8080,
  java: 8080,
  kotlin: 8080,
  rust: 8080,
  csharp: 5000,
  elixir: 4000,
};

const BROWSER_AUTOMATION_FRAMEWORKS = new Set(["Electron", "Tauri", "Expo", "React Native"]);

/** True when the repo can be exercised via browser automation (web, desktop shell, or mobile web). */
export function hasBrowsableWebUi(opts: {
  language: ProjectLanguage;
  isNodeProject: boolean;
  isStaticSpa: boolean;
  usesReact: boolean;
  filePaths: string[];
  resolvedFramework: string;
}): boolean {
  if (BROWSER_AUTOMATION_FRAMEWORKS.has(opts.resolvedFramework)) return true;
  if (isNativeMobileFramework(opts.resolvedFramework)) return false;
  if (opts.isNodeProject || opts.isStaticSpa || opts.usesReact) return true;

  const blob = opts.filePaths.join("\n");
  if (/(^|\/)(templates?|views?|pages?|static|public)\//i.test(blob)) return true;
  if (/\.(html|tsx|jsx|vue|svelte|erb|blade\.php|haml|slim|twig|mustache|hbs)$/i.test(blob))
    return true;
  if (
    opts.filePaths.some((p) =>
      /^(manage\.py|artisan|config\/routes\.rb|public\/index\.html)$/i.test(p),
    )
  ) {
    return true;
  }
  if (
    /(django|flask|fastapi|rails|laravel|spring|thymeleaf|phoenix)/i.test(opts.resolvedFramework)
  ) {
    return true;
  }
  return false;
}

/** Dev server shell command for non-Node web apps (Playwright webServer). */
export function resolveLanguageWebCommand(opts: {
  language: ProjectLanguage;
  filePaths: string[];
  framework: string;
  manifests?: Partial<LanguageManifests>;
  envExample?: string;
}): LanguageWebCommand {
  const stack = detectRepoStack(opts.filePaths, opts.framework, opts.manifests ?? {});
  const port = parsePortFromEnv(opts.envExample) ?? LANGUAGE_DEFAULT_PORTS[opts.language] ?? 3000;

  switch (stack.language) {
    case "python": {
      if (stack.pythonStack === "django" || opts.filePaths.includes("manage.py")) {
        return { command: `python manage.py runserver ${port}`, port };
      }
      if (stack.pythonStack === "fastapi") {
        return { command: `uvicorn main:app --reload --port ${port}`, port };
      }
      if (stack.pythonStack === "flask") {
        return { command: `flask --app app run --port ${port}`, port };
      }
      if (stack.pythonStack === "poetry") {
        return { command: `poetry run python main.py`, port };
      }
      return { command: `python main.py`, port };
    }
    case "ruby":
      return {
        command:
          stack.rubyStack === "rails" ? `bin/rails server -p ${port}` : `bundle exec ruby main.rb`,
        port,
      };
    case "php":
      return {
        command:
          stack.phpStack === "laravel"
            ? `php artisan serve --port=${port}`
            : `php -S localhost:${port} -t public`,
        port,
      };
    case "go":
      return { command: "go run .", port };
    case "java":
    case "kotlin":
      if (opts.filePaths.includes("pom.xml")) {
        return {
          command: `./mvnw spring-boot:run -Dspring-boot.run.arguments=--server.port=${port}`,
          port,
        };
      }
      return { command: `./gradlew bootRun --args='--server.port=${port}'`, port };
    case "rust":
      return { command: "cargo run", port };
    case "csharp":
      return { command: "dotnet run", port };
    case "elixir":
      return { command: "mix phx.server", port };
    default:
      return { command: `python -m http.server ${port}`, port };
  }
}

function parsePortFromEnv(envExample?: string): number | null {
  if (!envExample) return null;
  const m = envExample.match(/\bPORT\s*=\s*(\d{2,5})\b/);
  if (!m?.[1]) return null;
  const port = Number.parseInt(m[1], 10);
  return port > 0 && port < 65536 ? port : null;
}

export function playwrightStackLabel(stack: DetectedRepoStack): string {
  return stack.label;
}
