/**
 * Measures the one number the product cannot currently quote: what fraction of *model-authored*
 * patches actually survive install/build/lint.
 *
 * `verify-fix-tools.ts` already audits the deterministic generators by executing them for real.
 * Nothing covered the AI ones. Earlier pipeline coverage reports were high, but that measured
 * mechanics — 27 fixtures completing a PR lifecycle — and says nothing about whether the patches
 * were right. This closes that.
 *
 * It measures a *lower bound* on correctness. A patch that compiles can still be wrong. The bound
 * is worth publishing anyway because it is exactly the bar `verifyBeforePr` holds a patch to
 * before it reaches a pull request, so the number answers "how often does the gate reject our own work".
 *
 * ── Cost ──────────────────────────────────────────────────────────────────────
 * A real run uses AI provider tokens (one generation per repo × fix) and E2B sandbox time (one boot per
 * attempt). It bypasses the AI cache on purpose — a cached hit would measure the cache, not the
 * model. Start small with `--limit`.
 *
 *   npx tsx scripts/measure-ai-fix-quality.ts --dry-run          # no AI, no sandbox, no spend
 *   node --env-file=.env --import tsx scripts/measure-ai-fix-quality.ts \
 *     --repos owner/one,owner/two --limit 5
 *
 * Flags:
 *   --dry-run          stub the model and the sandbox; exercises everything else
 *   --repos a/b,c/d    repositories to measure (required unless --dry-run)
 *   --fixes ci-ai,...  restrict to these fix ids (default: every AI fix the scan reports)
 *   --limit N          stop after N attempts (default: no limit)
 *   --json PATH        also write the raw attempts + summary as JSON
 */
import fs from "node:fs";
import {
  summarise,
  formatReport,
  type Attempt,
  type AttemptOutcome,
} from "../src/lib/ai-quality/report";
import { AI_FIX_IDS } from "../src/lib/plans";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const DRY_RUN = has("dry-run");
const LIMIT = Number(arg("limit") ?? "0") || Infinity;
const ONLY_FIXES = new Set((arg("fixes") ?? "").split(",").filter(Boolean));
const REPOS = (arg("repos") ?? "").split(",").filter(Boolean);
const JSON_OUT = arg("json");

/** One repo × one fix. Kept separate from execution so --dry-run walks the identical plan. */
interface PlannedAttempt {
  repo: string;
  fixId: string;
  branch: string;
  framework?: string;
  scanId: string;
}

async function planReal(): Promise<PlannedAttempt[]> {
  const { GitHubFileProvider } = await import("../src/lib/scan-engine/github-file-provider");
  const { runScan } = await import("../src/lib/scan-engine/scan-repository");
  const { ghGet } = await import("../src/lib/fix-executor/github");

  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required (or pass --dry-run)");

  const planned: PlannedAttempt[] = [];
  for (const repo of REPOS) {
    process.stdout.write(`  scanning ${repo} ... `);
    const meta = await ghGet<{ default_branch: string }>(token, `/repos/${repo}`);
    const branch = meta.default_branch;
    const scan = await runScan(new GitHubFileProvider(token, repo, branch));

    // Only fixes this repo actually needs, and only the AI-backed ones — generating a patch for
    // a gap the repo does not have would measure nothing.
    const ids = [...new Set(scan.issues.map((i) => i.fixId))]
      .filter((id) => AI_FIX_IDS.has(id))
      .filter((id) => ONLY_FIXES.size === 0 || ONLY_FIXES.has(id))
      .sort();

    console.log(`${ids.length} AI fix${ids.length === 1 ? "" : "es"} applicable`);
    for (const fixId of ids) {
      planned.push({ repo, fixId, branch, framework: scan.framework, scanId: crypto.randomUUID() });
    }
  }
  return planned;
}

