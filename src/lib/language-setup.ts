/**
 * Language detection + deterministic setup docs / install commands per stack.
 */

import type { ProjectLanguage } from "./project-context";
import type { LanguageManifests } from "./project-context.server";

export type PythonStack = "django" | "fastapi" | "flask" | "poetry" | "pip";
export type PhpStack = "laravel" | "composer";
export type RubyStack = "rails" | "bundler";

export interface DetectedRepoStack {
  language: ProjectLanguage;
  label: string;
  pythonStack?: PythonStack;
  phpStack?: PhpStack;
  rubyStack?: RubyStack;
}

export interface LanguageReadmeInput {
  fullName: string;
  repoName: string;
  framework: string;
  stack: DetectedRepoStack;
  envVars: string[];
  withEnvStep: boolean;
  /** Node-only */
  packageManager?: "npm" | "pnpm" | "yarn" | "bun";
  scripts?: Record<string, string>;
  nodeVersion?: string;
}

function envVarList(envVars: string[]): string {
  if (envVars.length === 0) return "See `.env.example` for the full list.";
  return envVars.map((v) => `- \`${v}\``).join("\n");
}

function cloneBlock(fullName: string, repoName: string): string {
  return `\`\`\`bash\ngit clone https://github.com/${fullName}.git\ncd ${repoName}\n\`\`\``;
}

function envBlock(envVars: string[]): string {
  return `\`\`\`bash\ncp .env.example .env\n\`\`\`\n\nFill in \`.env\`:\n\n${envVarList(envVars)}`;
}

function envStep(envVars: string[]): string {
  return `**Configure environment**\n\n${envBlock(envVars)}`;
}

export function detectRepoStack(
  filePaths: string[],
  framework: string,
  manifests: Partial<LanguageManifests> = {},
): DetectedRepoStack {
  if (filePaths.includes("package.json")) {
    return { language: "node", label: framework !== "unknown" ? framework : "Node.js" };
  }

  if (filePaths.includes("go.mod")) {
    return { language: "go", label: "Go" };
  }

  if (
    filePaths.includes("requirements.txt") ||
    filePaths.includes("pyproject.toml") ||
    filePaths.includes("setup.py") ||
    filePaths.includes("Pipfile")
  ) {
    const req = `${manifests.requirements ?? ""}\n${manifests.pyprojectToml ?? ""}`.toLowerCase();
    if (filePaths.includes("manage.py") || /django/i.test(req)) {
      return { language: "python", label: "Django", pythonStack: "django" };
    }
    if (/fastapi/i.test(req)) {
      return { language: "python", label: "FastAPI", pythonStack: "fastapi" };
    }
    if (/flask/i.test(req)) {
      return { language: "python", label: "Flask", pythonStack: "flask" };
    }
    if (manifests.pyprojectToml && /\[tool\.poetry\]/i.test(manifests.pyprojectToml)) {
      return { language: "python", label: "Python (Poetry)", pythonStack: "poetry" };
    }
    if (filePaths.includes("Pipfile")) {
      return { language: "python", label: "Python (Pipenv)", pythonStack: "pip" };
    }
    return { language: "python", label: "Python", pythonStack: "pip" };
  }

  if (filePaths.includes("composer.json")) {
    const composer = manifests.composerJson ?? "";
    if (filePaths.includes("artisan") && /laravel/i.test(composer)) {
      return { language: "php", label: "Laravel", phpStack: "laravel" };
    }
    return { language: "php", label: "PHP", phpStack: "composer" };
  }

  if (filePaths.includes("Gemfile")) {
    const gem = manifests.gemfile ?? "";
    if (/rails/i.test(gem) || filePaths.includes("config/application.rb")) {
      return { language: "ruby", label: "Ruby on Rails", rubyStack: "rails" };
    }
    return { language: "ruby", label: "Ruby", rubyStack: "bundler" };
  }

  if (filePaths.includes("Cargo.toml")) {
    return { language: "rust", label: "Rust" };
  }

  if (filePaths.includes("mix.exs")) {
    return { language: "elixir", label: "Elixir" };
  }

  if (filePaths.includes("pubspec.yaml")) {
    return { language: "dart", label: "Flutter" };
  }

  if (
    filePaths.some(
      (f) => f === "Package.swift" || f.endsWith(".xcodeproj") || /\.xcodeproj\//.test(f),
    )
  ) {
    return { language: "swift", label: "Swift" };
  }

  if (filePaths.includes("pom.xml") || filePaths.includes("build.gradle")) {
    return { language: "java", label: framework === "Kotlin" ? "Kotlin" : "Java" };
  }

  return { language: "unknown", label: framework !== "unknown" ? framework : "Unknown" };
}

