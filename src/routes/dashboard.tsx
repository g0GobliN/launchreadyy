import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { AppLayout } from "@/components/layouts/AppLayout";
import { EmptyState } from "@/components/app/EmptyState";
import { loadDashboardFn } from "@/lib/api/github.functions";
import {
  GithubIcon,
  BarChart3,
  GitBranch,
  AlertTriangle,
  Wrench,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  ListChecks,
  ScanSearch,
  Rocket,
} from "lucide-react";
import {
  DashboardPageHeader,
  DashboardPanel,
  dashboardPrimaryAction,
} from "@/components/app/DashboardKit";
import { useState, useEffect } from "react";
import { z } from "zod";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const dashboardSearchSchema = z.object({
  error: z.string().optional(),
});

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — LaunchReadyy" }] }),
  validateSearch: dashboardSearchSchema,
  loader: () => loadDashboardFn(),
  component: Dashboard,
});

function Dashboard() {
  const { user, recentScans, scanHistory, recentJobs, tokenExpired } = Route.useLoaderData();

  const { error } = Route.useSearch();
  if (!user) return <ConnectPage />;
  return (
    <DashboardHome
      user={user}
      recentScans={recentScans}
      scanHistory={scanHistory ?? []}
      recentJobs={recentJobs ?? []}
      tokenExpired={tokenExpired ?? false}
    />
  );
}

function ConnectPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto flex max-w-lg flex-col items-center px-6 pt-32 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-xl border border-border bg-card">
          <GithubIcon className="h-7 w-7 text-primary" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-semibold">Set your GitHub token</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          LaunchReadyy uses your own GitHub personal access token — no OAuth, no account here. Run{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">launchreadyy setup</code>, or add{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">GITHUB_TOKEN</code> to your{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">.env</code> and restart the app.
        </p>
        <a
          href="https://github.com/settings/tokens"
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground glow-primary hover:opacity-90"
        >
          <GithubIcon className="h-4 w-4" /> Create a token on GitHub
        </a>
        <p className="mt-4 text-xs text-muted-foreground">
          Scopes needed: <code className="rounded bg-muted px-1 py-0.5">read:user</code>{" "}
          <code className="rounded bg-muted px-1 py-0.5">repo</code>{" "}
          <code className="rounded bg-muted px-1 py-0.5">workflow</code>
        </p>
      </div>
    </div>
  );
}

type ScanSummary = {
  repo: string;
  repoId: string;
  score: number;
  when: string;
  blockers: number;
  checklistPassed: number;
  checklistTotal: number;
};

type ScanHistoryPoint = {
  score: number;
  when: string;
  repo: string;
  blockers: number;
  checklistPct: number | null;
};

function scoreFill(score: number) {
  if (score >= 80) return "var(--success)";
  if (score >= 60) return "var(--warning)";
  return "var(--critical)";
}

