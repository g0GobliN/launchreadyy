import { createFileRoute, Link, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { RepoNotFound } from "@/components/app/RepoNotFound";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { getRepoFn } from "@/lib/api/db.functions";
import { getCurrentAnalysisSandboxRunFn } from "@/lib/api/sandbox.functions";
import { getRepoScanJobFn, triggerScan } from "@/lib/api/github.functions";
import { getSessionUserFn } from "@/lib/api/session.functions";
import { RepoLayout } from "@/components/layouts/RepoLayout";
import { TerminalWindow } from "@/components/app/TerminalWindow";
import { formatElapsed, STEP_LABEL, useSandboxStream } from "@/hooks/useSandboxStream";
import { AuthErrorScreen } from "@/components/auth-error-screen";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { REUSED_FAILURE, REUSED_PASS } from "@/lib/sandbox-verify/reuse-reason";
import { sandboxRunForCurrentAnalysis } from "@/lib/sandbox/current-analysis";

const searchSchema = z.object({
  runId: z.string().optional(),
});

export const Route = createFileRoute("/repo/$repoId/sandbox")({
  head: () => ({ meta: [{ title: "Latest build — LaunchReadyy" }] }),
  validateSearch: searchSchema,
  notFoundComponent: () => <RepoNotFound reason="repo" />,
  errorComponent: ({ error }) => <AuthErrorScreen error={error} />,
  loader: async ({ params }) => {
    const [repo, currentRun, scanJob] = await Promise.all([
      getRepoFn({ data: { repoId: params.repoId } }),
      getCurrentAnalysisSandboxRunFn({ data: { repoId: params.repoId } }).catch(() => null),
      getRepoScanJobFn({ data: { repoId: params.repoId } }).catch(() => null),
    ]);
    if (!repo) throw notFound();
    return { repo, initialCurrentRun: currentRun, initialScanJob: scanJob };
  },
  component: SandboxPage,
});

function SandboxPage() {
  const { repo, initialCurrentRun, initialScanJob } = Route.useLoaderData();
  const { runId: searchRunId } = Route.useSearch();
  const { repoId } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const navigatedRef = useRef(false);
  /** Only auto-forward to the verdict when a run was explicitly launched/retried this
   *  visit — a run we silently picked up from history should just sit there, read-only. */
  const [autoAdvance, setAutoAdvance] = useState(
    Boolean(
      searchRunId ||
      initialScanJob?.running ||
      ["queued", "running"].includes(initialCurrentRun?.status ?? ""),
    ),
  );

  const { data: sessionUser } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: Infinity,
  });

  const scanJobQuery = useQuery({
    queryKey: ["repo-scan-job", repoId],
    queryFn: () => getRepoScanJobFn({ data: { repoId } }),
    initialData: initialScanJob,
    refetchInterval: (query) => (query.state.data?.running ? 3_000 : false),
  });
  const scanJob = scanJobQuery.data;

  const { data: currentRun, refetch: refetchCurrentRun } = useQuery({
    queryKey: ["sandbox-current-analysis-run", repoId],
    queryFn: () => getCurrentAnalysisSandboxRunFn({ data: { repoId } }).catch(() => null),
    initialData: initialCurrentRun,
    refetchInterval: scanJob?.running ? 1_500 : false,
  });
  const { runId, waitingForScan } = sandboxRunForCurrentAnalysis({
    explicitRunId: searchRunId,
    latestRun: currentRun,
    scanJob,
  });

  const stream = useSandboxStream(runId);

  useEffect(() => {
    if (searchRunId || scanJob?.running) setAutoAdvance(true);
  }, [searchRunId, scanJob?.running]);

  const wasScanRunning = useRef(initialScanJob?.running ?? false);
  useEffect(() => {
    if (wasScanRunning.current && !scanJob?.running) void refetchCurrentRun();
    wasScanRunning.current = scanJob?.running ?? false;
  }, [scanJob?.running, refetchCurrentRun]);

  useEffect(() => {
    if (!stream.status || navigatedRef.current || !autoAdvance) return;
    // Only act on a status polled from the run we are watching. Force re-run re-arms this
    // effect while the *previous* run's "passed" is still on screen, and without this guard
    // that stale value forwarded to the verdict page, which then bounced straight back here
    // because a run was in flight.
    if (stream.statusRunId !== runId) return;
    // Let people read the "Already verified" panel — don't whisk them away.
    if (stream.skipReason === REUSED_PASS) return;
    if (stream.status === "passed" || stream.status === "skipped") {
      navigatedRef.current = true;
      void router.invalidate().then(() => navigate({ to: "/repo/$repoId", params: { repoId } }));
    }
  }, [
    stream.status,
    stream.statusRunId,
    stream.skipReason,
    autoAdvance,
    runId,
    navigate,
    repo.full_name,
    repoId,
    router,
  ]);

  async function startAnalysis() {
    setStarting(true);
    setStartError(null);
    navigatedRef.current = false;
    try {
      await triggerScan({ data: { repoId } });
      setAutoAdvance(true);
      await scanJobQuery.refetch();
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Failed to start analysis");
    } finally {
      setStarting(false);
    }
  }

  const failed = stream.status === "failed" || stream.status === "timeout";
  const done = stream.status === "passed" || stream.status === "skipped";
  /** A prior result copied without spending another sandbox run. */
  const reusedFailure = stream.skipReason === REUSED_FAILURE;
  const reusedPass =
    stream.skipReason === REUSED_PASS ||
    // Older reuse rows may lack skipReason but still look empty — don't leave users
    // staring at a lone "queue wait" line thinking it errored.
    (done &&
      !failed &&
      stream.completedSteps.length === 0 &&
      stream.lines.length > 0 &&
      stream.lines.length <= 3 &&
      stream.lines.every((l) => /queue wait|already passed|Reused/i.test(l.message)));
  // Whichever step actually failed — we stop at the first non-zero exit, so it's the
  // last completed entry. "Build failed" was previously hardcoded here regardless of
  // which step broke, which was actively misleading when e.g. Install was the culprit.
  const failedStepLabel = (() => {
    const last = stream.completedSteps.at(-1);
    if (!last || last.exitCode === 0) return null;
    return STEP_LABEL[last.step] ?? last.step;
  })();

  async function copyLog() {
    const text = stream.lines.map((l) => l.message).join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <RepoLayout
      user={sessionUser}
      repoId={repoId}
      repoName={repo.name}
      fullWidth
      actions={
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-mono text-muted-foreground">{formatElapsed(stream.elapsedMs)}</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2">
              {stream.isStreaming && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  failed
                    ? "bg-foreground"
                    : done
                      ? "bg-primary"
                      : stream.isStreaming
                        ? "bg-primary"
                        : "bg-muted-foreground/40"
                }`}
              />
            </span>
            {failed
              ? "Failed"
              : waitingForScan
                ? "Waiting"
                : reusedPass
                  ? "Reused"
                  : done
                    ? "Done"
                    : stream.isStreaming
                      ? "Running"
                      : "Idle"}
          </span>
          {stream.lines.length > 0 && (
            <button
              type="button"
              onClick={() => void copyLog()}
              className="grid h-8 w-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Copy full log"
              title="Copy full log"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      }
    >
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
        <div className="min-h-0 overflow-hidden">
          {waitingForScan ? (
            <div className="app-terminal flex h-full items-center justify-center border-0 bg-[var(--app-terminal)] px-4 py-10 sm:px-8">
              <div className="w-full max-w-lg rounded-[5px] border border-border bg-card px-6 py-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-8">
                <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" aria-hidden />
                <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
                  Reading your repository
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  The sandbox starts automatically when the code scan finishes. Your previous build
                  is kept in history, but it is not part of this analysis.
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  No extra sandbox run is started from this page.
                </p>
              </div>
            </div>
          ) : reusedPass ? (
            <div className="app-terminal flex h-full items-center justify-center border-0 bg-[var(--app-terminal)] px-4 py-10 sm:px-8">
              <div className="w-full max-w-lg rounded-[5px] border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
                <div className="flex flex-col items-center border-b border-border px-6 py-8 text-center sm:px-8">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <ShieldCheck className="h-6 w-6 text-primary" aria-hidden />
                  </div>
                  <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
                    Already verified
                  </h2>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    Good news — this version of your code already passed. Nothing new to check, so
                    we skipped the rebuild.
                  </p>
                </div>

                <div className="space-y-0 divide-y divide-border px-6 sm:px-8">
                  <div className="flex items-start gap-3 py-3.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                    <div>
                      <p className="text-sm font-medium text-foreground">Same code as last time</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        No new commits since the last successful sandbox, so the result still
                        stands.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 py-3.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Fresh runs only when needed
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        A new commit, env var change, or build setting change automatically gets a
                        fresh verification on the next analysis.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border bg-muted/40 px-6 py-3 sm:px-8">
                  <p className="text-xs text-muted-foreground">
                    Otherwise you&apos;re all set — open the verdict to continue.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <TerminalWindow
              logs={stream.lines}
              liveLog={stream.liveLog}
              isStreaming={stream.isStreaming}
              plannedSteps={stream.plannedSteps}
              currentStep={stream.currentStep}
              completedSteps={stream.completedSteps}
              currentStepElapsedMs={stream.currentStepElapsedMs}
              className="h-full rounded-none border-0"
            />
          )}
        </div>

        {!waitingForScan && (failed || !runId || startError) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
            <div className="min-w-[14rem] flex-1">
              <p className="text-sm font-semibold text-foreground">
                {startError ??
                  (stream.status === "timeout" || stream.inconclusive === "budget_kill"
                    ? `${failedStepLabel ?? "The build"} ran out of time or memory.`
                    : stream.inconclusive === "flaky_infra"
                      ? "Couldn't reach the package registry."
                      : stream.status === "failed"
                        ? failedStepLabel
                          ? `${failedStepLabel} failed.`
                          : stream.errorMessage
                            ? stream.errorMessage
                            : "The build failed."
                        : "Start an analysis to verify this repository.")}
              </p>
              {/* Without this, the same failure reappearing instantly reads as a broken page. */}
              {reusedFailure && !startError && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Same result as last time — nothing changed in your code or settings, so we
                  didn&apos;t spend another sandbox run. Push a fix or update the build
                  configuration, then analyze again.
                </p>
              )}
              {/* Neither of these is a verdict on the repo, so don't let it read like one. */}
              {stream.inconclusive === "budget_kill" && !startError && (
                <p className="mt-1 text-xs text-muted-foreground">
                  This isn&apos;t a problem we found in your code — the build didn&apos;t finish
                  inside the configured time limit. A lighter build or a longer limit will get past
                  it.
                </p>
              )}
              {stream.inconclusive === "flaky_infra" && !startError && (
                <p className="mt-1 text-xs text-muted-foreground">
                  A network problem on the package registry, not your code. We didn&apos;t charge
                  this run — analyze again when you&apos;re ready.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/repo/$repoId/env"
                params={{ repoId }}
                search={{ intent: "launch" }}
                className="rounded-[5px] border border-border bg-surface px-3 py-1.5 text-sm hover:bg-muted"
              >
                Configure environment
              </Link>
              <button
                type="button"
                onClick={() => void startAnalysis()}
                disabled={starting}
                className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-[#00c990] disabled:opacity-60"
              >
                {starting ? "Starting…" : runId ? "Analyze again" : "Start analysis"}
              </button>
            </div>
          </div>
        )}

        {done && !failed && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-sm sm:px-6">
            <div className="min-w-[14rem] flex-1">
              <p className={reusedPass ? "text-muted-foreground" : "text-success"}>
                {reusedPass
                  ? "Nothing new to verify — using your last pass."
                  : autoAdvance
                    ? "Sandbox finished. Opening production verdict…"
                    : "Sandbox finished."}
              </p>
              {reusedPass && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Env var and build setting changes rebuild for real on their own.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/repo/$repoId"
                params={{ repoId }}
                className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground"
              >
                Open verdict
              </Link>
            </div>
          </div>
        )}
      </div>
    </RepoLayout>
  );
}
