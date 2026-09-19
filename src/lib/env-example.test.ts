/**
 * `.env.example` is the documented configuration surface, and documentation drifts. Two
 * directions matter, and both are checked here:
 *
 *   1. Every variable the running app reads must be documented — otherwise an operator
 *      cannot know a knob exists.
 *   2. Every documented variable must actually be read — a dead key sends someone off to
 *      configure something that does nothing.
 *
 * The "actually read" set is scanned from source, so it is a *superset*: scanner rules and
 * generated-fix templates contain `process.env.X` strings for the repos we analyse, not for
 * us. That only makes direction 2 more permissive, so it cannot produce a false failure.
 * Direction 1 uses an explicit list instead, because a regex cannot tell our own reads from
 * a rule that happens to look like one.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ENV_EXAMPLE = join(ROOT, ".env.example");

/**
 * Runtime configuration this application reads, verified by inspection. Standard runtime
 * variables (`NODE_ENV`) are excluded — nobody configures them per-install.
 */
const RUNTIME_VARS = [
  // Core local application
  "SESSION_SECRET",
  "ENV_VAR_ENCRYPTION_SECRET",
  "APP_URL",
  "VITE_APP_URL",
  "HOST",
  "PORT",
  // GitHub + display identity
  "GITHUB_TOKEN",
  "LOCAL_USER_LOGIN",
  "LOCAL_USER_EMAIL",
  "LOCAL_USER_AVATAR_URL",
  // Optional: E2B sandbox
  "E2B_API_KEY",
  "E2B_TEMPLATE_ID",
  // Optional: AI provider
  "AI_PROVIDER",
  "DEEPSEEK_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "CURSOR_API_KEY",
  "CLAUDE_MODEL",
  "CLAUDE_FAST_MODEL",
  "CLAUDE_OPUS_MODEL",
  "DEEPSEEK_MODEL",
  "DEEPSEEK_REASONER_MODEL",
  "OPENAI_MODEL",
  "GEMINI_MODEL",
  "CURSOR_MODEL",
  // Optional: operations
  "SANDBOX_MAX_CONCURRENT",
  "RATE_LIMIT_DISABLED",
  // Optional: public metadata
  "PUBLIC_GITHUB_URL",
  "VITE_PUBLIC_GITHUB_URL",
  "PUBLIC_APP_URL",
];

function documentedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const line of readFileSync(ENV_EXAMPLE, "utf8").split("\n")) {
    // A commented-out `# KEY=` is still documentation: optional overrides are shown
    // without being set, so they must not be reported as undocumented.
    const match = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) keys.add(match[1]!);
  }
  return keys;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function readKeysInSource(): Set<string> {
  const keys = new Set<string>();
  const roots = [join(ROOT, "src"), join(ROOT, "scripts"), join(ROOT, "vite.config.ts")];
  const files = roots.flatMap((root) => {
    try {
      return statSync(root).isDirectory() ? sourceFiles(root) : [root];
    } catch {
      return [];
    }
  });

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) keys.add(m[1]!);
    for (const m of text.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]*)/g)) keys.add(m[1]!);
  }
  return keys;
}

describe(".env.example", () => {
  const documented = documentedKeys();
  const read = readKeysInSource();

  it("documents every runtime variable the application reads", () => {
    const missing = RUNTIME_VARS.filter((key) => !documented.has(key));
    expect(missing, `Missing from .env.example: ${missing.join(", ")}`).toEqual([]);
  });

  it("documents no variable the code never reads", () => {
    const dead = [...documented].filter((key) => !read.has(key));
    expect(dead, `Documented but never read: ${dead.join(", ")}`).toEqual([]);
  });

  it("names reality rather than a hosted service", () => {
    const text = readFileSync(ENV_EXAMPLE, "utf8");
    for (const needle of ["SUPABASE", "STRIPE", "RESEND", "CLOUDFLARE", "WRANGLER"]) {
      expect(text, `.env.example still mentions ${needle}`).not.toContain(needle);
    }
  });
});