function Sparkline({ data }: { data: ScanHistoryPoint[] }) {
  if (data.length < 2) return null;
  return (
    <div className="mt-1 h-8 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--data)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--data)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="score"
            stroke="var(--data)"
            strokeWidth={1.5}
            fill="url(#sparkFill)"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function metricChartData(scanHistory: ScanHistoryPoint[]) {
  return scanHistory.map((s) => ({
    date: new Date(s.when).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    score: s.score,
    blockers: s.blockers,
    checklistPct: s.checklistPct,
    repo: s.repo.split("/")[1] ?? s.repo,
  }));
}

function MetricTrendChart({
  scanHistory,
  dataKey,
  color,
  domain,
  unit,
  gradientId,
}: {
  scanHistory: ScanHistoryPoint[];
  dataKey: "score" | "blockers" | "checklistPct";
  color: string;
  domain: [number, number | "auto"];
  unit: string;
  gradientId: string;
}) {
  const data = metricChartData(scanHistory).filter((d) => d[dataKey] != null);

  return (
    <div className="h-44 sm:h-48">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            domain={domain}
            allowDecimals={false}
            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-border)" }}
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 5,
              fontSize: 12,
            }}
            itemStyle={{ color: "var(--color-card-foreground)" }}
            labelStyle={{ color: "var(--color-muted-foreground)" }}
            formatter={(value: number, _name, item) => [
              `${value}${unit}`,
              item?.payload?.repo ?? dataKey,
            ]}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ReadinessByProject({ scans }: { scans: ScanSummary[] }) {
  const rows = [...scans].sort((a, b) => a.score - b.score).slice(0, 6);

  if (rows.length === 0) {
    return <p className="mt-3 text-xs text-muted-foreground">No scanned projects yet.</p>;
  }

  return (
    <div className="mt-3 space-y-2.5">
      {rows.map((s) => (
        <Link
          key={s.repoId}
          to="/repo/$repoId"
          params={{ repoId: s.repoId }}
          className="group block"
        >
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-medium text-foreground group-hover:text-data">
              {s.repo.split("/")[1] ?? s.repo}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {s.blockers > 0 && (
                <span className="text-critical">
                  {s.blockers} blocker{s.blockers > 1 ? "s" : ""} ·{" "}
                </span>
              )}
              <span className="font-semibold text-foreground">{s.score}</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(2, s.score)}%`, backgroundColor: scoreFill(s.score) }}
            />
          </div>
        </Link>
      ))}
    </div>
  );
}

type CalendarDay = { date: Date; count: number; scans: ScanHistoryPoint[] };

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function buildCalendarWeeks(scanHistory: ScanHistoryPoint[], weeks: number): CalendarDay[][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - start.getDay()); // back up to the preceding Sunday

  const byDay = new Map<string, ScanHistoryPoint[]>();
  for (const s of scanHistory) {
    const key = dayKey(new Date(s.when));
    const bucket = byDay.get(key);
    if (bucket) bucket.push(s);
    else byDay.set(key, [s]);
  }

  const days: CalendarDay[] = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    const scans = byDay.get(dayKey(cursor)) ?? [];
    days.push({ date: new Date(cursor), count: scans.length, scans });
    cursor.setDate(cursor.getDate() + 1);
  }

  const weekCols: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weekCols.push(days.slice(i, i + 7));
  return weekCols;
}

function activityLevel(count: number) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

const HEATMAP_LEVEL_COLOR: Record<number, string> = {
  0: "var(--color-muted)",
  1: "color-mix(in oklab, var(--data) 30%, transparent)",
  2: "color-mix(in oklab, var(--data) 55%, transparent)",
  3: "color-mix(in oklab, var(--data) 80%, transparent)",
  4: "var(--data)",
};

const WEEKDAY_LABELS = ["", "M", "", "W", "", "F", ""];

function activityStats(days: CalendarDay[]) {
  const byMonth = new Map<string, { count: number; date: Date }>();
  let mostActiveDay: CalendarDay | null = null;

  for (const d of days) {
    const monthKey = `${d.date.getFullYear()}-${d.date.getMonth()}`;
    const entry = byMonth.get(monthKey);
    if (entry) entry.count += d.count;
    else byMonth.set(monthKey, { count: d.count, date: d.date });

    if (d.count > 0 && (!mostActiveDay || d.count >= mostActiveDay.count)) mostActiveDay = d;
  }

  let mostActiveMonth: Date | null = null;
  let mostActiveMonthCount = 0;
  for (const entry of byMonth.values()) {
    if (entry.count > mostActiveMonthCount) {
      mostActiveMonthCount = entry.count;
      mostActiveMonth = entry.date;
    }
  }

  let longestStreak = 0;
  let running = 0;
  for (const d of days) {
    running = d.count > 0 ? running + 1 : 0;
    longestStreak = Math.max(longestStreak, running);
  }

  let currentStreak = 0;
  for (let i = days.length - 1; i >= 0 && days[i].count > 0; i--) currentStreak++;

  return { mostActiveMonth, mostActiveDay, longestStreak, currentStreak };
}

function HeatmapTooltip({ day }: { day: CalendarDay }) {
  const dateLabel = day.date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (day.count === 0) {
    return (
      <div className="pointer-events-none w-max max-w-[240px] rounded-[5px] border border-border bg-card px-2.5 py-2 shadow-lg">
        <p className="text-xs font-medium text-foreground">{dateLabel}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">No scans</p>
      </div>
    );
  }

  const avgScore = Math.round(day.scans.reduce((s, x) => s + x.score, 0) / day.scans.length);
  const blockers = day.scans.reduce((s, x) => s + x.blockers, 0);
  const repos = [...new Set(day.scans.map((s) => s.repo.split("/")[1] ?? s.repo))];

  return (
    <div className="pointer-events-none w-max max-w-[240px] rounded-[5px] border border-border bg-card px-2.5 py-2 shadow-lg">
      <p className="text-xs font-medium text-foreground">{dateLabel}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {day.count} scan{day.count === 1 ? "" : "s"} · avg {avgScore}/100
      </p>
      {blockers > 0 && (
        <p className="mt-0.5 text-xs font-semibold text-critical">
          {blockers} blocker{blockers === 1 ? "" : "s"}
        </p>
      )}
      <p className="mt-1 truncate text-[11px] text-muted-foreground">
        {repos.slice(0, 3).join(", ")}
        {repos.length > 3 ? ` +${repos.length - 3}` : ""}
      </p>
    </div>
  );
}

function ScanActivityHeatmap({ scanHistory }: { scanHistory: ScanHistoryPoint[] }) {
  const isMobile = useIsMobile();
  const weeks = isMobile ? 16 : 52;
  const weekCols = buildCalendarWeeks(scanHistory, weeks);
  const days = weekCols.flat();
  const totalInWindow = days.reduce((sum, d) => sum + d.count, 0);
  const stats = activityStats(days);
  const [hovered, setHovered] = useState<{ day: CalendarDay; x: number; y: number } | null>(null);

  // A single-letter label is exactly as wide as one column, so it never
  // collides with its neighbor the way "Jul" / "Aug" would.
  const monthLabels = weekCols.map((week, i) => {
    const first = week[0].date;
    const prevFirst = i > 0 ? weekCols[i - 1][0].date : null;
    const show = i === 0 || (prevFirst != null && first.getMonth() !== prevFirst.getMonth());
    return show ? first.toLocaleDateString(undefined, { month: "short" })[0] : null;
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Activity</h2>
          <p className="text-xs text-muted-foreground">
            {isMobile ? "Last ~4 months" : "Repos analyzed, per day"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">
            {isMobile ? "Scans run" : "Scans run in the last year"}
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground sm:text-2xl">
            {totalInWindow.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {/* Columns are flex-1, so the cap is what keeps cells from stretching
            chunky on a wide card. Below it the grid stays fluid. */}
        <div className="mx-auto flex w-full max-w-[60rem] flex-col gap-1">
          <div className="flex gap-[3px] pl-5 sm:pl-6">
            {monthLabels.map((label, i) => (
              <div
                key={i}
                className="min-w-0 flex-1 text-[10px] font-semibold text-muted-foreground"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            <div className="flex w-4 shrink-0 flex-col gap-[3px] pr-1 sm:w-5">
              {WEEKDAY_LABELS.map((label, i) => (
                <span
                  key={i}
                  // flex-1 rather than a fixed height, so each label tracks its
                  // row as the cells resize with the container.
                  className="flex w-4 flex-1 items-center text-[10px] font-semibold leading-none text-muted-foreground sm:w-5"
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 gap-[3px]">
              {weekCols.map((week, wi) => (
                <div key={wi} className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  {week.map((day, di) => (
                    <div
                      key={di}
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setHovered({ day, x: r.left + r.width / 2, y: r.top });
                      }}
                      onMouseLeave={() => setHovered(null)}
                      className="aspect-square w-full rounded-[2px] hover:outline hover:outline-1 hover:outline-offset-1 hover:outline-primary"
                      style={{ backgroundColor: HEATMAP_LEVEL_COLOR[activityLevel(day.count)] }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:flex sm:flex-wrap sm:gap-x-10 sm:gap-y-3">
        <div>
          <p className="text-xs text-muted-foreground">Most Active Month</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {stats.mostActiveMonth
              ? stats.mostActiveMonth.toLocaleDateString(undefined, { month: "long" })
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Most Active Day</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {stats.mostActiveDay
              ? stats.mostActiveDay.date.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Longest Streak</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{stats.longestStreak}d</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Current Streak</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{stats.currentStreak}d</p>
        </div>

        <div className="col-span-2 flex items-center justify-end gap-1 text-xs text-muted-foreground sm:ml-auto sm:self-end">
          <span>Fewer</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className="h-[11px] w-[11px] rounded-[2px]"
              style={{ backgroundColor: HEATMAP_LEVEL_COLOR[level] }}
            />
          ))}
          <span>More</span>
        </div>
      </div>

      {hovered && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full pb-2"
          style={{ left: hovered.x, top: hovered.y }}
        >
          <HeatmapTooltip day={hovered.day} />
        </div>
      )}
    </div>
  );
}

function PipelineDiagram({
  reposScanned,
  totalBlockers,
  fixesShipped,
  avgScore,
  avgChecklist,
  scanHistory,
}: {
  reposScanned: number;
  totalBlockers: number;
  fixesShipped: number;
  avgScore: number | null;
  avgChecklist: number | null;
  scanHistory: ScanHistoryPoint[];
}) {
  const nodes = [
    { icon: GitBranch, label: "Repos scanned", value: reposScanned, sparkline: false },
    { icon: AlertTriangle, label: "Issues found", value: totalBlockers, sparkline: false },
    {
      icon: ListChecks,
      label: "Checklist passed",
      value: avgChecklist != null ? `${avgChecklist}%` : "—",
      sparkline: false,
    },
    { icon: Wrench, label: "Fixes shipped", value: fixesShipped, sparkline: false },
    {
      icon: ShieldCheck,
      label: "Avg readiness",
      value: avgScore != null ? avgScore : "—",
      sparkline: true,
    },
  ];
  return (
    <div className="app-panel mt-5 rounded-2xl p-3 sm:p-4">
      {/* Mobile / tablet: compact grid — no horizontal pipeline scroll */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:hidden">
        {nodes.map((n) => {
          const Icon = n.icon;
          return (
            <div
              key={n.label}
              className="flex flex-col justify-center rounded-xl border border-hairline bg-surface px-3 py-3"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Icon className="h-3.5 w-3.5 shrink-0 text-data" />
                <span className="truncate">{n.label}</span>
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-foreground sm:text-xl">
                {n.value}
              </div>
              {n.sparkline && <Sparkline data={scanHistory} />}
            </div>
          );
        })}
      </div>

      {/* Desktop: pipeline with arrows */}
      <div className="hidden items-stretch gap-2 overflow-x-auto lg:flex">
        {nodes.map((n, i) => {
          const Icon = n.icon;
          return (
            <div key={n.label} className="flex min-w-0 flex-1 items-stretch gap-2">
              <div className="flex min-w-0 flex-1 flex-col justify-center rounded-xl border border-hairline bg-surface px-3 py-3">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-data" />
                  <span className="truncate">{n.label}</span>
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                  {n.value}
                </div>
                {n.sparkline && <Sparkline data={scanHistory} />}
              </div>
              {i < nodes.length - 1 && (
                <div className="flex shrink-0 items-center text-border">
                  <ArrowRight className="h-4 w-4" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DashboardHome({
  user,
  recentScans,
  scanHistory,
  recentJobs,
  tokenExpired,
}: {
  user: { login: string; avatarUrl: string };
  recentScans: ScanSummary[];
  scanHistory: ScanHistoryPoint[];
  recentJobs: Array<{ status: string }>;
  tokenExpired: boolean;
}) {
  const avgScore =
    recentScans.length > 0
      ? Math.round(recentScans.reduce((s, r) => s + r.score, 0) / recentScans.length)
      : null;
  const totalBlockers = recentScans.reduce((s, r) => s + r.blockers, 0);
  const lowestRepo =
    recentScans.length > 0 ? [...recentScans].sort((a, b) => a.score - b.score)[0] : null;
  const fixesShipped = recentJobs.filter((j) => j.status === "completed").length;
  const checklistPcts = scanHistory
    .map((s) => s.checklistPct)
    .filter((p): p is number => p != null);
  const avgChecklist =
    checklistPcts.length > 0
      ? Math.round(checklistPcts.reduce((s, p) => s + p, 0) / checklistPcts.length)
      : null;
  return (
    <AppLayout user={user} breadcrumbs={[{ label: "Dashboard" }]}>
      {tokenExpired && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            Your GitHub connection expired. Reconnect to load repositories and run scans.
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-4 py-2 text-xs font-semibold text-primary">
            Update GITHUB_TOKEN in .env, then restart
          </span>
        </div>
      )}

      <DashboardPageHeader
        eyebrow="Production readiness"
        title={<>Welcome back, @{user.login}</>}
        description="See what is ready to ship, what is blocked, and where your next fix will have the most impact."
        actions={
          <Link to="/repos" className={dashboardPrimaryAction}>
            <Rocket className="h-4 w-4" /> Scan repository
          </Link>
        }
      />

      {recentScans.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={ScanSearch}
            title="Nothing scanned yet"
            body="Your dashboard fills in after the first scan — readiness score, blockers, and activity. Right now there is nothing to show."
            steps={[
              "Connect a repository from Repositories.",
              "We run install and build in a real sandbox, so the score is proof, not a guess.",
              "You get a readiness score, the blockers behind it, and a one-click Fix PR.",
            ]}
            action={{ label: "Choose a repository", to: "/repos" }}
            secondary="Install and build verification runs in a real sandbox — the score is proof, not a guess."
          />
        </div>
      ) : (
        <PipelineDiagram
          reposScanned={recentScans.length}
          totalBlockers={totalBlockers}
          fixesShipped={fixesShipped}
          avgScore={avgScore}
          avgChecklist={avgChecklist}
          scanHistory={scanHistory}
        />
      )}

      {scanHistory.length >= 2 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <DashboardPanel className="lg:col-span-2">
            <ScanActivityHeatmap scanHistory={scanHistory} />
          </DashboardPanel>
          <DashboardPanel>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Readiness by project</h2>
                <p className="text-xs text-muted-foreground">Lowest score first — fix these next</p>
              </div>
              <Link to="/repos" className="shrink-0 text-xs text-data hover:underline">
                All repos
              </Link>
            </div>
            <ReadinessByProject scans={recentScans} />
          </DashboardPanel>
          <DashboardPanel>
            <h2 className="text-sm font-semibold text-foreground">Checklist completion</h2>
            <p className="text-xs text-muted-foreground">% of applicable checks passed</p>
            <MetricTrendChart
              scanHistory={scanHistory}
              dataKey="checklistPct"
              color="var(--data)"
              domain={[0, 100]}
              unit="%"
              gradientId="fillChecklist"
            />
          </DashboardPanel>
        </div>
      )}

      {recentScans.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Recent projects</h2>
            <Link to="/repos" className="text-xs text-data hover:underline">
              View all
            </Link>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentScans.slice(0, 6).map((s) => (
              <Link
                key={s.repoId}
                to="/repo/$repoId"
                params={{ repoId: s.repoId }}
                className="app-panel group rounded-2xl p-4 transition hover:-translate-y-0.5 hover:border-data/40"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: scoreFill(s.score) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {s.repo.split("/")[1] ?? s.repo}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground group-hover:text-foreground">
                    {s.score}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="hidden truncate font-mono sm:inline">{s.repo}</span>
                  <span className="shrink-0 sm:ml-auto">{s.when}</span>
                </div>
                {s.blockers > 0 && (
                  <div className="mt-2 text-xs font-medium text-critical">
                    {s.blockers} blocker{s.blockers > 1 ? "s" : ""}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <DashboardPanel>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-data" />
            <h3 className="text-sm font-semibold">Readiness overview</h3>
          </div>
          <div className="mt-3 space-y-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Repos scanned</span>
              <span className="font-medium">{recentScans.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fixes shipped</span>
              <span className="font-medium">{fixesShipped}</span>
            </div>
            {avgScore != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg readiness</span>
                <span className="font-medium">{avgScore}</span>
              </div>
            )}
          </div>
        </DashboardPanel>

        <DashboardPanel>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-data" />
            <h3 className="text-sm font-semibold">Next steps</h3>
          </div>
          <div className="mt-3 space-y-2 text-xs">
            {recentScans.length === 0 && (
              <Link
                to="/repos"
                className="block rounded-xl border border-border px-3 py-2.5 hover:border-data/50 hover:bg-muted/50"
              >
                Scan your first repository
              </Link>
            )}
            {lowestRepo && (
              <Link
                to="/repo/$repoId"
                params={{ repoId: lowestRepo.repoId }}
                className="block rounded-xl border border-border px-3 py-2.5 hover:border-data/50 hover:bg-muted/50"
              >
                Fix lowest score: {lowestRepo.repo.split("/")[1] ?? lowestRepo.repo} (
                {lowestRepo.score}/100)
              </Link>
            )}
            {recentScans.length > 0 && (
              <Link
                to="/reports"
                className="block rounded-xl border border-border px-3 py-2.5 hover:border-data/50 hover:bg-muted/50"
              >
                Review all reports
              </Link>
            )}
          </div>
        </DashboardPanel>
      </div>
    </AppLayout>
  );
}
