import { useEffect, useMemo, useRef, useState } from "react";
import { getSandboxVerifyStatusFn } from "@/lib/api/sandbox.functions";
import { parseLiveLogLines, type LogLine } from "@/lib/sandbox-log-lines";

export type SandboxStreamStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "skipped"
  | "timeout";

export type PlannedStep = { step: string; command: string };
export type CompletedStep = { step: string; command: string; exitCode: number; durationMs: number };

const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 160;
// A poll can land many new lines at once (a quiet `npm ci` finishing, a build
// dumping its whole summary in one write) — revealing them a few at a time
// instead of all in the same render is what makes the terminal read as a
// stream rather than a periodic dump.
const REVEAL_TICK_MS = 40;
const REVEAL_CATCHUP_DIVISOR = 20;

export type UseSandboxStreamResult = {
  liveLog: string;
  lines: LogLine[];
  plannedSteps: PlannedStep[];
  currentStep: string | null;
  completedSteps: CompletedStep[];
  status: SandboxStreamStatus | null;
  /**
   * The run this status was actually polled from. Consumers that act on a terminal status —
   * "when it passes, navigate away" — must check this, or a freshly started run inherits the
   * previous run's `passed` for the renders before the first poll lands.
   */
  statusRunId: string | null;
  elapsedMs: number;
  currentStepElapsedMs: number;
  isStreaming: boolean;
  error: string | null;
  /** Server-persisted failure reason (provider crash, missing token, …) when status is failed. */
  errorMessage: string | null;
  /** From structured_results — see reuse-reason.ts for the markers a reused run carries. */
  skipReason: string | null;
  /** Set when the run never judged the repo: it ran out of budget, or the registry died. */
  inconclusive: "budget_kill" | "flaky_infra" | null;
};

/**
 * Polls sandbox verify status and exposes live log + step checklist.
 * Server still stores a text blob; LogLine parsing is client-side for UI only.
 */
export function useSandboxStream(runId: string | null | undefined): UseSandboxStreamResult {
  const [liveLog, setLiveLog] = useState("");
  const [plannedSteps, setPlannedSteps] = useState<PlannedStep[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<CompletedStep[]>([]);
  const [status, setStatus] = useState<SandboxStreamStatus | null>(null);
  const [statusRunId, setStatusRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState<string | null>(null);
  const [inconclusive, setInconclusive] = useState<UseSandboxStreamResult["inconclusive"]>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [currentStepElapsedMs, setCurrentStepElapsedMs] = useState(0);
  const [revealCount, setRevealCount] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  // Mask stale state the instant `runId` changes, during render itself rather than
  // waiting for the effect below to reset it. Without this, clicking Retry right after
  // a passed run briefly renders the *previous* run's terminal "passed" status against
  // the *new* runId — long enough for a consumer's "on passed, navigate away" effect to
  // fire immediately, before the new run has even started polling.
  const lastRunIdRef = useRef(runId);
  const runIdChanged = lastRunIdRef.current !== runId;
  if (runIdChanged) lastRunIdRef.current = runId;
  const effectiveStatus = runIdChanged ? null : status;

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    startedAtRef.current = Date.now();
    setLiveLog("");
    setPlannedSteps([]);
    setCurrentStep(null);
    setCompletedSteps([]);
    setStatus("queued");
    setStatusRunId(null);
    setError(null);
    setErrorMessage(null);
    setSkipReason(null);
    setElapsedMs(0);
    setCurrentStepElapsedMs(0);
    setRevealCount(0);

    // Tracked locally, not from the server — this is just "how long has the step
    // the server told us about been the current one," so the UI can show a live
    // ticking timer on it without needing the log itself to say anything.
    let currentStepStartedAt: number | null = null;
    let lastSeenStep: string | null = null;

    const tick = window.setInterval(() => {
      if (startedAtRef.current) setElapsedMs(Date.now() - startedAtRef.current);
      if (currentStepStartedAt) setCurrentStepElapsedMs(Date.now() - currentStepStartedAt);
    }, 1000);

    async function poll() {
      for (let i = 0; i < MAX_POLLS; i++) {
        if (cancelled) return;
        if (i > 0) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (cancelled) return;
        try {
          const row = await getSandboxVerifyStatusFn({ data: { runId: runId! } });
          if (cancelled) return;
          if (row.currentStep !== lastSeenStep) {
            lastSeenStep = row.currentStep;
            currentStepStartedAt = row.currentStep ? Date.now() : null;
            setCurrentStepElapsedMs(0);
          }
          setPlannedSteps(row.plannedSteps);
          setCurrentStep(row.currentStep);
          setCompletedSteps(row.completedSteps);
          setLiveLog(row.liveLog);
          setStatus(row.status);
          setStatusRunId(runId!);
          setSkipReason(row.skipReason ?? null);
          setInconclusive(row.inconclusive ?? null);
          setErrorMessage(row.errorMessage ?? null);
          if (row.status === "passed" || row.status === "failed" || row.status === "skipped") {
            window.clearInterval(tick);
            return;
          }
        } catch (e) {
          if (!cancelled)
            setError(e instanceof Error ? e.message : "Failed to poll sandbox status");
        }
      }
      window.clearInterval(tick);
      if (!cancelled) setStatus("timeout");
    }

    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [runId]);

  const effectiveLiveLog = runIdChanged ? "" : liveLog;
  const lines = useMemo(() => parseLiveLogLines(effectiveLiveLog), [effectiveLiveLog]);
  const isStreaming = effectiveStatus === "queued" || effectiveStatus === "running";

  // Trickle newly-arrived lines out instead of rendering the whole backlog in
  // one frame. Catches up faster the further behind it is, so a single huge
  // dump still finishes revealing in about a second rather than dragging on.
  useEffect(() => {
    if (revealCount >= lines.length) return;
    const id = window.setTimeout(() => {
      setRevealCount((c) => {
        const backlog = lines.length - c;
        const step =
          backlog > REVEAL_CATCHUP_DIVISOR ? Math.ceil(backlog / REVEAL_CATCHUP_DIVISOR) : 1;
        return Math.min(lines.length, c + step);
      });
    }, REVEAL_TICK_MS);
    return () => window.clearTimeout(id);
  }, [revealCount, lines.length]);

  const revealedCount = Math.min(revealCount, lines.length);
  const revealedLines = useMemo(() => lines.slice(0, revealedCount), [lines, revealedCount]);
  const revealedLiveLog = useMemo(
    () => revealedLines.map((l) => l.message).join("\n"),
    [revealedLines],
  );

  return {
    liveLog: revealedLiveLog,
    lines: revealedLines,
    plannedSteps: runIdChanged ? [] : plannedSteps,
    currentStep: runIdChanged ? null : currentStep,
    completedSteps: runIdChanged ? [] : completedSteps,
    status: effectiveStatus,
    statusRunId: runIdChanged ? null : statusRunId,
    elapsedMs,
    currentStepElapsedMs: runIdChanged ? 0 : currentStepElapsedMs,
    isStreaming,
    error,
    errorMessage: runIdChanged ? null : errorMessage,
    skipReason: runIdChanged ? null : skipReason,
    inconclusive: runIdChanged ? null : inconclusive,
  };
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const STEP_LABEL: Record<string, string> = {
  clone: "Clone",
  install: "Install",
  build: "Build",
  lint: "Lint",
  test: "Test",
  security: "Security",
};