/** Generate one patch and put it through the same overlay + sandbox the pre-PR gate uses. */
async function runReal(p: PlannedAttempt): Promise<{ outcome: AttemptOutcome; fileCount: number }> {
  const token = process.env.GITHUB_TOKEN!;
  const { generateAiTests } = await import("../src/lib/ai-tests.server");
  const { GitHubFileProvider } = await import("../src/lib/scan-engine/github-file-provider");
  const { buildOverlayTree } = await import("../src/lib/sandbox-verify/verify-before-pr");
  const { getSandboxAdapter } = await import("../src/lib/adapters/sandbox");
  const { detectSandboxCommands, detectSandboxEcosystem } =
    await import("../src/lib/sandbox/commands");
  const { classifyFailure } = await import("../src/lib/sandbox-verify/failure-classify");

  // bypassCache: a cache hit would measure the cache, not the model.
  const generated = await generateAiTests(
    p.scanId,
    [p.fixId],
    p.repo,
    token,
    p.framework,
    undefined,
    true,
  );
  if (generated.length === 0) {
    return { outcome: { status: "no_output", detail: "model returned no files" }, fileCount: 0 };
  }

  const adapter = getSandboxAdapter();
  if (!adapter.available()) {
    return {
      outcome: { status: "skipped", detail: "sandbox provider not configured" },
      fileCount: generated.length,
    };
  }

  const provider = new GitHubFileProvider(token, p.repo, p.branch);
  const filePaths = await provider.listFiles();
  const overlays = generated.map((f) => ({ path: f.path, content: f.content }));
  const ecosystem = detectSandboxEcosystem([...filePaths, ...overlays.map((f) => f.path)], null);
  if (!ecosystem) {
    return {
      outcome: { status: "skipped", detail: "no supported manifest" },
      fileCount: generated.length,
    };
  }

  let scripts: Record<string, string> = {};
  try {
    const pkgRaw = await provider.readFile("package.json");
    if (pkgRaw)
      scripts = (JSON.parse(pkgRaw) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    /* not a Node repo, or unreadable — commands are detected from paths too */
  }

  const commandSet = detectSandboxCommands({
    filePaths: [...filePaths, ...overlays.map((f) => f.path)],
    scripts,
    // A generated test suite that never runs proves nothing, so ask for the test step whenever
    // the fix produces one. This is the same rule the real gate applies.
    includeTest: p.fixId.includes("test") || p.fixId.includes("vitest"),
    rootDir: null,
  });
  if (commandSet.commands.length === 0) {
    return {
      outcome: { status: "skipped", detail: "no sandbox commands detected" },
      fileCount: generated.length,
    };
  }

  const files = await buildOverlayTree(provider, filePaths, overlays, null);
  const result = await adapter.run({
    source: { kind: "files", files },
    env: {},
    commands: commandSet.commands,
    timeoutMs: 5 * 60_000,
  });

  if (result.skipped || (result.providerError && result.steps.length === 0)) {
    return {
      outcome: {
        status: "skipped",
        detail: result.skipReason ?? result.providerError ?? "sandbox skipped",
      },
      fileCount: generated.length,
    };
  }
  if (result.ok) return { outcome: { status: "passed" }, fileCount: generated.length };

  return {
    outcome: {
      status: "failed",
      category: classifyFailure(result.steps),
      failedStep: result.steps.find((s) => s.exitCode !== 0)?.step,
    },
    fileCount: generated.length,
  };
}

/**
 * Deterministic stand-in for --dry-run. Spends nothing and touches no network, but walks the same
 * plan → execute → summarise path, so the harness's own logic is exercised before a paid run.
 */
function planDry(): PlannedAttempt[] {
  const fixes = ["ci-ai", "env-example-ai", "vitest-ai", "readme-ai"];
  return ["acme/api", "acme/web", "acme/worker"].flatMap((repo) =>
    fixes.map((fixId) => ({ repo, fixId, branch: "main", scanId: `dry-${repo}-${fixId}` })),
  );
}

function runDry(p: PlannedAttempt, i: number): { outcome: AttemptOutcome; fileCount: number } {
  const cycle = i % 5;
  if (cycle === 3) {
    return { outcome: { status: "failed", category: "source", failedStep: "build" }, fileCount: 1 };
  }
  if (cycle === 4) {
    return {
      outcome: { status: "skipped", detail: "sandbox provider not configured" },
      fileCount: 1,
    };
  }
  return { outcome: { status: "passed" }, fileCount: 1 };
}

async function main() {
  if (!DRY_RUN && REPOS.length === 0) {
    console.error("Nothing to measure. Pass --repos owner/name,... or --dry-run.");
    process.exit(2);
  }

  console.log(
    DRY_RUN ? "AI patch quality — DRY RUN (no AI, no sandbox, no spend)\n" : "AI patch quality\n",
  );

  const planned = DRY_RUN ? planDry() : await planReal();
  const queue = planned.slice(0, LIMIT === Infinity ? undefined : LIMIT);
  if (queue.length === 0) {
    console.log("No applicable AI fixes found — nothing to measure.");
    return;
  }
  console.log(`\n${queue.length} attempt${queue.length === 1 ? "" : "s"} to run.\n`);

  const attempts: Attempt[] = [];
  for (const [i, p] of queue.entries()) {
    process.stdout.write(`  [${i + 1}/${queue.length}] ${p.repo} · ${p.fixId} ... `);
    const started = Date.now();
    let outcome: AttemptOutcome;
    let fileCount = 0;
    try {
      const r = DRY_RUN ? runDry(p, i) : await runReal(p);
      outcome = r.outcome;
      fileCount = r.fileCount;
    } catch (e) {
      // One bad repo must not lose the results already gathered — a paid run is expensive to redo.
      outcome = { status: "error", detail: e instanceof Error ? e.message : String(e) };
    }
    const ms = Date.now() - started;
    attempts.push({ repo: p.repo, fixId: p.fixId, outcome, fileCount, ms });
    console.log(outcome.status === "failed" ? `failed (${outcome.category})` : outcome.status);
  }

  const summary = summarise(attempts);
  console.log(`\n${formatReport(summary)}\n`);

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ summary, attempts }, null, 2));
    console.log(`raw results: ${JSON_OUT}`);
  }
}

await main();
