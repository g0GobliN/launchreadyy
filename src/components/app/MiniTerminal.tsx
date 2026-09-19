import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useSandboxStream, formatElapsed } from "@/hooks/useSandboxStream";
import { SandboxStepChips } from "@/components/app/SandboxStepChips";

export function MiniTerminal({
  runId,
  className,
  onStatus,
}: {
  runId: string | null | undefined;
  className?: string;
  onStatus?: (status: string | null) => void;
}) {
  const { liveLog, plannedSteps, currentStep, completedSteps, status, elapsedMs, isStreaming } =
    useSandboxStream(runId);
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [liveLog]);

  if (!runId) {
    return (
      <div
        className={cn(
          "app-terminal flex h-[300px] items-center justify-center rounded-[5px] border border-[var(--app-terminal-border)] text-sm text-[var(--app-terminal-muted)]",
          className,
        )}
      >
        Verification will run here before the PR is opened.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "app-terminal flex h-[300px] flex-col overflow-hidden rounded-[5px] border border-[var(--app-terminal-border)]",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-[var(--app-terminal-border)] px-3 py-2 text-xs text-[var(--app-terminal-muted)]">
        <span>Sandbox verification</span>
        <span>{formatElapsed(elapsedMs)}</span>
      </div>
      <div className="border-b border-[var(--app-terminal-border)] px-3 py-2">
        <SandboxStepChips
          plannedSteps={plannedSteps}
          currentStep={currentStep}
          completedSteps={completedSteps}
          isPreparing={isStreaming}
          variant="terminal"
        />
      </div>
      <pre
        ref={ref}
        className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-[var(--app-terminal-text)]"
      >
        {liveLog || (isStreaming ? "Waiting for output…" : "No log output.")}
      </pre>
    </div>
  );
}
