import { build } from "esbuild";
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Always invoked from the project root (npm script / tsx), unlike the bundled
// CLI it produces — see the PROJECT_ROOT comment in commands/doctor.ts.
const PROJECT_ROOT = process.cwd();
const OUT_DIR = join(PROJECT_ROOT, "dist", "cli");

async function buildCLI() {
  // Ensure output directory exists
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  // Build the CLI entry point
  await build({
    entryPoints: [join(__dirname, "index.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: join(OUT_DIR, "index.js"),
    external: ["@clack/prompts", "commander", "picocolors", "better-sqlite3", "open"],
    banner: { js: "#!/usr/bin/env node" },

    sourcemap: true,
    treeShaking: true,
    minify: false,
  });

  console.log("CLI built successfully to dist/cli/index.js");
}

buildCLI().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
