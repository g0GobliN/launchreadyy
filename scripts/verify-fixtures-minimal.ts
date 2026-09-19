/**
 * CI-friendly dry-run over fixtures/minimal — lists stacks and asserts detection only.
 * Heavy Docker proof is `npm run verify:tools` (needs a daemon; see docs/guides/production.md).
 *
 * Usage: npm run verify:fixtures
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detectFramework, detectLanguage } from "../src/lib/scanner-rules";

const ROOT = join(process.cwd(), "fixtures/minimal");

function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

let failed = 0;
for (const stack of readdirSync(ROOT).filter((n) => statSync(join(ROOT, n)).isDirectory())) {
  const files = listFiles(join(ROOT, stack));
  const lang = detectLanguage(files);
  let framework = "n/a";
  if (files.includes("package.json")) {
    const pkg = JSON.parse(readFileSync(join(ROOT, stack, "package.json"), "utf8"));
    framework = detectFramework(pkg);
  }
  console.log(`${stack.padEnd(14)} language=${lang.padEnd(10)} framework=${framework}`);
  const fw = framework === "n/a" ? "unknown" : framework;
  // Static HTML has no language/framework labels — that is expected.
  if (stack === "static-html") continue;
  if (lang === "unknown" && fw === "unknown") {
    console.error(`  FAIL: could not detect ${stack}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} fixture(s) failed detection`);
  process.exit(1);
}
console.log("\nAll minimal fixtures detected.");
