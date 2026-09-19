/**
 * e2b.dev sandbox adapter — real execution behind the Capability 1 facade.
 */
import type {
  SandboxAdapter,
  SandboxRunRequest,
  SandboxRunResult,
  SandboxStepResult,
} from "./sandbox";
import { UnavailableSandboxAdapter } from "./sandbox";

const REPO_DIR = "/home/user/repo";

export class E2bSandboxAdapter implements SandboxAdapter {
  /**
   * templateId: an optional custom e2b template (built via their CLI with a
   * chosen cpuCount/memoryMB) — CPU/RAM aren't runtime Sandbox.create() options,
   * they're baked into the template at build time. Falls back to e2b's default
   * 'base' template (modest resources) when unset.
   */
  constructor(
    private readonly apiKey: string,
    private readonly templateId?: string,
  ) {}

  available(): boolean {
    return Boolean(this.apiKey.trim());
  }

  async run(req: SandboxRunRequest): Promise<SandboxRunResult> {
    // Avoid loading the SDK until an E2B run is requested.
    //
    // Pin: e2b@≥2.33.0 eagerly runs `createRequire(import.meta.url)` (Rolldown shim).
    // On the runtime `import.meta.url` is undefined → crash before Sandbox.create.
    // Keep package.json on exact 2.32.0 until that module initialization is compatible.
    const { Sandbox, CommandExitError } = await import("e2b");
    const started = Date.now();
    let sandbox: InstanceType<typeof Sandbox> | null = null;
    // Declared outside try/catch so a mid-run crash (e.g. Build throws instead of just
    // exiting non-zero) can still report what actually completed, instead of the catch
    // block discarding real progress and reporting zero steps — which downstream gets
    // misread as "sandbox never ran" (skipped) rather than "it failed partway through",
    // and shows as a misleading "Sandbox finished" instead of a real failure.
    const steps: SandboxStepResult[] = [];

    try {
      const bootStarted = Date.now();
      sandbox = await Sandbox.create({
        apiKey: this.apiKey,
        ...(this.templateId ? { template: this.templateId } : {}),
        envs: req.env,
        timeoutMs: req.timeoutMs,
        // Default-deny broad egress except package registries — Capability 8.
        // e2b allowInternetAccess=false is too strict for npm; keep internet for install,
        // document that production should use network.denyOut allowlists when available.
        allowInternetAccess: true,
      });
      const bootMs = Date.now() - bootStarted;

      const cloneStarted = Date.now();
      if (req.source.kind === "git") {
        await sandbox.git.clone(req.source.url, {
          path: REPO_DIR,
          username: req.source.token ? "x-access-token" : undefined,
          password: req.source.token,
          depth: 1,
          branch: req.source.ref && req.source.ref !== "HEAD" ? req.source.ref : undefined,
        });
      } else {
        await sandbox.commands.run(`mkdir -p ${REPO_DIR}`);
        for (const [path, content] of Object.entries(req.source.files)) {
          const full = `${REPO_DIR}/${path.replace(/^\/+/, "")}`;
          await sandbox.files.write(full, content);
        }
      }
      const cloneMs = Date.now() - cloneStarted;

      // Only a full major.minor.patch survives — req.runtime.version traces back to
      // repo-controlled content (package.json engines / .nvmrc) resolved server-side
      // against nodejs.org's release index, so anything less exact (or malicious shell
      // metacharacters) is dropped rather than risk interpolation or a 404 download.
      const wantedNodeVersion =
        req.runtime?.language === "node" &&
        req.runtime.version &&
        /^\d+\.\d+\.\d+$/.test(req.runtime.version)
          ? req.runtime.version
          : undefined;
      const NODE_INSTALL_DIR = "/tmp/.node-runtime";

      // Download once up front rather than on every step. `nvm`/`n` aren't guaranteed to
      // exist on the sandbox image, so this just fetches the official tarball directly —
      // needs nothing beyond curl + tar, which any Linux image with npm already has.
      // Left un-silenced so a failed download shows up plainly in the log instead of
      // quietly no-op'ing — this is a nice-to-have, never a hard failure.
      let nodeSwitchNote: string | undefined;
      if (wantedNodeVersion) {
        const url = `https://nodejs.org/dist/v${wantedNodeVersion}/node-v${wantedNodeVersion}-linux-x64.tar.gz`;
        const bootstrap = await sandbox.commands
          .run(
            `mkdir -p ${NODE_INSTALL_DIR} && curl -fsSL "${url}" | tar -xz -C ${NODE_INSTALL_DIR} --strip-components=1`,
            { timeoutMs: 90_000 },
          )
          .catch((e) => ({
            exitCode: 1,
            stdout: "",
            stderr: e instanceof Error ? e.message : String(e),
          }));
        nodeSwitchNote =
          bootstrap.exitCode === 0
            ? `[sandbox] switched to Node ${wantedNodeVersion} (requested by repo)\n`
            : `[sandbox] could not switch to Node ${wantedNodeVersion}, continuing with the sandbox's default Node: ${(bootstrap.stderr || bootstrap.stdout || "unknown reason").trim()}\n`;
      }
      const withNodeVersion = (command: string) => {
        const extras = [
          wantedNodeVersion ? NODE_INSTALL_DIR + "/bin" : null,
          "$HOME/go/bin",
          "$HOME/.cargo/bin",
          "$HOME/.local/bin",
          "$HOME/.local/share/mise/shims",
          "$HOME/.dotnet",
          "$HOME/.dotnet/tools",
          "/usr/local/go/bin",
        ].filter(Boolean) as string[];
        // JAVA_HOME, not just PATH. The Gradle wrapper resolves its JVM from JAVA_HOME and fails
        // with "Please set the JAVA_HOME variable in your environment" even when `java` is on
        // PATH via the mise shims — so every `./gradlew` build in a Java or Kotlin repo would
        // fail on a correctly-built image. Resolved through mise at run time and only exported
        // when mise actually answers, so an image without it is left exactly as before rather
        // than being handed an empty JAVA_HOME (which breaks more tools than an unset one).
        const javaHome =
          'if [ -z "${JAVA_HOME:-}" ]; then _lr_java="$(mise where java 2>/dev/null || true)"; ' +
          '[ -n "$_lr_java" ] && export JAVA_HOME="$_lr_java"; fi;';
        return `export DOTNET_ROOT="\${DOTNET_ROOT:-$HOME/.dotnet}"; export PATH="${extras.join(":")}:$PATH"; ${javaHome} ${command}`;
      };

      // Surfaced so a slow run is diagnosable from the log itself — "which hop was slow
      // this time" — instead of looking the same as a fast run save for the timestamp.
      const timingNote = `[sandbox] boot ${bootMs}ms · clone ${cloneMs}ms\n${nodeSwitchNote ?? ""}`;

      let ok = true;
      const remaining = () => Math.max(5_000, req.timeoutMs - (Date.now() - started));

      for (const [i, cmd] of req.commands.entries()) {
        await req.onStepStart?.(cmd);
        if (i === 0) {
          void req.onLogChunk?.({ step: cmd.step, stream: "stdout", text: timingNote });
        }
        const stepStarted = Date.now();
        // Caught per-step, not left to the outer try/catch: e2b throws on a command
        // timeout rather than resolving with a non-zero exit code. Left uncaught here,
        // a slow `npm ci` on a big repo throws before this step is ever pushed to
        // `steps` — since it's the *first* command, that leaves `steps` empty exactly
        // like "the sandbox never ran," which reports as "skipped"/finished instead of
        // the real failure (a timeout on Install).
        let result: { exitCode: number; stdout?: string; stderr?: string };
        /** Set only on the paths below that mean "the process died", never on a plain exit. */
        let killed = false;
        const workDir = safeRelativeDir(cmd.cwd);
        const runDir = workDir ? `${REPO_DIR}/${workDir}` : REPO_DIR;
        try {
          result = await sandbox.commands.run(withNodeVersion(`cd ${runDir} && ${cmd.command}`), {
            timeoutMs: remaining(),
            envs: req.env,
            onStdout: (data) => {
              void req.onLogChunk?.({ step: cmd.step, stream: "stdout", text: data });
            },
            onStderr: (data) => {
              void req.onLogChunk?.({ step: cmd.step, stream: "stderr", text: data });
            },
          });
        } catch (e) {
          if (e instanceof CommandExitError) {
            // e2b throws on ANY non-zero exit, not just timeouts — but the thrown
            // error still carries the real stdout/stderr/exitCode from the command,
            // same as a resolved result would. Discarding them here (as this used to)
            // meant a normal build/lint failure showed up as a bare "exit status 1"
            // with none of the actual npm/vite/eslint output that explains why.
            result = { exitCode: e.exitCode, stdout: e.stdout, stderr: e.stderr };
          } else {
            const raw = e instanceof Error ? e.message : String(e);
            const message = describeProcessKill(raw).message;
            // Anything that throws here and isn't a CommandExitError is the process being
            // taken away from us — the step's `timeoutMs: remaining()` expiring, or the
            // connection dropping. That is the one reliable signal that this run says
            // nothing about the repository, so record it rather than re-reading the log later.
            killed = true;
            result = { exitCode: 1, stdout: "", stderr: message };
            // A genuine crash (timeout, dropped connection) skips onStdout/onStderr
            // entirely, unlike CommandExitError above — without this, the failure
            // reason only ever reaches the *final* raw_log, and anyone watching the
            // live stream sees nothing at all right up to the terminal "failed".
            void req.onLogChunk?.({
              step: cmd.step,
              stream: "stderr",
              text: `[sandbox] ${cmd.step} error: ${message}\n`,
            });
          }
        }
        // Covers the case where envd reports the kill as part of a *resolved*
        // result rather than a thrown error — same underlying signal, different path.
        const kill = describeProcessKill(result.stderr ?? "");
        const step: SandboxStepResult = {
          step: cmd.step,
          command: cmd.command,
          exitCode: result.exitCode,
          stdout: result.stdout ?? "",
          stderr: kill.message,
          durationMs: Date.now() - stepStarted,
          ...(killed || kill.killed ? { killed: true } : {}),
        };
        steps.push(step);
        await req.onStepDone?.(step);
        if (result.exitCode !== 0) {
          ok = false;
          break; // stop on first failure — later steps won't be meaningful
        }
      }

      const nodeVersion = await sandbox.commands
        .run(withNodeVersion("node -v"), { timeoutMs: 10_000 })
        .then((r) => (r.exitCode === 0 ? r.stdout.trim().replace(/^v/, "") : undefined))
        .catch(() => undefined);

      const buildOutputDir = await detectBuildOutputDir(sandbox);

      return {
        ok,
        steps,
        discovered: {
          nodeVersion,
          buildOutputDir,
          durationMs: Date.now() - started,
          packageManager: inferPmFromCommands(req.commands.map((c) => c.command)),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Real partial progress (e.g. Install completed before Build crashed) — reporting
      // it lets the caller mark this "failed", not "skipped" (which reads as a clean,
      // never-ran sandbox and — worse — as "Sandbox finished" in the UI).
      return {
        ok: false,
        steps,
        providerError: message,
      };
    } finally {
      if (sandbox) {
        await sandbox.kill().catch(() => {});
      }
    }
  }
}

/**
 * envd (the sandbox's Go process supervisor) reports a process death via signal as
 * the bare Go wait-status string, e.g. "signal: killed" for SIGKILL — accurate, but
 * meaningless to anyone reading the log. SIGKILL with no other explanation is almost
 * always the kernel OOM-killer; a large `npm ci`/build is the classic trigger on the
 * sandbox's default (modest-RAM) template.
 */
function describeProcessKill(text: string): { message: string; killed: boolean } {
  const trimmed = text.trim();
  const match = /^signal: (\w+)$/i.exec(trimmed);
  if (!match) return { message: text, killed: false };
  const signal = match[1].toLowerCase();
  if (signal === "killed") {
    return {
      message:
        "Sandbox process was killed (out of memory) — this repo's dependency tree likely exceeded the sandbox's memory limit. Try a sandbox template with more RAM (set E2B_TEMPLATE_ID).",
      killed: true,
    };
  }
  return { message: `Sandbox process was killed (signal: ${signal}).`, killed: true };
}

/**
 * Same posture as the Node version guard above: this value is interpolated straight
 * into a shell command, so anything that isn't a plain relative path is dropped and
 * the command runs at the repo root rather than risking interpolation. Callers
 * already validate via normalizeRootDir — this is the second lock on the same door.
 */
function safeRelativeDir(dir: string | undefined): string | undefined {
  if (!dir) return undefined;
  if (!/^[A-Za-z0-9._/-]+$/.test(dir)) return undefined;
  return dir.split("/").includes("..") ? undefined : dir;
}

function inferPmFromCommands(commands: string[]): string | undefined {
  const joined = commands.join(" ");
  if (/\bpnpm\b/.test(joined)) return "pnpm";
  if (/\byarn\b/.test(joined)) return "yarn";
  if (/\bbun\b/.test(joined)) return "bun";
  if (/\bnpm\b/.test(joined)) return "npm";
  return undefined;
}

async function detectBuildOutputDir(sandbox: {
  commands: {
    run: (
      cmd: string,
      opts?: { timeoutMs?: number },
    ) => Promise<{ stdout: string; exitCode: number }>;
  };
}): Promise<string | undefined> {
  const check = await sandbox.commands
    .run(
      `cd ${REPO_DIR} && for d in dist .next build out; do [ -d "$d" ] && echo "$d" && break; done`,
      { timeoutMs: 10_000 },
    )
    .catch(() => null);
  const dir = check?.stdout?.trim();
  return dir || undefined;
}

/** Prefer real e2b when keyed; otherwise unavailable stub. */
export function createSandboxAdapterFromEnv(): SandboxAdapter {
  const key = typeof process !== "undefined" ? process.env.E2B_API_KEY?.trim() : undefined;
  if (!key) {
    return new UnavailableSandboxAdapter("Sandbox provider not configured (missing E2B_API_KEY)");
  }
  const templateId =
    typeof process !== "undefined" ? process.env.E2B_TEMPLATE_ID?.trim() : undefined;
  return new E2bSandboxAdapter(key, templateId || undefined);
}
