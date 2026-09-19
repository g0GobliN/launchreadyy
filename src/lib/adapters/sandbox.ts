/**
 * Sandbox execution adapter — job handlers call through this facade,
 * never a provider SDK directly (Capability 1).
 */

/**
 * Verification steps ("install", "build", "lint", "test") run the repo's own toolchain, so their
 * exit status is a verdict on the repository. Probe steps gather data for us instead — the secret
 * sweep listing candidate paths — so a non-zero exit means our tooling had a problem, never that
 * the user's repo is broken.
 */
export type SandboxStep = "install" | "build" | "lint" | "test" | "secret-sweep";

/** Every step whose exit status is data collection, not a defect in the user's repository. */
export const PROBE_STEPS = ["secret-sweep"] as const;

export function isProbeStep(step: SandboxStep): boolean {
  return (PROBE_STEPS as readonly string[]).includes(step);
}

export type SandboxCommand = {
  step: SandboxStep;
  command: string;
  /** Repo-relative directory to run in. Undefined means the repository root. */
  cwd?: string;
};

export type SandboxSource =
  | { kind: "git"; url: string; ref: string; token?: string }
  | { kind: "files"; files: Record<string, string> };

export type SandboxRunRequest = {
  source: SandboxSource;
  env: Record<string, string>;
  commands: SandboxCommand[];
  /** Wall-clock budget for the whole run (must stay under JOB_TIMEOUT_MS). */
  timeoutMs: number;
  runtime?: { language: "node"; version?: string };
  /** Fired right before a step runs — lets the caller surface live progress. */
  onStepStart?: (step: SandboxCommand) => void | Promise<void>;
  /** Fired right after a step finishes (success or failure). */
  onStepDone?: (result: SandboxStepResult) => void | Promise<void>;
  /** Fired as a running command produces output — real terminal-style streaming. */
  onLogChunk?: (chunk: {
    step: SandboxStep;
    stream: "stdout" | "stderr";
    text: string;
  }) => void | Promise<void>;
};

export type SandboxStepResult = {
  step: SandboxStep;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /**
   * The process was killed rather than exiting on its own — the run's time budget ran out,
   * or the OOM killer took it. Set by the adapter, which is the only layer that can tell the
   * difference: a clean non-zero exit and a kill both arrive as "the command failed", but only
   * the first is a fact about the repository. Never infer this from log text (see isBudgetKill).
   */
  killed?: boolean;
};

export type SandboxDiscoveredFacts = {
  packageManager?: string;
  nodeVersion?: string;
  buildOutputDir?: string;
  durationMs?: number;
  requiredEnvKeys?: string[];
};

export type SandboxRunResult = {
  /** True when every step exited 0. */
  ok: boolean;
  /** Provider never ran (missing key, kill-switch, etc.). */
  skipped?: boolean;
  skipReason?: string;
  steps: SandboxStepResult[];
  discovered?: SandboxDiscoveredFacts;
  providerError?: string;
};

export interface SandboxAdapter {
  /** Whether a real provider is configured and reachable enough to attempt a run. */
  available(): boolean;
  run(req: SandboxRunRequest): Promise<SandboxRunResult>;
}

/** No-op adapter used until E2B_API_KEY (or equivalent) is configured. */
export class UnavailableSandboxAdapter implements SandboxAdapter {
  constructor(private readonly reason: string) {}

  available(): boolean {
    return false;
  }

  async run(_req: SandboxRunRequest): Promise<SandboxRunResult> {
    return {
      ok: false,
      skipped: true,
      skipReason: this.reason,
      steps: [],
      providerError: this.reason,
    };
  }
}

/**
 * Resolve the configured sandbox adapter.
 * The E2B SDK is loaded only when a run is attempted.
 */
export function getSandboxAdapter(): SandboxAdapter {
  const key = typeof process !== "undefined" ? process.env.E2B_API_KEY?.trim() : undefined;
  if (!key) {
    return new UnavailableSandboxAdapter("Sandbox provider not configured (missing E2B_API_KEY)");
  }
  const templateId =
    typeof process !== "undefined" ? process.env.E2B_TEMPLATE_ID?.trim() : undefined;
  return {
    available: () => true,
    async run(req) {
      const { E2bSandboxAdapter } = await import("./e2b-sandbox");
      return new E2bSandboxAdapter(key, templateId || undefined).run(req);
    },
  };
}
