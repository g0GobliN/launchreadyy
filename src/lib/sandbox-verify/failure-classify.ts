import type { SandboxStepResult } from "../adapters/sandbox";

export type VerifyFailureCategory = "dependency" | "source" | "env" | "unknown";

/**
 * The toolchain a step needs is absent from our sandbox image.
 *
 * `sandboxImageSupports()` claims an ecosystem whenever `E2B_TEMPLATE_ID` is set, so a template
 * that has drifted from `launchreadyy/template.ts` — or simply has not been rebuilt after a
 * toolchain was added — makes `go mod download` exit 127 with "go: command not found". That is
 * provider configuration missing, not a defect in the scanned repository, and it must never be
 * reported as one: a failed verification forces `computeVerdict()` to `not_ready`, so a working
 * Go app would be told it is unfit for production because our image lacks a compiler.
 *
 * Detected rather than assumed, because the same run legitimately fails with 127 when the
 * *repo's own* script calls a binary it never declared — so we require the missing binary to be
 * one of the interpreters we are responsible for providing.
 */
const IMAGE_TOOLCHAIN_BINARIES = new Set([
  "go",
  "cargo",
  "rustc",
  "mise",
  "gradle",
  "mvn",
  "maven",
  "java",
  "ruby",
  "gem",
  "bundle",
  "bundler",
  "mix",
  "elixir",
  "erl",
  "dotnet",
  "php",
  "composer",
  "python",
  "python3",
  "pip",
  "pip3",
  "poetry",
  "node",
  "npm",
  "pnpm",
  "yarn",
  "bun",
]);

const COMMAND_NOT_FOUND = /(?:^|\n).*?([\w.-]+): command not found/gi;

/**
 * Which of our own toolchains the image was missing, if any. Empty means the failure is the
 * repository's — classify it normally.
 */
export function missingImageToolchains(steps: SandboxStepResult[]): string[] {
  const missing = new Set<string>();
  for (const step of steps) {
    if (step.exitCode !== 127) continue;
    const blob = `${step.stdout}\n${step.stderr}`;
    COMMAND_NOT_FOUND.lastIndex = 0;
    for (const m of blob.matchAll(COMMAND_NOT_FOUND)) {
      const binary = (m[1] ?? "").trim().toLowerCase();
      if (IMAGE_TOOLCHAIN_BINARIES.has(binary)) missing.add(binary);
    }
  }
  return [...missing].sort();
}

/**
 * Phrasing only ever produced by a process being killed — the adapter's own kill message, a
 * bare signal line, V8 giving up on the heap, or a runner reporting its own expired deadline.
 *
 * Deliberately narrow. The obvious version of this ("does the log say timeout?") matches every
 * repo whose tests fail with `Timeout - Async callback was not invoked within the 5000 ms
 * timeout`, which is a normal test failure and one of the most common ones there is. Treating
 * those as inconclusive would quietly switch reuse off for exactly the repos it exists to help.
 */
const PROCESS_KILL_MARKERS =
  /Sandbox process was killed|JavaScript heap out of memory|\btimed out after\b|(?:^|\n)signal: \w+\s*$/i;

/**
 * Whether the run ended because it ran out of time or memory rather than reaching a verdict.
 *
 * The distinction matters for caching. A build that exits non-zero is a fact about the commit
 * and can be replayed for free on the next Analyze; a budget kill is a fact about *this
 * attempt*, and a repo that needs 95 seconds on a 90-second timeout must not be frozen into a
 * permanent "failed" the user can never get past.
 *
 * `step.killed` is the real signal — the adapter sets it at the one place that can tell a kill
 * from an exit. The text match is a fallback for rows written before that flag existed.
 */
export function isBudgetKill(steps: SandboxStepResult[]): boolean {
  return steps.some(
    (s) =>
      s.exitCode !== 0 &&
      (s.killed === true || PROCESS_KILL_MARKERS.test(`${s.stdout}\n${s.stderr}`)),
  );
}

/**
 * The package registry, not the repository, is what failed.
 *
 * Scoped to the install step on purpose. A build or test step that cannot reach the network is
 * usually a genuine finding about the repo — a test suite that needs a live API is a real
 * production-readiness problem and should be reported as one. Install is different: it talks to
 * npm/PyPI/crates.io on every single run, those have bad minutes, and freezing a registry blip
 * into a cached "this commit does not build" would be wrong for as long as the commit lives.
 */
const REGISTRY_NETWORK_ERRORS =
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|EPROTO|socket hang up|network timeout|Could not resolve host|TLS connect error|502 Bad Gateway|503 Service Unavailable|504 Gateway|429 Too Many Requests|npm ERR! code E5\d\d|registry\.npmjs\.org.*(?:502|503|504|429)|Temporary failure in name resolution/i;

export function isFlakyInstallFailure(steps: SandboxStepResult[]): boolean {
  return steps.some(
    (s) =>
      s.exitCode !== 0 &&
      s.step === "install" &&
      REGISTRY_NETWORK_ERRORS.test(`${s.stdout}\n${s.stderr}`),
  );
}

/** Why this run is not an answer about the commit, or null when it is one. */
export type InconclusiveReason = "budget_kill" | "flaky_infra";

/**
 * The single gate on caching a failure. Anything this names is re-run on the next Analyze
 * rather than replayed, so a repo that is merely slow — or unlucky with the registry — is
 * never frozen into a permanent "failed".
 */
export function inconclusiveReason(steps: SandboxStepResult[]): InconclusiveReason | null {
  if (isBudgetKill(steps)) return "budget_kill";
  if (isFlakyInstallFailure(steps)) return "flaky_infra";
  return null;
}

export function classifyFailure(steps: SandboxStepResult[]): VerifyFailureCategory {
  const blob = steps.map((s) => `${s.stdout}\n${s.stderr}`).join("\n");
  if (
    /ERESOLVE|peer dep|lockfile|ENOENT:.*node_modules|npm ERR! code ETARGET|yarn integrity/i.test(
      blob,
    )
  ) {
    return "dependency";
  }
  if (
    /Missing environment variable|env\([A-Z0-9_]+\)|process\.env\.[A-Z0-9_]+ is (not|undefined)/i.test(
      blob,
    )
  ) {
    return "env";
  }
  if (
    steps.some((s) => s.step === "build" || s.step === "lint") &&
    steps.some((s) => s.exitCode !== 0)
  ) {
    return "source";
  }
  return "unknown";
}
