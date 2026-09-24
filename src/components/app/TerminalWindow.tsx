import { memo, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, XCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LogLine } from "@/lib/sandbox-log-lines";
import type { CompletedStep, PlannedStep } from "@/hooks/useSandboxStream";
import { STEP_LABEL, stepChipStatus } from "@/hooks/useSandboxStream";
import { SandboxStepChips } from "@/components/app/SandboxStepChips";

export type TerminalWindowProps = {
  logs: LogLine[];
  liveLog?: string;
  isStreaming: boolean;
  plannedSteps: PlannedStep[];
  currentStep: string | null;
  completedSteps: CompletedStep[];
  /** How long `currentStep` has been running — lets the chip show a live timer
   *  instead of the log needing to say "still running" for a genuinely quiet step. */
  currentStepElapsedMs?: number;
  className?: string;
};

const TYPE_ICON = {
  success: <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />,
  error: <XCircle className="h-3.5 w-3.5 shrink-0 text-[var(--app-terminal-text)]" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--app-terminal-muted)]" />,
  info: <Info className="h-3.5 w-3.5 shrink-0 text-[var(--app-terminal-muted)]" />,
  command: <span className="shrink-0 text-primary">$</span>,
  output: <span className="w-3.5 shrink-0" />,
};

/** Memoized so a long log's rows survive the reveal ticks untouched — line objects
 *  only change identity when a poll brings new output, not on every 40ms tick. */
const LogRow = memo(function LogRow({ line, message }: { line: LogLine; message: string }) {
  return (
    <div
      data-log-error={line.type === "error" ? "" : undefined}
      className={cn(
        "flex gap-2 py-0.5 leading-relaxed",
        line.type === "error" && "border-l-2 border-[var(--app-terminal-text)] bg-white/5 pl-2",
        line.type === "warning" && "border-l-2 border-[var(--app-terminal-muted)] bg-white/5 pl-2",
        line.type === "command" &&
          "mt-1 rounded-[4px] bg-black/[0.04] px-2 py-1 dark:bg-white/[0.04]",
      )}
    >
      {TYPE_ICON[line.type]}
      {/* On a 400px screen "[00:59:52]" eats a quarter of every line and pushes commands into
          unreadable slivers. The step chips already carry timing, so drop it below sm. */}
      {line.timestamp && (
        <span className="hidden shrink-0 text-[var(--accent-foreground)] sm:inline">
          [{line.timestamp}]
        </span>
      )}
      <span
        className={cn(
          // anywhere, not break-all: break-all splits a token even when moving the whole
          // token to the next line would have fit, which is what shredded long CLI flags.
          "min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-[var(--app-terminal-text)]",
          line.type === "command" && "font-medium",
        )}
      >
        {message || line.message}
      </span>
    </div>
  );
});

export function TerminalWindow({
  logs,
  liveLog,
  isStreaming,
  plannedSteps,
  currentStep,
  completedSteps,
  currentStepElapsedMs = 0,
  className,
}: TerminalWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const jumpedToErrorRef = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const s of plannedSteps) {
      const st = stepChipStatus(s.step, currentStep, completedSteps);
      if (st === "done") next[s.step] = collapsed[s.step] ?? true;
      else if (st === "failed") next[s.step] = false;
      else next[s.step] = false;
    }
    setCollapsed((prev) => ({ ...prev, ...next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only recompute on step changes
  }, [plannedSteps, currentStep, completedSteps]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, liveLog]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (logs.length === 0) {
      jumpedToErrorRef.current = null;
      stickToBottomRef.current = true;
      return;
    }
    const firstError = logs.find((l) => l.type === "error");
    if (!firstError || jumpedToErrorRef.current === firstError.id) return;
    jumpedToErrorRef.current = firstError.id;
    const errEl = el.querySelector<HTMLElement>("[data-log-error]");
    if (!errEl) return;
    stickToBottomRef.current = false;
    const top = errEl.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    el.scrollTo({ top: top - el.clientHeight / 2, behavior: "smooth" });
  }, [logs]);

  return (
    <div
      className={cn(
        "app-terminal flex h-full min-h-0 flex-col border border-[var(--app-terminal-border)] font-mono text-[12px] sm:text-[13px]",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-4xl shrink-0 border-b border-[var(--app-terminal-border)] px-3 py-2.5 sm:px-4 sm:py-3">
        <SandboxStepChips
          plannedSteps={plannedSteps}
          currentStep={currentStep}
          completedSteps={completedSteps}
          currentStepElapsedMs={currentStepElapsedMs}
          isPreparing={isStreaming}
          variant="terminal"
          onStepClick={(step) => setCollapsed((c) => ({ ...c, [step]: !c[step] }))}
        />
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-6 sm:py-4"
      >
        <div className="mx-auto w-full max-w-4xl">
          {plannedSteps.map((s) => {
            const st = stepChipStatus(s.step, currentStep, completedSteps);
            const completed = completedSteps.find((c) => c.step === s.step);
            const isCollapsed = collapsed[s.step] && st === "done";
            if (st === "pending") return null;
            return (
              <div key={s.step} className="mb-4">
                <button
                  type="button"
                  className="mb-2 flex w-full items-center gap-2 text-left text-sm font-semibold text-[var(--app-terminal-text)]"
                  onClick={() => setCollapsed((c) => ({ ...c, [s.step]: !c[s.step] }))}
                >
                  <span className="hidden text-[var(--app-terminal-muted)] sm:inline">───</span>
                  {STEP_LABEL[s.step] ?? s.step}
                  <span className="flex-1 border-b border-[var(--app-terminal-border)]" />
                  {completed && (
                    <span className="text-xs font-normal text-[var(--app-terminal-muted)]">
                      {(completed.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </button>
                {!isCollapsed && s.command && (
                  <p className="mb-2 [overflow-wrap:anywhere] text-[var(--app-terminal-muted)]">
                    $ {s.command}
                  </p>
                )}
              </div>
            );
          })}

          {(liveLog ? liveLog.split("\n") : logs.map((l) => l.message)).map((message, i) => {
            const line = logs[i] ?? {
              id: `raw-${i}`,
              timestamp: "",
              type: "output" as const,
              message,
            };
            if (!message && i === (liveLog?.split("\n").length ?? 0) - 1) return null;
            return <LogRow key={line.id} line={line} message={message} />;
          })}

          {isStreaming && (
            <span
              className="mt-1 inline-block h-4 w-2 animate-pulse bg-[var(--app-terminal-text)]"
              aria-hidden
            />
          )}

          {!isStreaming && !liveLog && logs.length === 0 && (
            <p className="text-[var(--app-terminal-muted)]">Waiting for sandbox output…</p>
          )}
        </div>
      </div>
    </div>
  );
}
