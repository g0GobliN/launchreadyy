import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { RepoNotFound } from "@/components/app/RepoNotFound";
import { RepoLayout } from "@/components/layouts/RepoLayout";
import { DashboardPageHeader, dashboardPrimaryAction } from "@/components/app/DashboardKit";
import { EmptyState } from "@/components/app/EmptyState";
import { ListPagination } from "@/components/app/ListPagination";
import { AuthErrorScreen } from "@/components/auth-error-screen";
import { getRepoFn } from "@/lib/api/db.functions";
import { getSandboxVerifyRunDetailFn, listSandboxVerifyRunsFn } from "@/lib/api/sandbox.functions";
import { getSessionUserFn } from "@/lib/api/session.functions";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  ArrowLeft,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Copy,
  History,
  Search,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";

const STEP_LABEL: Record<string, string> = {
  clone: "Clone",
  install: "Install",
  build: "Build",
  lint: "Lint",
  test: "Test",
  security: "Security",
};

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  passed: { label: "Passed", className: "text-success" },
  failed: { label: "Failed", className: "text-critical" },
  timeout: { label: "Timed out", className: "text-critical" },
  skipped: { label: "Skipped", className: "text-muted-foreground" },
  running: { label: "Running", className: "text-primary" },
  queued: { label: "Queued", className: "text-muted-foreground" },
};

const PAGE_SIZE = 20;

const STATUS_TABS = [
  { key: "all", label: "All runs" },
  { key: "failed", label: "Failed" },
  { key: "passed", label: "Passed" },
  { key: "skipped", label: "Skipped" },
] as const;

type StatusFilter = (typeof STATUS_TABS)[number]["key"];

/** Shared by the column titles and every row so the two can never drift apart. */
const ROW_GRID = "sm:grid-cols-[10rem_minmax(0,1fr)_5rem_5.5rem_9.5rem_1rem]";

export const Route = createFileRoute("/repo/$repoId/runs")({
  head: () => ({ meta: [{ title: "Build history — LaunchReadyy" }] }),
  validateSearch: z.object({
    page: z.coerce.number().int().min(1).default(1),
    status: z.enum(["all", "failed", "passed", "skipped"]).default("all"),
    q: z.string().trim().max(200).optional(),
  }),
  loaderDeps: ({ search: { page, status, q } }) => ({ page, status, q }),
  notFoundComponent: () => <RepoNotFound reason="repo" />,
  errorComponent: ({ error }) => <AuthErrorScreen error={error} />,
  loader: async ({ params, deps }) => {
    const empty = {
      runs: [] as RunSummary[],
      counts: { all: 0, passed: 0, failed: 0, skipped: 0 },
      total: 0,
      page: deps.page,
      pageSize: PAGE_SIZE,
    };
    const [repo, list] = await Promise.all([
      getRepoFn({ data: { repoId: params.repoId } }),
      listSandboxVerifyRunsFn({
        data: {
          repoId: params.repoId,
          page: deps.page,
          pageSize: PAGE_SIZE,
          status: deps.status,
          q: deps.q,
          includeCounts: true,
        },
      }).catch(() => empty),
    ]);
    if (!repo) throw notFound();
    return { repo, ...list };
  },
  component: SandboxRunsPage,
});

type RunSummary = Awaited<ReturnType<typeof listSandboxVerifyRunsFn>>["runs"][number];
type RunDetail = Awaited<ReturnType<typeof getSandboxVerifyRunDetailFn>>;

function SandboxRunsPage() {
  const { repoId } = Route.useParams();
  const { repo, runs, counts, total, page, pageSize } = Route.useLoaderData();
  const { data: sessionUser } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: Infinity,
  });

  return (
    <RepoLayout user={sessionUser} repoId={repoId} repoName={repo.name}>
      <HistoryTab
        runs={runs}
        counts={counts}
        total={total}
        page={page}
        pageSize={pageSize}
        repoId={repoId}
      />
    </RepoLayout>
  );
}

