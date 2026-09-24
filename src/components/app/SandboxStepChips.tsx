import { Box, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CompletedStep, PlannedStep } from "@/hooks/useSandboxStream";
import { STEP_LABEL, stepChipStatus, type StepChipStatus } from "@/hooks/useSandboxStream";

function chipClass(st: StepChipStatus, variant: "terminal" | "surface") {
  if (variant === "terminal") {
    if (st === "failed") return "border-foreground/30 bg-muted font-semibold text-foreground";
    if (st === "running") return "border-primary/50 bg-primary/10 text-[var(--app-terminal-text)]";
    if (st === "done") return "border-primary/40 bg-primary/10 text-data";
    return "border-[var(--app-terminal-border)] text-[var(--app-terminal-muted)]";
  }
  if (st === "failed") return "border-critical/40 bg-critical/10 text-critical";
  if (st === "running") return "border-primary/40 bg-primary/10 text-foreground";
  if (st === "done") return "border-success/40 bg-success/10 text-success";
  return "border-border text-muted-foreground";
}

/**
 * Sandbox pipeline chips — bordered badges with Box icon.
 * Used on TerminalWindow, MiniTerminal, and verify overlay.
 */
export function SandboxStepChips({
  plannedSteps,
  currentStep,
  completedSteps,
  currentStepElapsedMs = 0,
  isPreparing = false,
  onStepClick,
  variant = "terminal",
  className,
}: {
  plannedSteps: PlannedStep[];
  currentStep: string | null;
  completedSteps: CompletedStep[];
  currentStepElapsedMs?: number;
  isPreparing?: boolean;
  onStepClick?: (step: string) => void;
  /** terminal = dark sandbox chrome; surface = card / overlay */
  variant?: "terminal" | "surface";
  className?: string;
}) {
  // Before the plan exists there is nothing honest to draw: the old placeholder rendered a
  // greyed-out "Install" chip that belonged to no real step, so a run busy reading the
  // repository looked like a stalled install.
  const muted =
    variant === "terminal" ? "text-[var(--app-terminal-muted)]" : "text-muted-foreground";

  return (
    // Six chips wrap to three rows on a phone and swallow the terminal below them. One
    // scrollable row keeps the running step in view and gives the log back its space.
    <div
      className={cn(
        "flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "sm:flex-wrap sm:overflow-x-visible sm:pb-0",
        className,
      )}
    >
      {plannedSteps.map((s) => {
        const st = stepChipStatus(s.step, currentStep, completedSteps);
        const completed = completedSteps.find((c) => c.step === s.step);
        const body = (
          <>
            {st === "done" && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
            {st === "failed" && <XCircle className="h-3.5 w-3.5 shrink-0" />}
            {st === "running" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
            {st === "pending" && <Box className="h-3.5 w-3.5 shrink-0 opacity-80" />}
            <span>{STEP_LABEL[s.step] ?? s.step}</span>
            {completed && (
              <span className={cn("tabular-nums", muted)}>
                {(completed.durationMs / 1000).toFixed(1)}s
              </span>
            )}
            {st === "running" && currentStepElapsedMs > 0 && (
              <span className={cn("tabular-nums", muted)}>
                {Math.floor(currentStepElapsedMs / 1000)}s
              </span>
            )}
          </>
        );
        const cls = cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-[6px] border px-2 py-1 text-xs transition-colors sm:px-2.5 sm:py-1.5",
          chipClass(st, variant),
          onStepClick && "cursor-pointer hover:opacity-90",
        );

        if (onStepClick) {
          return (
            <button key={s.step} type="button" onClick={() => onStepClick(s.step)} className={cls}>
              {body}
            </button>
          );
        }
        return (
          <span key={s.step} className={cls}>
            {body}
          </span>
        );
      })}
      {isPreparing && plannedSteps.length === 0 && (
        <span className={cn("inline-flex items-center gap-1.5 text-xs", muted)}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Reading the repository to plan the build…
        </span>
      )}
    </div>
  );
}
