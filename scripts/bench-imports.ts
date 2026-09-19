/**
 * Benchmark: TS AST import extraction vs the native Rust `lr-indexer --imports` bridge.
 *
 * This exists because `rust/README.md` records that the JSON bridge *loses* for indexing (0.61×) —
 * spawn + (de)serialization outweigh faster hashing. Import extraction is a different trade: parsing
 * dominates, so the bridge may pay for itself here. That has to be measured, not assumed.
 *
 * Reads real files so the input is representative. Run:
 *   npx tsx scripts/bench-imports.ts [dir]        (default: src)
 * Requires the binary: npm run rust:build
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { detectAstLanguage, findImports, parseSource } from "../src/lib/scanner/ast";
import { extractImportsRegex } from "../src/lib/graph/build";
import { rustExtractImports } from "../src/lib/graph/rust-imports.server";
import { rustIndexerBinary } from "../src/lib/indexer/rust-backend.server";

const JS_LANGS = new Set(["typescript", "javascript", "tsx", "jsx"]);

function collect(dir: string, out: { path: string; content: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collect(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      out.push({ path: full, content: readFileSync(full, "utf-8") });
    }
  }
  return out;
}

/** The per-file TS path buildGraphFromSources uses when no accelerator is present. */
async function tsExtractAll(files: { path: string; content: string }[]) {
  const result: { path: string; imports: string[] }[] = [];
  for (const f of files) {
    const parsed = await parseSource(f.path, f.content);
    let imports: string[] = [];
    if (parsed.available && parsed.tree) imports = findImports(parsed.tree);
    else if (JS_LANGS.has(detectAstLanguage(f.path) ?? "")) {
      imports = extractImportsRegex(f.content);
    }
    result.push({ path: f.path, imports });
  }
  return result;
}

async function main() {
  const dir = process.argv[2] ?? "src";
  if (!rustIndexerBinary()) {
    console.error("lr-indexer not found — run: npm run rust:build");
    process.exit(1);
  }

  const files = collect(dir);
  const bytes = files.reduce((n, f) => n + f.content.length, 0);
  console.log(`${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB from ${dir}/\n`);

  // Warm both paths so neither pays first-call cost (TS compiler load, page cache).
  await tsExtractAll(files.slice(0, 20));
  rustExtractImports(files.slice(0, 20));

  const t0 = performance.now();
  const ts = await tsExtractAll(files);
  const tsMs = performance.now() - t0;

  const t1 = performance.now();
  const rust = rustExtractImports(files);
  const rustMs = performance.now() - t1;

  if (!rust) {
    console.error("Rust path returned null");
    process.exit(1);
  }

  const tsTotal = ts.reduce((n, f) => n + f.imports.length, 0);
  const rustTotal = rust.reduce((n, f) => n + f.imports.length, 0);

  console.log(`TS AST (per-file)        ${tsMs.toFixed(0)} ms   ${tsTotal} specifiers`);
  console.log(`Rust --imports (bridge)  ${rustMs.toFixed(0)} ms   ${rustTotal} specifiers`);
  console.log(`\nspeedup: ${(tsMs / rustMs).toFixed(2)}×`);

  // Any disagreement on a real codebase is worth seeing — the two should agree per the parity suite.
  const byPath = new Map(rust.map((f) => [f.path, new Set(f.imports)]));
  let diverged = 0;
  for (const f of ts) {
    const r = byPath.get(f.path);
    if (!r) continue;
    const missing = f.imports.filter((i) => !r.has(i));
    const extra = [...r].filter((i) => !f.imports.includes(i));
    if (missing.length || extra.length) {
      if (diverged < 5) {
        console.log(`\ndiverged ${f.path}`);
        if (missing.length) console.log(`  only TS:   ${missing.join(", ")}`);
        if (extra.length) console.log(`  only Rust: ${extra.join(", ")}`);
      }
      diverged++;
    }
  }
  console.log(diverged ? `\n${diverged} file(s) diverged` : "\nno divergence");
}

void main();
