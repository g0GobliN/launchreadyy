import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { RepoNotFound } from "@/components/app/RepoNotFound";
import { RepoLayout } from "@/components/layouts/RepoLayout";
import { VerdictOverview } from "@/components/app/VerdictOverview";
import { RunProgress } from "@/components/app/RunProgress";
import { AuthErrorScreen } from "@/components/auth-error-screen";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSessionUserFn } from "@/lib/api/session.functions";
import {
  acceptRiskFn,
  getRepoFn,
  getRiskAcceptancesFn,
  getScanFn,
  getScanTrendFn,
  revokeRiskAcceptanceFn,
} from "@/lib/api/db.functions";
import { getRepoScanJobFn, triggerScan } from "@/lib/api/github.functions";

import {
  CategoryBreakdown,
  LaunchChecklistPanel,
  ReadinessSections,
} from "@/components/readiness-panel";
import { ShareLaunchScore } from "@/components/share-launch-score";
import { APP_ORIGIN } from "@/lib/app-url";
import { CategoryTrendCard } from "@/components/category-trend-card";
import { MonitoringPanel } from "@/components/monitoring-panel";
import { getRepoScoreHistoryFn, getRepoMonitorFn } from "@/lib/api/monitor.functions";
import type { CategoryTrend } from "@/lib/finding-fingerprint";
import {
  isUnsupportedStaticScan,
  unsupportedScanMessage,
  UNSUPPORTED_STATIC_WEB_SCAN_PREFIX,
} from "@/lib/project-context";
import {
  ArrowRight,
  BrainCircuit,
  AlertTriangle,
  BarChart2,
  Info,
  Shield,
  TrendingUp,
  TrendingDown,
  Wrench,
  Loader2,
  Rocket,
  TestTube2,
} from "lucide-react";
import { pickTop3ForLaunch, launchVerdictForScan } from "@/lib/launch-blockers";
import { SeverityBadge } from "@/components/ui-bits";
import { isReadmeBundledWithEnvExample } from "@/lib/fix-bundling";
import { isArchScanSupported } from "@/lib/project-context";
import { isAutoFixableFixId } from "@/lib/readiness/enrich-finding";
import { getFixEffortLabel, formatFixEffortLabel } from "@/lib/fix-meta";
import type { Issue } from "@/lib/mock-data";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/repo/$repoId/")({
  head: () => ({ meta: [{ title: "Launch analysis — LaunchReadyy" }] }),
  component: RepoPage,
  notFoundComponent: () => <RepoNotFound reason="repo" />,
  errorComponent: ({ error }) => <AuthErrorScreen error={error} />,
  loader: async ({ params }) => {
    const [repo, scan, trend, acceptances, scoreHistory, monitor] = await Promise.all([
      getRepoFn({ data: { repoId: params.repoId } }),
      getScanFn({ data: { repoId: params.repoId } }),
      getScanTrendFn({ data: { repoId: params.repoId } }).catch(() => null),
      getRiskAcceptancesFn({ data: { repoId: params.repoId } }).catch(() => []),
      getRepoScoreHistoryFn({ data: { repoId: params.repoId } }).catch(() => []),
      getRepoMonitorFn({ data: { repoId: params.repoId } }).catch(() => null),
    ]);
    if (!repo) throw notFound();
    return { repo, scan, trend, acceptances, scoreHistory, monitor };
  },
});

