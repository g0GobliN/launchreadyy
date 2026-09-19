import { Template, defaultBuildLogger } from "e2b";
import { template } from "./template";

async function main() {
  await Template.build(template, "launchreadyy-dev", {
    cpuCount: 4,
    memoryMB: 8192,
    onBuildLogs: defaultBuildLogger(),
  });
}

main().catch(console.error);
