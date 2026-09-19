import { Command } from "commander";
import pc from "picocolors";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");

function dirname(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

// Read version from package.json (works from src/cli and from a bundled dist/cli)
function resolveVersion(): string {
  for (const rel of ["../package.json", "../../package.json", "../../../package.json"]) {
    try {
      const raw = readFileSync(join(__dirname, rel), "utf-8");
      const parsed = JSON.parse(raw) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      // try next location
    }
  }
  return "1.0.0";
}
const VERSION = resolveVersion();

// Import commands
const { setupCommand } = await import("./commands/setup.js");
const { doctorCommand } = await import("./commands/doctor.js");
const { startCommand } = await import("./commands/start.js");
const { configCommand } = await import("./commands/config.js");
const { helpCommand } = await import("./commands/help.js");
const { isConfigured } = await import("./services/config.js");

const program = new Command("launchreadyy")
  .name("launchreadyy")
  .description("LaunchReadyy Community - Self-hosted repository analysis")
  .version(VERSION, "-v, --version", "Show version")
  .helpOption("-h, --help", "Show help")
  .addCommand(setupCommand)
  .addCommand(doctorCommand)
  .addCommand(startCommand)
  .addCommand(configCommand)
  .addCommand(helpCommand);

// Default action when no command provided
program.action(async () => {
  if (isConfigured()) {
    // Show the configured menu
    const { helpCommand } = await import("./commands/help.js");
    helpCommand.parse(["node", "launchreadyy", "help"], { from: "user" });
  } else {
    // Auto-run setup
    console.log(pc.bold("\n  LaunchReadyy Community\n"));
    console.log(pc.yellow("  First run detected. Starting guided setup...\n"));
    setupCommand.parse(["node", "launchreadyy", "setup"], { from: "user" });
  }
});

// Handle unknown commands
program.on("command:*", () => {
  console.error(pc.red(`\n  Unknown command: ${program.args.join(" ")}`));
  console.log(pc.gray("  Run 'launchreadyy --help' for available commands.\n"));
  process.exit(1);
});

program.parse(process.argv);

// If no args and not configured, show help
if (process.argv.length <= 2) {
  // This is handled by the action above
}
