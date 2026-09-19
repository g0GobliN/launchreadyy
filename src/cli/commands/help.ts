import { Command } from "commander";
import pc from "picocolors";
import { isConfigured } from "../services/config.js";

export const helpCommand = new Command("help").description("Show help").action(() => {
  const configured = isConfigured();

  console.log(pc.bold("\n  LaunchReadyy Community\n"));

  if (configured) {
    console.log(pc.green("  ✓ Configuration found"));
    console.log(pc.green("  ✓ Database ready\n"));
    console.log("  What would you like to do?\n");
    console.log(pc.cyan("  > launchreadyy start      ") + pc.gray("Start the application"));
    console.log(pc.cyan("    launchreadyy doctor     ") + pc.gray("Check installation"));
    console.log(pc.cyan("    launchreadyy config     ") + pc.gray("Update configuration"));
    console.log(pc.cyan("    launchreadyy help       ") + pc.gray("Show this help\n"));
  } else {
    console.log(pc.yellow("  LaunchReadyy is not configured yet.\n"));
    console.log("  Run the setup wizard:\n");
    console.log(pc.cyan("  > launchreadyy setup\n"));
    console.log(pc.gray("  Or see all commands:\n"));
  }

  console.log(pc.bold("  Commands:"));
  console.log(pc.cyan("    setup       ") + pc.gray("Configure LaunchReadyy for first use"));
  console.log(pc.cyan("    doctor      ") + pc.gray("Check installation and configuration"));
  console.log(pc.cyan("    start       ") + pc.gray("Start LaunchReadyy Community"));
  console.log(pc.cyan("    config      ") + pc.gray("Update configuration"));
  console.log(pc.cyan("    help        ") + pc.gray("Show help\n"));

  console.log(pc.bold("  Options:"));
  console.log(pc.cyan("    --help      ") + pc.gray("Show help for a command"));
  console.log(pc.cyan("    --version   ") + pc.gray("Show version\n"));

  console.log(pc.gray("  Run 'launchreadyy <command> --help' for more info on a command.\n"));
});
