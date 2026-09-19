import type { DetectedRepoStack } from "./language-setup";
import { buildLanguageReadmeSections } from "./language-setup";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface ReadmeSetupInput {
  fullName: string;
  repoName: string;
  framework: string;
  packageManager: PackageManager;
  scripts: Record<string, string>;
  nodeVersion: string;
  envVars: string[];
  withEnvStep: boolean;
  stack?: DetectedRepoStack;
}

const SCRIPT_KEYS = ["dev", "build", "start", "test", "lint", "format"] as const;

function pmInstall(pm: PackageManager): string {
  if (pm === "pnpm") return "pnpm install";
  if (pm === "yarn") return "yarn";
  if (pm === "bun") return "bun install";
  return "npm install";
}

export function scriptCommand(pm: PackageManager, script: string): string {
  if (pm === "npm") {
    if (script === "start" || script === "test") return `npm ${script}`;
    return `npm run ${script}`;
  }
  if (pm === "pnpm") return `pnpm ${script}`;
  if (pm === "yarn") return `yarn ${script}`;
  return `bun run ${script}`;
}

function defaultDevCommand(pm: PackageManager): string {
  return scriptCommand(pm, "dev");
}

function envVarList(envVars: string[]): string {
  if (envVars.length === 0) return "See `.env.example` for the full list.";
  return envVars.map((v) => `- \`${v}\``).join("\n");
}

/** Returns markdown sections to append to README.md */
export function buildReadmeSections(input: ReadmeSetupInput): string[] {
  if (input.stack && input.stack.language !== "node" && input.stack.language !== "unknown") {
    const langSections = buildLanguageReadmeSections({
      fullName: input.fullName,
      repoName: input.repoName,
      framework: input.framework,
      stack: input.stack,
      envVars: input.envVars,
      withEnvStep: input.withEnvStep,
    });
    if (langSections.length > 0) return langSections;
  }

  const sections: string[] = [];
  const install = pmInstall(input.packageManager);
  const devCmd = input.scripts.dev
    ? scriptCommand(input.packageManager, "dev")
    : defaultDevCommand(input.packageManager);

  sections.push(
    ["## Prerequisites", "", `- Node.js ${input.nodeVersion}+`, `- ${input.packageManager}`].join(
      "\n",
    ),
  );

  const stackLine = input.framework !== "unknown" ? `**Stack:** ${input.framework}\n\n` : "";

  let step = 1;
  const steps: string[] = [
    `**${step++}. Clone and install**\n\n\`\`\`bash\ngit clone https://github.com/${input.fullName}.git\ncd ${input.repoName}\n${install}\n\`\`\``,
  ];

  if (input.withEnvStep) {
    steps.push(
      `**${step++}. Configure environment**\n\n\`\`\`bash\ncp .env.example .env\n\`\`\`\n\nFill in \`.env\` with required variables:\n\n${envVarList(input.envVars)}`,
    );
  }

  steps.push(`**${step++}. Run in development**\n\n\`\`\`bash\n${devCmd}\n\`\`\``);

  sections.push(["## Getting started", "", stackLine + steps.join("\n\n")].join("\n"));

  const scriptRows = SCRIPT_KEYS.filter((key) => Boolean(input.scripts[key]));
  if (scriptRows.length >= 2) {
    const table = [
      "## Available scripts",
      "",
      "| Script | Command |",
      "| --- | --- |",
      ...scriptRows.map(
        (key) => `| \`${key}\` | \`${scriptCommand(input.packageManager, key)}\` |`,
      ),
    ].join("\n");
    sections.push(table);
  }

  if (input.scripts.build && (input.scripts.start || input.scripts["start:prod"])) {
    const startScript = input.scripts.start ? "start" : "start:prod";
    sections.push(
      [
        "## Production build",
        "",
        "```bash",
        scriptCommand(input.packageManager, "build"),
        scriptCommand(input.packageManager, startScript),
        "```",
        "",
        input.withEnvStep
          ? "Set the same environment variables from `.env.example` on your host before starting."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return sections;
}