function RepoPage() {
  const router = useRouter();
  const {
    repo,
    scan,
    trend,
    acceptances: initialAcceptances,
    scoreHistory,
    monitor,
  } = Route.useLoaderData() as {
    repo: NonNullable<Awaited<ReturnType<typeof getRepoFn>>>;
    scan: Awaited<ReturnType<typeof getScanFn>>;
    trend: Awaited<ReturnType<typeof getScanTrendFn>>;
    acceptances: Awaited<ReturnType<typeof getRiskAcceptancesFn>>;
    scoreHistory: Awaited<ReturnType<typeof getRepoScoreHistoryFn>>;
    monitor: Awaited<ReturnType<typeof getRepoMonitorFn>>;
  };

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acceptances, setAcceptances] = useState(initialAcceptances ?? []);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: sessionUser } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: Infinity,
  });

  // The scan runs as a background job, so this is how the page knows one is in flight — and,
  // more importantly, how it learns that one died instead of spinning forever.
  const { data: scanJob } = useQuery({
    queryKey: ["repo-scan-job", repo.id],
    queryFn: () => getRepoScanJobFn({ data: { repoId: repo.id } }),
    refetchInterval: (query) => (query.state.data?.running ? 3_000 : false),
  });
  const scanRunning = scanJob?.running === true;

  // Pull the finished scan in the moment the job stops running.
  const wasScanRunning = useRef(false);
  useEffect(() => {
    if (wasScanRunning.current && !scanRunning) {
      setRescanning(false);
      void router.invalidate();
    }
    wasScanRunning.current = scanRunning;
  }, [scanRunning, router]);

  const securityTrend: CategoryTrend | null = useMemo(() => {
    if (!scan?.categoryScores || !trend) return null;
    const sec = scan.categoryScores.find(
      (c) => c.category === "Security" || c.category === "Production Security",
    );
    if (!sec) return null;
    // Approximate previous security score from overall delta when per-category history missing
    const overallDelta = trend.currentScore - trend.previousScore;
    const previousScore = Math.max(0, Math.min(100, sec.score - overallDelta));
    return {
      category: "Production Security",
      currentScore: sec.score,
      previousScore,
      delta: sec.score - previousScore,
      topImprovement: trend.resolvedIssues[0]?.title ?? null,
      topRegression: trend.newIssues[0]?.title ?? null,
      resolved: trend.resolvedIssues.map((i) => i.title).slice(0, 5),
      newTitles: trend.newIssues.map((i) => i.title).slice(0, 5),
    };
  }, [scan, trend]);

  const sandboxStatus = scan?.sandboxVerify?.status ?? null;
  const sandboxInFlight = sandboxStatus === "queued" || sandboxStatus === "running";
  /** A failed run never unlocks the verdict — send them to retry, no opt-in bypass. */
  const sandboxNeedsRetry = sandboxStatus === "failed";
  // A run with no provider configured lands as "skipped", which is what releases the verdict
  // when sandbox verification isn't available at all.
  const sandboxSettled =
    sandboxStatus === "passed" ||
    sandboxStatus === "skipped" ||
    scan?.issues.some((i) => i.detection?.includes("sandbox-verified")) === true;

  // The verdict still waits for a real build — that gate is unchanged. What changed is where you
  // wait: this page, with one progress panel, instead of being thrown to a terminal mid-run.
  // Polling keeps the page current while the build runs.
  useEffect(() => {
    if (!sandboxInFlight) return;
    const id = window.setInterval(() => void router.invalidate(), 5_000);
    return () => window.clearInterval(id);
  }, [sandboxInFlight, router]);

  const sandboxBanner = useMemo(() => {
    if (!scan || !sandboxSettled) return null;
    if (
      sandboxStatus === "passed" ||
      scan.issues.some((i) => i.detection?.includes("sandbox-verified"))
    ) {
      return null;
    }
    if (sandboxStatus === "skipped") {
      return {
        message:
          "We couldn't build this repository for this run — showing code analysis only, so the verdict is less certain.",
        upgrade: false,
      };
    }
    return null;
  }, [scan, sandboxSettled, sandboxStatus]);

  async function runSandbox() {
    setRescanning(true);
    setRescanError(null);
    try {
      // Queued only — the scan-job poll above drives the progress panel.
      await triggerScan({ data: { repoId: repo.id } });
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: ["repo-scan-job", repo.id] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sandbox start failed. Please try again.";
      setRescanError(msg);
      setRescanning(false);
    }
  }

  const visibleIssues = useMemo(() => {
    if (!scan) return [];
    const now = Date.now();
    const activeAcceptanceFixIds = new Set(
      acceptances
        .filter((acceptance) => {
          if (acceptance.reasonType !== "temporary") return true;
          const ageDays = (now - new Date(acceptance.acceptedAt).getTime()) / (1000 * 60 * 60 * 24);
          return ageDays <= 30;
        })
        .map((acceptance) => acceptance.fixId),
    );
    const scanFixIds = new Set(scan.issues.map((i) => i.fixId));
    const bundledReadme = isReadmeBundledWithEnvExample(scanFixIds);
    return scan.issues
      .filter((i) => !activeAcceptanceFixIds.has(i.fixId))
      .filter((i) => !(bundledReadme && i.fixId === "readme-ai"))
      .map((i) =>
        bundledReadme && i.fixId === "env-example-ai"
          ? { ...i, title: "Missing .env.example + setup docs" }
          : i,
      )
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  }, [scan, acceptances]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });

  // One run, one waiting room. Whichever half is working, the user sees the same panel — and
  // only when there is no previous verdict to keep reading instead.
  const runStage = scanRunning ? "reading" : sandboxInFlight ? "building" : null;
  if (runStage && !sandboxSettled) {
    return (
      <RepoLayout user={sessionUser} repoId={repo.id} repoName={repo.name}>
        <div className="mx-auto max-w-6xl py-4 lg:py-8">
          <RunProgress
            stage={runStage}
            repoId={repo.id}
            repoName={repo.name}
            startedAt={scanJob?.queuedAt}
          />
        </div>
      </RepoLayout>
    );
  }

  // A job that died must say so. The whole point of moving the scan off the button was that a
  // failure used to be indistinguishable from a slow scan.
  if (!scan && scanJob?.failed) {
    return (
      <RepoLayout user={sessionUser} repoId={repo.id} repoName={repo.name}>
        <div className="mx-auto flex max-w-lg flex-col items-center py-20 text-center">
          <AlertTriangle className="h-10 w-10 text-foreground" />
          <h1 className="mt-4 text-2xl font-semibold text-foreground">Scan failed</h1>
          <p className="mt-2 text-sm text-muted-foreground">{scanJob.error}</p>
          <button
            onClick={() => void runSandbox()}
            disabled={rescanning}
            className="mt-6 inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-[#00c990] disabled:opacity-60"
          >
            {rescanning ? "Starting…" : "Try again"}
          </button>
          {rescanError && (
            <p className="mt-3 text-sm font-semibold text-foreground">{rescanError}</p>
          )}
        </div>
      </RepoLayout>
    );
  }

  if (!scan) {
    return (
      <RepoLayout user={sessionUser} repoId={repo.id} repoName={repo.name}>
        <div className="mx-auto flex max-w-lg flex-col items-center py-20 text-center">
          <TestTube2 className="h-10 w-10 text-data" />
          <h1 className="mt-4 text-2xl font-semibold text-foreground">Not analyzed yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The verdict comes from actually installing and building your repository, not just
            reading it. Add environment variables first if the build needs them.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link
              to="/repo/$repoId/env"
              params={{ repoId: repo.id }}
              search={{ intent: "launch" }}
              className="rounded-[5px] border border-border bg-surface px-4 py-2 text-sm hover:bg-muted"
            >
              Configure environment
            </Link>
            <button
              type="button"
              onClick={() => void runSandbox()}
              disabled={rescanning}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-[#00c990] disabled:opacity-60"
            >
              <Rocket className="h-3.5 w-3.5" />
              {rescanning ? "Starting…" : "Run analysis"}
            </button>
          </div>
          {rescanError && <p className="mt-3 text-sm text-critical">{rescanError}</p>}
        </div>
      </RepoLayout>
    );
  }

  // A failed build is the one case that still needs the log: the reason lives in the output.
  if (sandboxNeedsRetry) {
    return (
      <RepoLayout user={sessionUser} repoId={repo.id} repoName={repo.name}>
        <div className="mx-auto flex max-w-lg flex-col items-center py-20 text-center">
          <AlertTriangle className="h-10 w-10 text-critical" />
          <h1 className="mt-4 text-2xl font-semibold text-foreground">The build failed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your repository did not install or build cleanly, so there is no verdict to give yet.
            The log says which step broke.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link
              to="/repo/$repoId/sandbox"
              params={{ repoId: repo.id }}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-[#00c990]"
            >
              Open the build log
            </Link>
            <Link
              to="/repo/$repoId/env"
              params={{ repoId: repo.id }}
              search={{ intent: "launch" }}
              className="rounded-[5px] border border-border bg-surface px-4 py-2 text-sm hover:bg-muted"
            >
              Configure environment
            </Link>
          </div>
        </div>
      </RepoLayout>
    );
  }

  // No sandbox outcome yet — do not show a static-only "verdict" as if it were final.
  if (!sandboxSettled) {
    return (
      <RepoLayout user={sessionUser} repoId={repo.id} repoName={repo.name}>
        <div className="mx-auto flex max-w-lg flex-col items-center py-20 text-center">
          <TestTube2 className="h-10 w-10 text-data" />
          <h1 className="mt-4 text-2xl font-semibold text-foreground">
            Run sandbox to unlock verdict
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Docs:{" "}
            <span className="font-medium text-foreground">repo → sandbox → production verdict</span>
            . We don’t show a full readiness score until the sandbox finishes (or is skipped by the
            platform).
          </p>
          {rescanError && (
            <p className="mt-3 text-sm font-semibold text-foreground">{rescanError}</p>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link
              to="/repo/$repoId/env"
              params={{ repoId: repo.id }}
              search={{ intent: "launch" }}
              className="rounded-[5px] border border-border bg-surface px-4 py-2 text-sm hover:bg-muted"
            >
              Configure environment
            </Link>
            <button
              type="button"
              onClick={() => void runSandbox()}
              disabled={rescanning}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-[#00c990] disabled:opacity-60"
            >
              {rescanning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
              {rescanning ? "Starting…" : "Run analysis"}
            </button>
          </div>
        </div>
      </RepoLayout>
    );
  }

  const isUnsupported = isUnsupportedStaticScan(scan.warnings);

  // Must be the same decision the Blockers tab and the Launch Report make. This page used
  // to call verdictLabel(score), which reads the score alone — so it printed "Launch Readyy"
  // while the very next tab said "Ready with warnings" for the same scan, and a repo with an
  // unresolved critical security finding could still be headlined as safe to deploy.
  const verdict = launchVerdictForScan(
    scan.score,
    visibleIssues,
    scan.checklist?.filter((c) => c.status === "fail").length ?? 0,
    scan.sandboxVerify?.status,
  );

  return (
    <RepoLayout
      user={sessionUser}
      repoId={repo.id}
      repoName={repo.name}
      actions={
        <div className="flex gap-2">
          <Link
            to="/repo/$repoId/report"
            params={{ repoId: repo.id }}
            className="rounded-[5px] border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted"
          >
            Share report
          </Link>
          <Link
            to="/repo/$repoId/fix"
            params={{ repoId: repo.id }}
            search={{ fixes: "" }}
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-[#00c990]"
          >
            Generate fix PR
          </Link>
        </div>
      }
    >
      <div>
        <h1 className="sr-only">Production verdict</h1>
        {scanRunning && (
          <div className="mb-4 flex items-center gap-2 rounded-[5px] border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-data" />A new scan is
            running. The results below are from your last scan and will update on their own when it
            finishes.
          </div>
        )}
        {!scanRunning && scanJob?.failed && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[5px] border border-critical/30 bg-critical/10 px-4 py-2.5 text-sm text-critical">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Last scan failed: {scanJob.error}</span>
            <span className="text-muted-foreground">Showing the previous result.</span>
          </div>
        )}
        <VerdictOverview
          score={scan.score}
          headline={verdict.headline}
          summary={verdict.summary}
          sandboxStatus={sandboxStatus}
          scannedAt={scan.createdAt}
          scannedAtIso={scan.createdAtIso ?? null}
          verifiedAtIso={scan.sandboxVerify?.finishedAt ?? null}
          issues={scan.issues}
          checklist={scan.checklist}
          history={scoreHistory}
          isUnsupported={isUnsupported}
          unsupportedMessage={unsupportedScanMessage(scan.warnings)}
          onRerun={() => void runSandbox()}
          rerunning={rescanning}
          rerunError={rescanError}
        />

        <div className="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
          <div className="min-w-0 rounded-[5px] border border-border bg-card p-4">
            <div className="flex flex-col">
              {scan.checklist && scan.checklist.length > 0 && (
                <div className="mt-4 border-t border-border pt-4">
                  <LaunchChecklistPanel items={scan.checklist} />
                </div>
              )}
              {scan.categoryScores && scan.categoryScores.length > 0 && (
                <div className="mt-4 border-t border-border pt-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Category breakdown
                  </div>
                  <CategoryBreakdown scores={scan.categoryScores} />
                </div>
              )}
              <Link
                to="/repo/$repoId/env"
                params={{ repoId: repo.id }}
                className="mt-3 flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-xs hover:bg-muted transition"
              >
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Shield className="h-3.5 w-3.5 text-primary" /> Env vars &amp; sandbox verify
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </Link>
              {securityTrend && (
                <div className="mt-4 border-t border-border pt-4">
                  <CategoryTrendCard trend={securityTrend} />
                </div>
              )}
              <div className="mt-4 border-t border-border pt-4">
                <MonitoringPanel repoId={repo.id} history={scoreHistory} monitor={monitor} />
              </div>
              <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
                <Row k="Framework" v={repo.framework} />
                <Row k="Issues" v={`${visibleIssues.length} found`} />
                {visibleIssues.filter((i) => i.riskLevel === "blocker").length > 0 && (
                  <Row
                    k="Blockers"
                    v={`${visibleIssues.filter((i) => i.riskLevel === "blocker").length}`}
                  />
                )}
              </div>
              {isArchScanSupported(repo.framework) ? (
                <Link
                  to="/repo/$repoId/arch"
                  params={{ repoId: repo.id }}
                  className="mt-3 flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-xs hover:bg-muted transition"
                >
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <BrainCircuit className="h-3.5 w-3.5 text-primary" /> Architecture analysis
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                </Link>
              ) : (
                <div
                  className="mt-3 flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-xs opacity-60"
                  title="Architecture analysis is available for JavaScript/TypeScript repos"
                >
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <BrainCircuit className="h-3.5 w-3.5 text-primary" /> Architecture (JS/TS only)
                  </span>
                </div>
              )}
              <Link
                to="/repo/$repoId/blockers"
                params={{ repoId: repo.id }}
                className="mt-2 flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-xs hover:bg-muted transition"
              >
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-critical" /> Launch blockers
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </Link>
              <Link
                to="/repo/$repoId/report"
                params={{ repoId: repo.id }}
                className="mt-2 flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-xs hover:bg-muted transition"
              >
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <BarChart2 className="h-3.5 w-3.5 text-primary" /> Launch Report
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </Link>
              <Link
                to="/repo/$repoId/live-security"
                params={{ repoId: repo.id }}
                className="mt-2 flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-xs hover:bg-muted transition"
              >
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Shield className="h-3.5 w-3.5 text-primary" /> Live website scan
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </Link>
            </div>
          </div>

          <div className="min-w-0">
            <ShareLaunchScore
              repoId={repo.id}
              repoFullName={repo.full_name}
              score={scan.score}
              appOrigin={typeof window !== "undefined" ? window.location.origin : APP_ORIGIN}
              topIssue={
                visibleIssues.find((i) => i.riskLevel === "blocker")?.businessImpact ??
                visibleIssues[0]?.businessImpact
              }
            />

            {sandboxBanner && (
              <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{sandboxBanner.message}</span>
                </div>
              </div>
            )}
            {(scan.warnings?.length ?? 0) > 0 && (
              <div className="mb-4 space-y-2">
                {(scan.warnings ?? [])
                  .filter((w) => !w.startsWith(UNSUPPORTED_STATIC_WEB_SCAN_PREFIX))
                  .map((w) => (
                    <div
                      key={w}
                      className="flex items-start gap-2 rounded-xl border border-foreground/25 bg-muted px-4 py-3 text-sm"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                      <span className="text-muted-foreground">{w}</span>
                    </div>
                  ))}
              </div>
            )}
            {repo.framework === "unknown" && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                Full framework checks apply to Next.js, Vite, React, and Express. Shared checks
                still run for this repo.
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <h1 className="font-display text-xl sm:text-2xl font-semibold">Launch audit</h1>
              <div className="text-sm text-muted-foreground shrink-0">{selected.size} selected</div>
            </div>

            <DecisionEngine
              repoId={repo.id}
              issues={visibleIssues}
              launchTarget={scan.launchTarget}
              launchTimeline={scan.launchTimeline}
            />

            <div className="mt-6">
              <ReadinessSections
                issues={visibleIssues}
                selected={selected}
                onToggle={(fixId) => toggle(fixId)}
                onAcceptRisk={async ({ fixId, reasonType, note }) => {
                  const result = await acceptRiskFn({
                    data: { repoId: repo.id, fixId, reasonType, note },
                  });
                  setAcceptances((prev) => [result, ...prev]);
                }}
              />
            </div>

            {acceptances.length > 0 && (
              <details className="mt-6 rounded-xl border border-border bg-card p-4">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                  Accepted risks ({acceptances.length})
                </summary>
                <div className="mt-3 space-y-2">
                  {acceptances.map((acceptance) => {
                    const matchedIssue = scan.issues.find(
                      (issue) => issue.fixId === acceptance.fixId,
                    );
                    return (
                      <div
                        key={acceptance.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <div>
                          <div>{matchedIssue?.title ?? acceptance.fixId}</div>
                          <div className="text-xs text-muted-foreground">
                            Accepted by {acceptance.userId}, {acceptance.reasonType},{" "}
                            {formatDistanceToNow(new Date(acceptance.acceptedAt), {
                              addSuffix: true,
                            })}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={async () => {
                            await revokeRiskAcceptanceFn({ data: { id: acceptance.id } });
                            setAcceptances((prev) =>
                              prev.filter((item) => item.id !== acceptance.id),
                            );
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

            <div className="sticky bottom-4 z-30 mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-surface p-4 shadow-[var(--app-shadow-float)]">
              <div className="text-sm">
                <span className="font-medium">{selected.size}</span>
                <span className="text-muted-foreground"> fixes ready for PR</span>
              </div>
              <Link
                to="/repo/$repoId/fix"
                params={{ repoId: repo.id }}
                search={{ fixes: Array.from(selected).join(",") }}
                disabled={selected.size === 0}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-[5px] px-4 py-2 text-sm font-medium transition ${
                  selected.size === 0
                    ? "pointer-events-none bg-muted text-muted-foreground"
                    : "bg-primary text-primary-foreground hover:bg-[#00c990]"
                }`}
              >
                Generate fix <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </RepoLayout>
  );
}

function DecisionEngine({
  repoId,
  issues,
  launchTarget,
  launchTimeline,
}: {
  repoId: string;
  issues: Issue[];
  launchTarget?: string | null;
  launchTimeline?: string | null;
}) {
  const top3 = pickTop3ForLaunch(issues, {
    launchTarget: launchTarget as NonNullable<
      Parameters<typeof pickTop3ForLaunch>[1]
    >["launchTarget"],
    launchTimeline: launchTimeline as NonNullable<
      Parameters<typeof pickTop3ForLaunch>[1]
    >["launchTimeline"],
  });
  const deferred = issues.length - top3.length;

  if (top3.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Fix these {top3.length} first
          </span>
          {deferred > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">
              · {deferred} other issue{deferred > 1 ? "s" : ""} can wait
            </span>
          )}
        </div>
      </div>
      <ol className="divide-y divide-border">
        {top3.map((issue, i) => {
          const canFix = isAutoFixableFixId(issue.fixId);
          const cost = canFix ? getFixEffortLabel(issue.fixId, issue.riskLevel) : null;
          const reason = issue.productionScenario ?? issue.businessImpact ?? issue.why;
          return (
            <li key={issue.id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium leading-snug">
                    {issue.businessImpact ?? issue.title}
                  </span>
                  <SeverityBadge severity={issue.severity} />
                  {issue.fixDifficulty && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Wrench className="h-2.5 w-2.5" /> {issue.fixDifficulty}
                    </span>
                  )}
                </div>
                {reason && (
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{reason}</p>
                )}
              </div>
              {canFix && (
                <Link
                  to="/repo/$repoId/fix"
                  params={{ repoId }}
                  search={{ fixes: issue.fixId }}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-primary hover:bg-muted transition"
                >
                  {cost} <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
