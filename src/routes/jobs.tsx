import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/layouts/AppLayout";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getSessionUserFn } from "@/lib/api/session.functions";
import { getAllJobsFn } from "@/lib/api/github.functions";
import { FIX_DETAILS } from "@/lib/mock-data";
import { EmptyState } from "@/components/app/EmptyState";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  GitPullRequest,
  ExternalLink,
  Wrench,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import {
  DashboardPageHeader,
  FilterChip,
  Metric,
  MetricGrid,
  StatusPill,
} from "@/components/app/DashboardKit";

export const Route = createFileRoute("/jobs")({
  head: () => ({ meta: [{ title: "Fixes — LaunchReadyy" }] }),
  component: JobsPage,
  loader: () => getAllJobsFn(),
});

type StatusConfig = { label: string; icon: LucideIcon; color: string };

const STATUS_CONFIG: Record<string, StatusConfig> = {
  completed: { label: "Completed", icon: CheckCircle2, color: "var(--success)" },
  failed: { label: "Failed", icon: XCircle, color: "var(--critical)" },
  running: { label: "Running", icon: Clock, color: "var(--data)" },
  pending: { label: "Pending", icon: Clock, color: "var(--warning)" },
  awaiting_review: { label: "Awaiting review", icon: Clock, color: "var(--data)" },
  pr_open: { label: "PR open", icon: GitPullRequest, color: "var(--data)" },
  cancelled: { label: "Cancelled", icon: Ban, color: "#8A8F98" },
};

const ACTIVE_STATUSES = ["running", "pending", "pr_open", "awaiting_review"];

type Filter = "all" | "active" | "completed" | "failed";

function JobsPage() {
  const jobs = Route.useLoaderData();
  const [filter, setFilter] = useState<Filter>("all");
  const { data: sessionUser } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: Infinity,
  });

  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const active = jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)).length;

  const visible = jobs.filter((j) => {
    if (filter === "all") return true;
    if (filter === "active") return ACTIVE_STATUSES.includes(j.status);
    return j.status === filter;
  });

  const filters: Array<{ id: Filter; label: string; count: number }> = [
    { id: "all", label: "All", count: jobs.length },
    { id: "active", label: "In progress", count: active },
    { id: "completed", label: "Completed", count: completed },
    { id: "failed", label: "Failed", count: failed },
  ];

  return (
    <AppLayout user={sessionUser} breadcrumbs={[{ label: "Fixes" }]}>
      <DashboardPageHeader
        eyebrow="Ship"
        title="Fixes"
        description="Every Fix PR Launch Readyy has prepared or opened for you, newest first."
      />

      {jobs.length === 0 ? (
        <EmptyFixes />
      ) : (
        <>
          <MetricGrid className="mt-5 sm:grid-cols-3 xl:grid-cols-3">
            <Metric label="Completed" value={completed} icon={CheckCircle2} tone="success" />
            <Metric label="In progress" value={active} icon={Clock} tone="data" />
            <Metric label="Failed" value={failed} icon={XCircle} tone="critical" />
          </MetricGrid>

          <div className="mt-5 flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <FilterChip
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                active={filter === f.id}
              >
                {f.label}
                <span className="ml-1.5 tabular-nums opacity-70">{f.count}</span>
              </FilterChip>
            ))}
          </div>

          <div className="mt-3 space-y-2">
            {visible.length === 0 ? (
              <p className="rounded-3xl border border-dashed border-border bg-surface/60 px-4 py-10 text-center text-sm text-muted-foreground">
                No fixes with this status.
              </p>
            ) : (
              visible.map((job) => <JobRow key={job.id} job={job} />)
            )}
          </div>
        </>
      )}
    </AppLayout>
  );
}

function StatTile({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-[5px] border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

type Job = ReturnType<typeof Route.useLoaderData>[number];

function JobRow({ job }: { job: Job }) {
  const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.cancelled;
  const Icon = cfg.icon;
  const fixIds: string[] = Array.isArray(job.fixes) ? job.fixes : [];

  return (
    <div className="app-panel rounded-2xl p-4 transition hover:border-data/40">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[5px]"
          style={{ backgroundColor: `${cfg.color}1f`, color: cfg.color }}
        >
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              to="/repo/$repoId"
              params={{ repoId: job.repoId }}
              className="min-w-0 truncate font-mono text-sm text-foreground hover:text-data"
            >
              {job.repoFullName}
            </Link>
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: `${cfg.color}1f`, color: cfg.color }}
            >
              {cfg.label}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{job.createdAt}</span>
          </div>

          {fixIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {fixIds.slice(0, 4).map((id) => (
                <span
                  key={id}
                  className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {FIX_DETAILS[id]?.label ?? id}
                </span>
              ))}
              {fixIds.length > 4 && (
                <span className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  +{fixIds.length - 4} more
                </span>
              )}
            </div>
          )}

          {job.errorMessage && (
            <p className="mt-2 truncate border-l-2 border-foreground pl-2 font-mono text-[11px] font-medium text-foreground">
              {job.errorMessage}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {job.prUrl && (
              <a
                href={job.prUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-data hover:bg-muted"
              >
                <GitPullRequest className="h-3 w-3" />
                PR #{job.prNumber}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            {job.status === "cancelled" ? (
              <Link
                to="/repo/$repoId"
                params={{ repoId: job.repoId }}
                className="inline-flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Analysis
              </Link>
            ) : (
              <Link
                to="/repo/$repoId/job/$jobId"
                params={{ repoId: job.repoId, jobId: job.id }}
                search={{ from: "jobs" }}
                className="inline-flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Details
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Nothing here until a Fix PR is requested — say so, and show the path to one. */
function EmptyFixes() {
  return (
    <div className="mt-5">
      <EmptyState
        icon={Wrench}
        title="No Fix PRs yet"
        body="This page fills up once LaunchReadyy opens a pull request for you. Nothing has been requested so far."
        steps={[
          "Open a repository and run a sandbox build, so the score is backed by a real build.",
          "Go to Blockers and pick what you want fixed.",
          "Hit Fix PR — LaunchReadyy writes the patch and opens a pull request.",
        ]}
        action={{ label: "Choose a repository", to: "/repos" }}
      />
    </div>
  );
}