function buildPythonReadme(input: LanguageReadmeInput): string[] {
  const stack = input.stack.pythonStack ?? "pip";
  const prereqs =
    stack === "django"
      ? ["- Python 3.10+", "- pip"]
      : stack === "poetry"
        ? ["- Python 3.10+", "- Poetry"]
        : ["- Python 3.10+", "- pip (or uv)"];

  let install = "";
  let dev = "";
  let test = "";

  switch (stack) {
    case "django":
      install =
        "python -m venv .venv\nsource .venv/bin/activate  # Windows: .venv\\Scripts\\activate\npip install -r requirements.txt";
      dev = "python manage.py runserver";
      test = "python manage.py test";
      break;
    case "fastapi":
      install = "python -m venv .venv\nsource .venv/bin/activate\npip install -r requirements.txt";
      dev = "uvicorn main:app --reload  # adjust module if your entrypoint differs";
      test = "pytest";
      break;
    case "flask":
      install = "python -m venv .venv\nsource .venv/bin/activate\npip install -r requirements.txt";
      dev = "flask --app app run --debug  # adjust if your app module differs";
      test = "pytest";
      break;
    case "poetry":
      install = "poetry install";
      dev = "poetry run python main.py  # or: poetry run uvicorn main:app --reload";
      test = "poetry run pytest";
      break;
    default:
      install = "python -m venv .venv\nsource .venv/bin/activate\npip install -r requirements.txt";
      dev = "python main.py  # adjust to your entrypoint";
      test = "pytest";
  }

  const steps: string[] = [
    `**1. Clone**\n\n${cloneBlock(input.fullName, input.repoName)}`,
    `**2. Install**\n\n\`\`\`bash\n${install}\n\`\`\``,
  ];
  if (input.withEnvStep) steps.push(`**3.** ${envStep(input.envVars)}`);
  steps.push(`**${input.withEnvStep ? 4 : 3}. Run in development**\n\n\`\`\`bash\n${dev}\n\`\`\``);
  steps.push(`**Tests**\n\n\`\`\`bash\n${test}\n\`\`\``);

  return [
    ["## Prerequisites", "", ...prereqs].join("\n"),
    ["## Getting started", "", `**Stack:** ${input.stack.label}`, "", ...steps].join("\n\n"),
  ];
}

function buildGoReadme(input: LanguageReadmeInput): string[] {
  const steps = [
    `**1. Clone**\n\n${cloneBlock(input.fullName, input.repoName)}`,
    "**2. Install dependencies**\n\n```bash\ngo mod download\n```",
  ];
  if (input.withEnvStep) steps.push(`**3.** ${envStep(input.envVars)}`);
  steps.push(
    `**${input.withEnvStep ? 4 : 3}. Run**\n\n\`\`\`bash\ngo run .\n\`\`\``,
    "**Tests**\n\n```bash\ngo test ./...\n```",
  );
  return [
    ["## Prerequisites", "", "- Go 1.21+", "- Git"].join("\n"),
    ["## Getting started", "", `**Stack:** Go`, "", ...steps].join("\n\n"),
  ];
}