function HistoryTab({
  runs,
  counts,
  total,
  page,
  pageSize,
  repoId,
}: {
  runs: RunSummary[];
  counts: { all: number; passed: number; failed: number; skipped: number };
  total: number;
  page: number;
  pageSize: number;
  repoId: string;
}) {
  const navigate = useNavigate({ from: "/repo/$repoId/runs" });
  const { status: statusFilter, q } = Route.useSearch();
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryText, setQueryText] = useState(q ?? "");

  /** Any filter change resets to page 1 — page 3 of an unfiltered list is empty once filtered. */
  function setFilter(next: { status?: StatusFilter; q?: string }) {
    void navigate({
      search: (prev) => ({
        ...prev,
        ...(next.status ? { status: next.status } : {}),
        ...(next.q !== undefined ? { q: next.q || undefined } : {}),
        page: 1,
      }),
    });
  }

  const lastRun = runs.length > 0 && statusFilter === "all" && !q ? (runs[0] ?? null) : null;

  async function openRun(runId: string) {
    setSelected(runId);
    setLoading(true);
    setDetail(null);
    try {
      const d = await getSandboxVerifyRunDetailFn({ data: { runId } });
      setDetail(d);
    } finally {
      setLoading(false);
    }
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to run history
        </button>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {detail && <RunDetailView detail={detail} />}
      </div>
    );
  }

  // Never ran anything vs. filtered down to nothing are different problems with different
  // fixes — one needs a first build, the other needs the filter cleared.
  const neverRan = counts.all === 0;

  return (
    <div className="space-y-4">
      <DashboardPageHeader
        eyebrow="Verify · Activity"
        title="Build history"
        description="Every sandbox verification run for this repository, most recent first."
        className="mb-5"
        actions={
          !neverRan ? (
            <Link to="/repo/$repoId/sandbox" params={{ repoId }} className={dashboardPrimaryAction}>
              <Play className="h-3.5 w-3.5" />
              Run a build
            </Link>
          ) : null
        }
      />

      {neverRan ? (
        <EmptyState
          icon={History}
          title="No builds yet"
          body="Build history is every real install and build we ran for this repo. Nothing has been run yet."
          steps={[
            "Add any secrets the install needs on Build & environment.",
            "Open Sandbox build and hit Launch sandbox.",
            "Install, Build and Lint stream live — the finished run is saved here.",
          ]}
          action={{
            label: "Go to Sandbox build",
            to: "/repo/$repoId/sandbox",
            params: { repoId },
          }}
        />
      ) : (
        <>
          <RunSummaryCards counts={counts} lastRun={lastRun} />

          <section className="rounded-[5px] border border-border bg-card">
            {/* items-end, so the active tab's underline lands on the container's bottom border. */}
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-3 border-b border-border px-3 py-2">
              <div className="flex flex-wrap items-end gap-1">
                {STATUS_TABS.map((tab) => {
                  const active = statusFilter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setFilter({ status: tab.key })}
                      /* -mb-2 drops the underline onto the container's own bottom border so the
                         two read as one line, the way the reference mockup does it. */
                      className={`-mb-2 border-b-2 px-2.5 pb-2.5 pt-1.5 text-sm transition ${
                        active
                          ? "border-primary font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                      <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                        {counts[tab.key]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setFilter({ q: queryText });
                  }}
                  onBlur={() => setFilter({ q: queryText })}
                  placeholder="Search commit, branch, error…"
                  className="w-full min-w-[13rem] rounded-[5px] border border-border bg-surface py-1.5 pl-8 pr-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {runs.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No runs match this filter.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setQueryText("");
                    setFilter({ status: "all", q: "" });
                  }}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Show all runs
                </button>
              </p>
            ) : (
              <>
                {/* Column titles only earn their space once the row is a real grid, which it
                    is from sm up — below that the row stacks and the labels would lie. */}
                <div
                  className={`hidden border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground sm:grid ${ROW_GRID}`}
                >
                  <span>Status</span>
                  <span>Result</span>
                  <span>Commit</span>
                  <span className="text-right">Duration</span>
                  <span className="text-right">Started</span>
                  <span />
                </div>
                <div className="divide-y divide-border">
                  {runs.map((r) => {
                    const status = STATUS_COPY[r.status] ?? STATUS_COPY.queued!;
                    const durationMs =
                      r.startedAt && r.finishedAt
                        ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()
                        : null;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => void openRun(r.id)}
                        className={`flex w-full flex-col gap-1 px-4 py-3 text-left text-sm hover:bg-muted/50 sm:grid sm:items-center sm:gap-x-3 sm:gap-y-0 ${ROW_GRID}`}
                      >
                        <span className="flex items-center gap-2">
                          <StatusIcon status={r.status} />
                          <span className={`font-medium ${status.className}`}>{status.label}</span>
                          {r.reused && (
                            <span className="rounded-[4px] border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              Reused
                            </span>
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {describeRun(r)}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {r.gitSha ? r.gitSha.slice(0, 7) : "—"}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground sm:text-right">
                          {durationMs !== null ? formatDuration(durationMs) : "—"}
                        </span>
                        <span className="text-xs text-muted-foreground sm:text-right">
                          {formatRunTime(r.createdAt)}
                        </span>
                        <ChevronRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </>
      )}
      {total > pageSize && (
        <ListPagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(p) => navigate({ search: (prev) => ({ ...prev, page: p }) })}
        />
      )}
    </div>
  );
}

/** Seconds under a minute, m/s above — "184.0s" makes people do arithmetic. */
function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** "Aug 13, 9:24 AM" — with the year only when it isn't this one, so old runs stay unambiguous. */
function formatRunTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The one-line "what happened" under each row. */
function describeRun(run: RunSummary) {
  if (run.reused) return "Reused an earlier pass for this commit — no build was run.";
  if (run.failedStep) {
    const label = STEP_LABEL[run.failedStep] ?? run.failedStep;
    return run.errorMessage ? `${label} failed — ${run.errorMessage}` : `${label} failed.`;
  }
  if (run.errorMessage) return run.errorMessage;

  const parts: string[] = [];
  if (run.stepsTotal > 0) parts.push(`${run.stepsPassed}/${run.stepsTotal} steps passed`);
  if (run.branchName) parts.push(run.branchName);
  if (run.packageManager) parts.push(run.packageManager);
  return parts.length > 0 ? parts.join(" · ") : "No step detail recorded.";
}

function RunSummaryCards({
  counts,
  lastRun,
}: {
  counts: { all: number; passed: number; failed: number; skipped: number };
  lastRun: RunSummary | null;
}) {
  // Reused rows are real history but not real builds — excluding them would need a second
  // count query, so the rate is over every run, matching the tab counts above it.
  const rate = counts.all > 0 ? Math.round((counts.passed / counts.all) * 100) : 0;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-[5px] border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Total runs
        </p>
        <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{counts.all}</p>
      </div>
      <div className="rounded-[5px] border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Pass rate
        </p>
        <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{rate}%</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {counts.passed} passed · {counts.failed} failed
        </p>
      </div>
      <div className="rounded-[5px] border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Last run
        </p>
        {lastRun ? (
          <>
            <p
              className={`mt-1.5 text-2xl font-semibold ${(STATUS_COPY[lastRun.status] ?? STATUS_COPY.queued!).className}`}
            >
              {(STATUS_COPY[lastRun.status] ?? STATUS_COPY.queued!).label}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatRunTime(lastRun.createdAt)}
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-sm text-muted-foreground">Clear filters to see the latest.</p>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "passed") return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />;
  if (status === "failed" || status === "timeout")
    return <XCircle className="h-4 w-4 shrink-0 text-critical" />;
  if (status === "running")
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />;
  return <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground/50" />;
}

function RunDetailView({ detail }: { detail: RunDetail }) {
  const [copied, setCopied] = useState(false);
  const steps = detail.plannedSteps.length > 0 ? detail.plannedSteps : detail.completedSteps;

  async function copyLog() {
    const text = [detail.errorMessage, detail.rawLog].filter(Boolean).join("\n\n");
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[5px] border border-border bg-card p-4 sm:p-6">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Build log
        </h3>
        <div className="flex flex-wrap gap-2">
          {steps.map((s) => {
            const completed = detail.completedSteps.find((c) => c.step === s.step);
            const failed = completed && completed.exitCode !== 0;
            return (
              <span
                key={s.step}
                className={`inline-flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1.5 text-xs ${
                  failed
                    ? "border-critical/40 bg-critical/10 text-critical"
                    : completed
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-border text-muted-foreground"
                }`}
              >
                {completed ? (
                  failed ? (
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  )
                ) : (
                  <Box className="h-3.5 w-3.5 shrink-0 opacity-80" />
                )}
                <span>{STEP_LABEL[s.step] ?? s.step}</span>
                {completed && (
                  <span className="tabular-nums text-muted-foreground">
                    {(completed.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </span>
            );
          })}
          {steps.length === 0 && (
            <p className="text-sm text-muted-foreground">No step data recorded for this run.</p>
          )}
        </div>
        {detail.errorMessage && (
          <div className="mt-3 flex items-start justify-between gap-2 rounded-[5px] border border-destructive/40 bg-destructive/10 px-3 py-2">
            <p className="text-sm text-destructive">{detail.errorMessage}</p>
            {!detail.rawLog && (
              <button
                type="button"
                onClick={() => void copyLog()}
                className="inline-flex shrink-0 items-center gap-1 rounded-[5px] px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        )}
      </section>

      {detail.rawLog && (
        <section className="rounded-[5px] border border-border bg-card p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Log output
            </h3>
            <button
              type="button"
              onClick={() => void copyLog()}
              className="inline-flex items-center gap-1.5 rounded-[5px] border border-border bg-surface px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy log"}
            </button>
          </div>
          <pre className="max-h-96 overflow-auto rounded-[5px] bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground">
            {detail.rawLog}
          </pre>
        </section>
      )}
    </div>
  );
}
