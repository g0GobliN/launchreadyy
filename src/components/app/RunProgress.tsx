import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * One run, told as stages.
 *
 * The product runs two things — a static read of the repo, then a real build in a sandbox — and
 * the UI used to expose both, with their own names, statuses and timestamps. To the person
 * waiting it is one action, so this is the only progress surface: the internal split stays
 * internal, and the build log is a detail you can open, not a place you get sent.
 */
export type RunStage = "reading" | "building" | "done";

const STAGES: Array<{ id: RunStage; label: string; detail: string }> = [
  {
    id: "reading",
    label: "Reading your code",
    detail: "Pulling the repository and checking it against the readiness rules.",
  },
  {
    id: "building",
    label: "Installing and building",
    detail: "Running install, build and lint in a clean sandbox, then the security checks.",
  },
  { id: "done", label: "Verdict ready", detail: "" },
];

function stageIndex(stage: RunStage): number {
  return STAGES.findIndex((s) => s.id === stage);
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function RunProgress({
  stage,
  repoId,
  repoName,
  startedAt,
}: {
  stage: Exclude<RunStage, "done">;
  repoId: string;
  repoName: string;
  startedAt?: string | null;
}) {
  const current = stageIndex(stage);
  const detail = STAGES[current]?.detail ?? "";
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const parsedStart = startedAt ? new Date(startedAt).getTime() : Number.NaN;
    const origin = Number.isFinite(parsedStart) ? parsedStart : Date.now();
    const updateElapsed = () => setElapsedMs(Math.max(0, Date.now() - origin));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return (
    <section className="flex min-h-[390px] flex-col overflow-hidden rounded-[5px] border border-border bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">Analyzing {repoName}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Production readiness verification</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            Elapsed{" "}
            <span className="font-mono tabular-nums text-foreground">
              {formatElapsed(elapsedMs)}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-data">
            <span className="h-1.5 w-1.5 rounded-full bg-data" />
            Running
          </span>
        </div>
      </header>

      <div className="h-0.5 overflow-hidden bg-muted" aria-hidden>
        <span className="block h-full w-1/3 bg-data motion-safe:animate-[progress_1.8s_ease-in-out_infinite]" />
      </div>

      <div className="grid flex-1 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="px-5 py-5 sm:px-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Pipeline
          </h2>

          <ol className="mt-3 divide-y divide-border border-y border-border">
            {STAGES.filter((s) => s.id !== "done").map((s, i) => {
              const state = i < current ? "done" : i === current ? "active" : "pending";
              return (
                <li key={s.id} className="flex items-center gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        state === "pending"
                          ? "text-sm text-muted-foreground"
                          : "text-sm font-medium text-foreground"
                      }
                    >
                      {s.label}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {s.detail}
                    </p>
                  </div>
                  <span
                    className={
                      state === "active"
                        ? "shrink-0 text-[11px] font-medium text-data"
                        : "shrink-0 text-[11px] font-medium text-muted-foreground"
                    }
                  >
                    {state === "done" ? "Complete" : state === "active" ? "Running" : "Queued"}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <aside className="border-t border-border bg-surface/40 px-5 py-5 md:border-l md:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Current activity
          </p>
          <p className="mt-4 text-sm font-medium text-foreground">{STAGES[current]?.label}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
          {stage === "building" && (
            <Link
              to="/repo/$repoId/sandbox"
              params={{ repoId }}
              className="mt-5 inline-flex rounded-[5px] border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              View build log
            </Link>
          )}
        </aside>
      </div>

      <footer className="border-t border-border px-5 py-3 text-xs text-muted-foreground sm:px-6">
        Analysis continues in the background. The production verdict opens when verification is
        complete.
      </footer>
    </section>
  );
}
