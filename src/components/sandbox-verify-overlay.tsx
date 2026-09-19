import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { getSandboxVerifyStatusFn } from "@/lib/api/sandbox.functions";
import { SandboxStepChips } from "@/components/app/SandboxStepChips";

type PlannedStep = { step: string; command: string };
type CompletedStep = { step: string; command: string; exitCode: number; durationMs: number };

/** Bounded to the sandbox timeout plus headroom, polled every 1.5s. */
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 160;

export type SandboxVerifyOutcome = "passed" | "failed" | "skipped" | "timeout";

/**
 * Full-screen progress view shown while a sandbox verification run is in
 * flight — replaces a bare "Verifying…" button label so a ~1-4min wait reads
 * as active work (install → build → lint, with real streamed log output),
 * not a stuck page.
 */
export function SandboxVerifyOverlay({
  runId,
  repoFullName,
  onDone,
}: {
  runId: string;
  repoFullName: string;
  onDone: (outcome: SandboxVerifyOutcome) => void;
}) {
  const [plannedSteps, setPlannedSteps] = useState<PlannedStep[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<CompletedStep[]>([]);
  const [liveLog, setLiveLog] = useState("");
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      for (let i = 0; i < MAX_POLLS; i++) {
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (cancelled) return;
        try {
          const row = await getSandboxVerifyStatusFn({ data: { runId } });
          if (cancelled) return;
          setPlannedSteps(row.plannedSteps);
          setCurrentStep(row.currentStep);
          setCompletedSteps(row.completedSteps);
          setLiveLog(row.liveLog);
          if (row.status === "passed" || row.status === "failed" || row.status === "skipped") {
            onDoneRef.current(row.status);
            return;
          }
        } catch {
          /* keep polling — a transient blip shouldn't abort the wait */
        }
      }
      if (!cancelled) onDoneRef.current("timeout");
    }
    void poll();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveLog]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex shrink-0 flex-col items-center p-6 text-center sm:p-8 sm:pb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <h2 className="mt-3 font-display text-lg font-semibold">Verifying in a sandbox</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Running a real build for <span className="font-mono">{repoFullName}</span> in an
            isolated sandbox — this proves the result instead of guessing.
          </p>
        </div>

        <div className="shrink-0 px-6 sm:px-8">
          <SandboxStepChips
            plannedSteps={plannedSteps}
            currentStep={currentStep}
            completedSteps={completedSteps}
            isPreparing={plannedSteps.length === 0}
            variant="surface"
          />
        </div>

        {liveLog && (
          <div className="mt-4 min-h-0 flex-1 border-t border-border px-6 pb-2 pt-3 sm:px-8">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Log output
            </p>
            <pre
              ref={logRef}
              className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground"
            >
              {liveLog}
            </pre>
          </div>
        )}

        <p className="shrink-0 px-6 py-4 text-center text-xs text-muted-foreground sm:px-8">
          This can take up to a few minutes. You&apos;ll see results as soon as it finishes.
        </p>
      </div>
    </div>
  );
}