function buildPhpReadme(input: LanguageReadmeInput): string[] {
  const laravel = input.stack.phpStack === "laravel";
  const install = laravel
    ? "composer install\ncp .env.example .env\nphp artisan key:generate"
    : "composer install";
  const dev = laravel ? "php artisan serve" : "php -S localhost:8000 -t public";
  const test = laravel ? "php artisan test" : "vendor/bin/phpunit";

  const steps = [
    `**1. Clone**\n\n${cloneBlock(input.fullName, input.repoName)}`,
    `**2. Install**\n\n\`\`\`bash\n${install}\n\`\`\``,
  ];
  if (input.withEnvStep && !laravel) steps.push(`**3.** ${envStep(input.envVars)}`);
  steps.push(
    `**${steps.length + 1}. Run in development**\n\n\`\`\`bash\n${dev}\n\`\`\``,
    `**Tests**\n\n\`\`\`bash\n${test}\n\`\`\``,
  );

  return [
    ["## Prerequisites", "", "- PHP 8.2+", "- Composer"].join("\n"),
    ["## Getting started", "", `**Stack:** ${input.stack.label}`, "", ...steps].join("\n\n"),
  ];
}

function buildRubyReadme(input: LanguageReadmeInput): string[] {
  const rails = input.stack.rubyStack === "rails";
  const install = "bundle install";
  const dev = rails ? "bin/rails server" : "bundle exec ruby main.rb";
  const test = rails ? "bundle exec rspec" : "bundle exec rake test";

  const steps = [
    `**1. Clone**\n\n${cloneBlock(input.fullName, input.repoName)}`,
    `**2. Install**\n\n\`\`\`bash\n${install}\n\`\`\``,
  ];
  if (input.withEnvStep) steps.push(`**3.** ${envStep(input.envVars)}`);
  steps.push(
    `**${input.withEnvStep ? 4 : 3}. Run**\n\n\`\`\`bash\n${dev}\n\`\`\``,
    `**Tests**\n\n\`\`\`bash\n${test}\n\`\`\``,
  );

  return [
    ["## Prerequisites", "", "- Ruby 3.2+", "- Bundler"].join("\n"),
    ["## Getting started", "", `**Stack:** ${input.stack.label}`, "", ...steps].join("\n\n"),
  ];
}

function buildDartReadme(input: LanguageReadmeInput): string[] {
  const steps = [
    `**1. Clone**\n\n${cloneBlock(input.fullName, input.repoName)}`,
    "**2. Install**\n\n```bash\nflutter pub get\n```",
    "**3. Run**\n\n```bash\nflutter run\n```",
    "**Tests**\n\n```bash\nflutter test\n```",
  ];
  return [
    ["## Prerequisites", "", "- Flutter SDK 3.16+", "- Dart 3.2+"].join("\n"),
    ["## Getting started", "", `**Stack:** ${input.stack.label}`, "", ...steps].join("\n\n"),
  ];
}

/** Deterministic README sections — branches on detected language/stack. */
export function buildLanguageReadmeSections(input: LanguageReadmeInput): string[] {
  switch (input.stack.language) {
    case "python":
      return buildPythonReadme(input);
    case "go":
      return buildGoReadme(input);
    case "php":
      return buildPhpReadme(input);
    case "ruby":
      return buildRubyReadme(input);
    case "dart":
      return buildDartReadme(input);
    default:
      return [];
  }
}

/** AI unit tests — all languages with *-test-ai fix ids use the AI generation pipeline. */
export const AI_TEST_SUPPORTED_LANGUAGES = new Set<ProjectLanguage>([
  "node",
  "python",
  "go",
  "ruby",
  "php",
  "java",
  "kotlin",
  "rust",
  "csharp",
  "elixir",
  "dart",
  "swift",
]);

/** Shown when a Node-only AI fix is offered on a non-Node repo (e.g. vitest-ai on Python). */
export const AI_TEST_COMING_SOON_MESSAGE =
  "This fix requires a JavaScript/TypeScript project. Use the language-specific AI test fix for this repo instead.";
