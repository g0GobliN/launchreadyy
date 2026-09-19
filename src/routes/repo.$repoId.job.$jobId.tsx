import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { RepoNotFound } from "@/components/app/RepoNotFound";
import { RepoLayout } from "@/components/layouts/RepoLayout";
import { DashboardPageHeader } from "@/components/app/DashboardKit";
import { useQuery } from "@tanstack/react-query";
import { getSessionUserFn } from "@/lib/api/session.functions";
import { AuthErrorScreen } from "@/components/auth-error-screen";
import { FIX_DETAILS } from "@/lib/mock-data";
import { getRepoFn, getScanFn } from "@/lib/api/db.functions";
import {
  getFixRequestFn,
  confirmFixRequest,
  cancelFixRequest,
  approveFixRequest,
  confirmFixJobCompleteFn,
  regenerateFixRequest,
  getPendingDiffsFn,
} from "@/lib/api/github.functions";
import {
  diagnoseRecoveryFn,
  applyRecoveryFixFn,
  listRecoveryAttemptsFn,
} from "@/lib/api/fix-recovery.functions";
import { AI_FIX_EFFORT, AI_FIX_IDS } from "@/lib/fix-meta";
import { DiffView } from "@/components/diff-view";
import { MiniTerminal } from "@/components/app/MiniTerminal";
import { triggerSandboxVerifyFn } from "@/lib/api/sandbox.functions";
import { FixReviewHelpPanel } from "@/components/fix-review-help-panel";
import { collectPreviewIssues } from "@/lib/fix-review-preview";
import type { FileDiff } from "@/lib/mock-data";
import { estimatePostFixProof } from "@/lib/launch-blockers";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ExternalLink,
  FilePlus2,
  FileEdit,
  Package,
  GitPullRequest,
  Loader2,
  XCircle,
  Gauge,
  Sparkles,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  TrendingUp,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { Database } from "@/lib/data-store.types";

type FixRequestRow = Database["public"]["Tables"]["fix_requests"]["Row"];

export const Route = createFileRoute("/repo/$repoId/job/$jobId")({
  head: () => ({ meta: [{ title: "Launch analysis job — LaunchReadyy" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ from: (s.from as string) ?? "" }),
  component: JobPage,
  notFoundComponent: () => <RepoNotFound reason="job" />,
  errorComponent: ({ error }) => <AuthErrorScreen error={error} />,
  loader: async ({ params }) => {
    const [repo, job, scan] = await Promise.all([
      getRepoFn({ data: { repoId: params.repoId } }),
      getFixRequestFn({ data: { jobId: params.jobId } }),
      getScanFn({ data: { repoId: params.repoId } }).catch(() => null),
    ]);
    if (!repo || !job) throw notFound();
    if (job.status === "cancelled") {
      throw redirect({ to: "/repo/$repoId", params: { repoId: params.repoId } });
    }
    return { repo, job, scan };
  },
});

function JobPage() {
  const { repo, job: initialJob, scan } = Route.useLoaderData();
  const { jobId } = Route.useParams();
  const { from } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [job, setJob] = useState<FixRequestRow>(initialJob);
  const [cancelling, setCancelling] = useState(false);

  const fixIds = job.fixes ? job.fixes.split(",").filter(Boolean) : [];
  const fixLabels = fixIds.map((id) => FIX_DETAILS[id]?.label).filter(Boolean) as string[];

  // Skip the legacy pending confirmation screen — start generation immediately.
  useEffect(() => {
    if (job.status !== "pending") return;
    void handleConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when landing on a stale pending job
  }, []);
  useEffect(() => {
    if (job.status !== "running") return;
    const interval = setInterval(async () => {
      const updated = await getFixRequestFn({ data: { jobId } });
      if (updated) setJob(updated);
      if (updated && updated.status !== "running") clearInterval(interval);
    }, 2000);
    return () => clearInterval(interval);
  }, [job.status, jobId]);

  async function handleConfirm() {
    try {
      await confirmFixRequest({ data: { jobId } });
      setJob((prev) => ({ ...prev, status: "running", updated_at: new Date().toISOString() }));
    } catch {
      /* polling / user can retry from failed state */
    }
  }

  async function handleDiscard() {
    setCancelling(true);
    try {
      if (job.status === "pending" || job.status === "awaiting_review") {
        await cancelFixRequest({ data: { jobId } });
      }
      navigate({ to: "/repo/$repoId", params: { repoId: repo.id } });
    } finally {
      setCancelling(false);
    }
  }

  const { data: sessionUser } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: Infinity,
  });

  return (
    <RepoLayout user={sessionUser} repoId={repo.id} repoName={repo.name}>
      <div
        className={`${
          job.status === "awaiting_review" || job.status === "pr_open" ? "max-w-7xl" : "max-w-3xl"
        }`}
      >
        {from === "jobs" ? (
          <Link
            to="/jobs"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to job history
          </Link>
        ) : (
          <Link
            to="/repo/$repoId"
            params={{ repoId: repo.id }}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to analysis
          </Link>
        )}

        <DashboardPageHeader
          eyebrow="Fix · Pull request"
          className="mb-6 mt-5"
          title={
            job.status === "running" || job.status === "pending"
              ? "Building your PR"
              : job.status === "completed"
                ? "Pull request ready"
                : job.status === "pr_open"
                  ? "Check CI on your PR"
                  : job.status === "awaiting_review"
                    ? "Review generated changes"
                    : "Something went wrong"
          }
          description={<span className="font-mono">{repo.full_name}</span>}
        />

        <div className="space-y-4">
          {job.status === "pending" && (
            <RunningView job={job} fixIds={fixIds} fixLabels={fixLabels} />
          )}
          {job.status === "running" && (
            <RunningView job={job} fixIds={fixIds} fixLabels={fixLabels} />
          )}
          {job.status === "awaiting_review" && (
            <AwaitingReviewView
              job={job}
              setJob={setJob}
              onDiscard={handleDiscard}
              discarding={cancelling}
              repoId={repo.id}
            />
          )}
          {job.status === "pr_open" && (
            <PrOpenView job={job} setJob={setJob} fixLabels={fixLabels} repoId={repo.id} />
          )}
          {job.status === "completed" && (
            <CompletedView job={job} fixLabels={fixLabels} repoId={repo.id} scan={scan} />
          )}
          {job.status === "failed" && <FailedView job={job} repoId={repo.id} />}
        </div>
      </div>
    </RepoLayout>
  );
}

// ─── Running ──────────────────────────────────────────────────────────────────

function buildGenerationScript(
  fixIds: string[],
  fixLabels: string[],
): { steps: string[]; tips: string[] } {
  const hasAi = fixIds.some((id) => AI_FIX_IDS.has(id));
  const label = fixLabels[0] ?? "your fixes";
  const steps: string[] = ["Connecting to GitHub and loading your repo…"];

  if (fixIds.includes("auditor-stripe-webhook")) {
    steps.push(
      "Locating your Stripe webhook route…",
      "Drafting constructEvent signature verification…",
      "Checking STRIPE_WEBHOOK_SECRET handling…",
    );
  } else if (fixIds.includes("auditor-api-validation")) {
    steps.push("Reviewing unvalidated API routes…", "Adding request schema validation…");
  } else if (fixIds.includes("auditor-auth-routes")) {
    steps.push("Finding unprotected dashboard routes…", "Adding authentication guards…");
  } else if (fixIds.includes("auditor-localhost-api")) {
    steps.push(
      "Scanning for hardcoded localhost URLs…",
      "Switching to environment-based API URLs…",
    );
  } else if (fixIds.includes("auditor-env-undocumented") || fixIds.includes("auditor-env-gap")) {
    steps.push("Scanning env vars used in your code…", "Building .env.example…");
  } else if (fixIds.includes("ci-ai") || fixIds.includes("github-actions")) {
    steps.push("Detecting package manager and scripts…", "Writing a CI workflow for your stack…");
  } else if (fixIds.includes("readme-ai") || fixIds.includes("readme")) {
    steps.push("Reading README and repo metadata…", "Writing setup documentation…");
  } else if (fixIds.includes("vitest-ai") || fixIds.includes("playwright-ai")) {
    steps.push("Sampling your source files…", "Generating tests from real code…");
  } else if (hasAi) {
    steps.push(`Analysing files for ${label}…`, "Generating tailored changes…");
  } else {
    steps.push("Applying launch-ready templates…", "Updating config and manifests…");
  }

  steps.push("Running final checks…", "Preparing your preview…");

  const tips = [
    "Nothing is committed yet — you'll review every file before the PR opens.",
    "We always branch off main. You merge when you're ready.",
    hasAi
      ? "AI fixes are tailored to your repo structure, not generic boilerplate."
      : "Template fixes run without an AI provider.",
    fixIds.some((id) => id.startsWith("auditor-"))
      ? "Auditor fixes patch the exact file we flagged in your scan."
      : "You can regenerate AI output if the first draft isn't quite right.",
    "Most jobs finish in under a minute. Complex repos may take a bit longer.",
  ];

  return { steps, tips };
}

function GeneratingProgress({ fixIds, fixLabels }: { fixIds: string[]; fixLabels: string[] }) {
  const { steps, tips } = buildGenerationScript(fixIds, fixLabels);
  const [stepIndex, setStepIndex] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const advance = setInterval(() => {
      setStepIndex((i) => (i < steps.length - 1 ? i + 1 : i));
    }, 2800);
    return () => clearInterval(advance);
  }, [steps.length]);

  useEffect(() => {
    const rotate = setInterval(() => {
      setTipIndex((i) => (i + 1) % tips.length);
    }, 4500);
    return () => clearInterval(rotate);
  }, [tips.length]);

  const progressPct = Math.min(95, 12 + ((stepIndex + 1) / steps.length) * 78);
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="text-left">
      <ol className="space-y-4">
        {steps.map((step, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          return (
            <li key={step} className="flex items-center gap-3.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center">
                {done ? (
                  <Check className="h-4 w-4 text-primary" strokeWidth={2.5} />
                ) : active ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
                )}
              </span>
              <span
                className={`text-[15px] leading-6 transition-colors duration-500 motion-reduce:transition-none ${
                  active
                    ? "text-foreground"
                    : done
                      ? "text-muted-foreground"
                      : "text-muted-foreground/45"
                }`}
              >
                {step.replace(/…$/, "")}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-9">
        <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
          <div
            className="h-full rounded-full bg-primary/80 transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {elapsed < 8
              ? "This usually takes under a minute"
              : elapsed < 20
                ? "Still working"
                : "Almost there"}
          </span>
          <span className="tabular-nums text-muted-foreground/70">{mmss}</span>
        </div>
      </div>

      <p key={tipIndex} className="mt-7 text-[13px] leading-6 text-muted-foreground">
        {tips[tipIndex]}
      </p>
    </div>
  );
}

function RunningView({
  job,
  fixIds,
  fixLabels,
}: {
  job: FixRequestRow;
  fixIds: string[];
  fixLabels: string[];
}) {
  return (
    <>
      <StatusBadge status="running" />
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-6 py-6 sm:px-8">
          <h2 className="font-display text-[26px] font-medium leading-tight tracking-[-0.02em]">
            Generating your changes
          </h2>
          <p className="mt-2 text-[15px] leading-6 text-muted-foreground">
            {fixIds.length === 1 ? "1 fix" : `${fixIds.length} fixes`} on{" "}
            <span className="font-mono text-[13px] text-foreground/80">{job.branch_name}</span>
          </p>
        </div>

        <div className="grid gap-x-10 gap-y-8 px-6 py-7 sm:grid-cols-[minmax(0,1fr)_15rem] sm:px-8">
          <GeneratingProgress fixIds={fixIds} fixLabels={fixLabels} />

          <aside className="sm:border-l sm:border-border sm:pl-8">
            <h3 className="text-[13px] font-medium text-foreground">What you'll get</h3>
            <ul className="mt-3.5 space-y-2">
              {fixLabels.map((label) => (
                <li
                  key={label}
                  className="flex items-start gap-2.5 rounded-lg bg-foreground/[0.04] px-3 py-2.5 text-[13px] leading-5 text-foreground/85"
                >
                  <FilePlus2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  {/* Catalogue labels carry a trailing caveat — "(Sentry — requires DSN)" —
                      that belongs in the note below, not stacked in a list. */}
                  <span>{label.replace(/\s*\([^)]*\)\s*$/, "")}</span>
                </li>
              ))}
            </ul>

            {fixLabels.some((l) => /\(([^)]*)\)\s*$/.test(l)) && (
              <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
                {fixLabels
                  .map((l) => l.match(/\(([^)]*)\)\s*$/)?.[1])
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}

            <p className="mt-5 border-t border-border pt-4 text-[12px] leading-5 text-muted-foreground">
              You'll review every file before anything is committed.
            </p>
          </aside>
        </div>
      </div>
    </>
  );
}

// ─── Automatic repair history ─────────────────────────────────────────────────

/**
 * What the loop did, in order.
 *
 * Exists so a user never has to reconstruct "why are there three commits on my branch" from the
 * GitHub commit list. Each row names the failure in plain words and says whether we fixed it,
 * gave up, or decided it wasn't ours. Silent when the loop never had to run — a PR that passed
 * first time should show no machinery at all.
 */
function RepairTimeline({ jobId, prUrl }: { jobId: string; prUrl: string | null }) {
  const { data: attempts } = useQuery({
    queryKey: ["recovery-attempts", jobId],
    queryFn: () => listRecoveryAttemptsFn({ data: { jobId } }),
    refetchInterval: 15_000,
  });

  if (!attempts || attempts.length === 0) return null;

  const LABEL: Record<string, { text: string; tone: "fixed" | "handed-over" | "theirs" }> = {
    auto_patched: { text: "Fixed it", tone: "fixed" },
    suggested: { text: "Suggested a fix", tone: "handed-over" },
    escalated: { text: "Handed over", tone: "handed-over" },
    diagnosis: { text: "Needs you", tone: "theirs" },
    checklist: { text: "Needs you", tone: "theirs" },
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-[15px] font-medium">What happened after the PR opened</h3>
        {prUrl && (
          <a
            href={`${prUrl}/commits`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Commits <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <ol className="mt-4 space-y-0">
        {attempts.map((a, i) => {
          const meta = LABEL[a.resolutionType] ?? { text: a.resolutionType, tone: "handed-over" };
          const last = i === attempts.length - 1;
          return (
            <li key={a.id} className="relative flex gap-3.5 pb-5 last:pb-0">
              {/* Rail linking the attempts, stopping at the final one. */}
              {!last && (
                <span className="absolute left-[7px] top-5 h-full w-px bg-border" aria-hidden />
              )}
              <span className="relative mt-1 grid h-3.5 w-3.5 shrink-0 place-items-center">
                <span
                  className={`h-2 w-2 rounded-full ${
                    meta.tone === "fixed"
                      ? "bg-primary"
                      : meta.tone === "theirs"
                        ? "bg-warning"
                        : "bg-muted-foreground/50"
                  }`}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="text-[13px] font-medium text-foreground">
                    Attempt {a.attemptCount || i + 1}
                  </span>
                  <span
                    className={`text-[12px] ${
                      meta.tone === "fixed"
                        ? "text-primary"
                        : meta.tone === "theirs"
                          ? "text-warning"
                          : "text-muted-foreground"
                    }`}
                  >
                    {meta.text}
                  </span>
                  <span className="text-[11px] text-muted-foreground/60">
                    {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{a.rootCause}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── PR open: on GitHub — user checks CI, can paste errors or confirm done ───

function PrOpenView({
  job,
  setJob,
  fixLabels,
  repoId,
}: {
  job: FixRequestRow;
  setJob: (job: FixRequestRow) => void;
  fixLabels: string[];
  repoId: string;
}) {
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);
  const [diffsLoading, setDiffsLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDiffsLoading(true);
    getPendingDiffsFn({ data: { jobId: job.id } })
      .then((result) => {
        if (!cancelled) setDiffs(result as FileDiff[]);
      })
      .finally(() => {
        if (!cancelled) setDiffsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  async function handleConfirmCi() {
    setConfirming(true);
    setError(null);
    try {
      await confirmFixJobCompleteFn({ data: { jobId: job.id } });
      const updated = await getFixRequestFn({ data: { jobId: job.id } });
      if (updated) setJob(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to confirm");
      setConfirming(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="min-w-0 space-y-4">
        <StatusBadge status="pr_open" />

        <div className="rounded-xl border border-primary/30 bg-card p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-primary">
                Step 1 of 2 — done
              </p>
              <h2 className="mt-1 font-display text-lg font-semibold">PR is on GitHub</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Review the diff on GitHub and wait for CI. Come back here if anything fails.
              </p>
            </div>
            {job.pr_url && (
              <a
                href={job.pr_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <GitPullRequest className="h-4 w-4" /> PR #{job.pr_number}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Step 2:</span> we watch CI and fix our own
            file if it fails. If it's something only you can fix, we'll say so.
          </p>
        </div>

        <RepairTimeline jobId={job.id} prUrl={job.pr_url} />

        <AiFilesPanel json={job.pending_ai_files ?? job.ai_files ?? null} />

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-display text-sm font-semibold">Changes in this PR</h3>
          <div className="mt-3 space-y-2">
            {diffsLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading diffs…
              </div>
            ) : diffs && diffs.length > 0 ? (
              diffs.map((d, i) => <DiffView key={`${d.path}-${i}`} diff={d} />)
            ) : (
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {fixLabels.map((l) => (
                  <li key={l} className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> {l}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <FixRecoveryPanel
          jobId={job.id}
          hasHashes={Boolean(job.generated_file_hashes) || Boolean(job.pending_files)}
          repoId={repoId}
          fixes={job.fixes ?? ""}
          prominent
        />

        {error && (
          <p className="rounded-md border border-critical/20 bg-critical/5 px-4 py-2 text-xs text-critical">
            {error}
          </p>
        )}

        <div className="rounded-xl border border-success/30 bg-success/5 p-5">
          <h3 className="font-display text-sm font-semibold">CI passed?</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Confirm when GitHub Actions and local tests look good. You&apos;ll get a summary page
            with all changes saved.
          </p>
          <button
            type="button"
            onClick={handleConfirmCi}
            disabled={confirming}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-success px-5 py-2 text-sm font-medium text-success-foreground hover:opacity-90 disabled:opacity-50"
          >
            {confirming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {confirming ? "Finishing…" : "CI passed — finish"}
          </button>
        </div>
      </div>

      <aside className="z-10 space-y-4 lg:mt-14 lg:sticky lg:top-[4.5rem] lg:self-start">
        <FixReviewHelpPanel phase="post-pr" previewIssues={[]} />
      </aside>
    </div>
  );
}

// ─── Awaiting review: generated output, not yet committed ───────────────────

function AwaitingReviewView({
  job,
  setJob,
  onDiscard,
  discarding,
  repoId,
}: {
  job: FixRequestRow;
  setJob: (job: FixRequestRow) => void;
  onDiscard: () => void;
  discarding: boolean;
  repoId: string;
}) {
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);
  const [diffsLoading, setDiffsLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [approving, setApproving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuesCopied, setIssuesCopied] = useState(false);
  const [verifyRunId, setVerifyRunId] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);
  const [verifyStarting, setVerifyStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDiffsLoading(true);
    getPendingDiffsFn({ data: { jobId: job.id } })
      .then((result) => {
        if (!cancelled) setDiffs(result as FileDiff[]);
      })
      .finally(() => {
        if (!cancelled) setDiffsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job.id, job.regenerate_count]);

  useEffect(() => {
    let cancelled = false;
    setVerifyStarting(true);
    void triggerSandboxVerifyFn({ data: { repoId } })
      .then((r) => {
        if (!cancelled) setVerifyRunId(r.runId);
      })
      .catch(() => {
        /* sandbox optional — PR still available if verify can't start */
      })
      .finally(() => {
        if (!cancelled) setVerifyStarting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, job.id]);

  const fixIds = job.fixes ? job.fixes.split(",").filter(Boolean) : [];
  const aiFixIds = fixIds.filter((id) => id in AI_FIX_EFFORT);
  const regenerationEffort = aiFixIds.reduce((sum, id) => sum + (AI_FIX_EFFORT[id] ?? 0), 0);
  const canRegenerate = aiFixIds.length > 0;

  let verificationNotes: { fixId: string; status: string; note: string }[] = [];
  try {
    verificationNotes = job.pending_verification_notes
      ? (JSON.parse(job.pending_verification_notes) as typeof verificationNotes)
      : [];
  } catch {
    verificationNotes = [];
  }

  async function handleApprove() {
    setApproving(true);
    setError(null);
    try {
      const result = await approveFixRequest({ data: { jobId: job.id } });
      setJob({
        ...job,
        status: "pr_open",
        pr_number: result.prNumber,
        pr_url: result.prUrl,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create PR");
    } finally {
      setApproving(false);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      await regenerateFixRequest({ data: { jobId: job.id, feedback: feedback.trim() } });
      setFeedback("");
      setJob({ ...job, status: "running", updated_at: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to regenerate");
      setRegenerating(false);
    }
  }

  const previewIssues = collectPreviewIssues(diffs, verificationNotes, job.error_message);
  const issuesText = previewIssues.join("\n");

  function copyPreviewIssues() {
    if (!issuesText) return;
    void navigator.clipboard.writeText(issuesText).then(() => {
      setIssuesCopied(true);
      window.setTimeout(() => setIssuesCopied(false), 2000);
    });
  }

  function pasteIssuesIntoFeedback() {
    if (!issuesText) return;
    setFeedback((prev) => (prev.trim() ? `${prev.trim()}\n\n${issuesText}` : issuesText));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="space-y-4 min-w-0">
        <StatusBadge status="awaiting_review" />

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-sm font-semibold">Step 1 — Review before GitHub</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing is on GitHub yet. Approve to open the PR, or regenerate if something looks
            wrong.
          </p>
        </div>

        <AiFilesPanel json={job.pending_ai_files ?? null} />

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-display text-sm font-semibold">File diffs</h3>
          <div className="mt-3 space-y-2">
            {diffsLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Computing diffs…
              </div>
            ) : diffs && diffs.length > 0 ? (
              diffs.map((d, i) => <DiffView key={`${d.path}-${i}`} diff={d} />)
            ) : verificationNotes.length > 0 ? (
              <div className="space-y-2">
                {verificationNotes.map((n) => (
                  <div
                    key={n.fixId}
                    className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm"
                  >
                    <p className="font-medium">{FIX_DETAILS[n.fixId]?.label ?? n.fixId}</p>
                    <p className="mt-1 text-muted-foreground">{n.note}</p>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  No file changes were generated. Re-scan your repo to clear this finding if it is
                  already fixed.
                </p>
              </div>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">No diffs to show.</p>
            )}
          </div>
        </div>

        {!diffsLoading && diffs?.some((d) => d.validation?.status === "invalid") && (
          <p className="rounded-md border border-critical/30 bg-critical/5 px-4 py-2 text-xs text-critical">
            One or more generated files failed a syntax check (marked "Syntax error" above) — review
            those diffs closely before approving.
          </p>
        )}

        {job.error_message && (
          <p className="rounded-md border border-warning/30 bg-warning/5 px-4 py-2 text-xs text-warning">
            {job.error_message}
          </p>
        )}
        {error && (
          <p className="rounded-md border border-critical/20 bg-critical/5 px-4 py-2 text-xs text-critical">
            {error}
          </p>
        )}

        {canRegenerate && (
          <div className="rounded-xl border border-border bg-card p-5" id="fix-feedback">
            <h3 className="font-display text-sm font-semibold">Not quite right?</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Paste CI logs, test failures, or IDE errors from your project — or describe what to
              change.
            </p>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="e.g. Playwright failed: timeout on /checkout — selector h1 not found…"
              rows={4}
              className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs sm:text-sm"
            />
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={regenerating || approving}
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {regenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Try again
              {regenerationEffort > 0 && (
                <span className="text-xs text-muted-foreground">
                  (AI effort {regenerationEffort})
                </span>
              )}
            </button>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Sandbox verification</h3>
            <button
              type="button"
              disabled={verifyStarting}
              onClick={() => {
                setVerifyStarting(true);
                void triggerSandboxVerifyFn({ data: { repoId } })
                  .then((r) => setVerifyRunId(r.runId))
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : "Failed to start verification"),
                  )
                  .finally(() => setVerifyStarting(false));
              }}
              className="rounded-[5px] border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60"
            >
              {verifyStarting ? "Starting…" : verifyRunId ? "Re-run" : "Run sandbox"}
            </button>
          </div>
          <MiniTerminal runId={verifyRunId} onStatus={setVerifyStatus} />
          {verifyStatus === "failed" && (
            <p className="text-xs font-semibold text-foreground">
              Verification failed. Fix issues or regenerate before opening a PR.
            </p>
          )}
          {verifyStatus === "passed" && (
            <p className="text-xs text-success">Sandbox passed — PR button enabled.</p>
          )}
        </div>

        <div className="app-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl border-primary/40 p-4">
          <button
            type="button"
            onClick={onDiscard}
            disabled={discarding || approving || regenerating}
            className="inline-flex items-center gap-1.5 rounded-[5px] border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
          >
            {discarding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Discard
          </button>
          <button
            onClick={handleApprove}
            disabled={
              approving ||
              regenerating ||
              diffsLoading ||
              !diffs ||
              diffs.length === 0 ||
              verifyStatus === "queued" ||
              verifyStatus === "running"
            }
            title={
              verifyStatus === "queued" || verifyStatus === "running"
                ? "Wait for sandbox verification to finish"
                : undefined
            }
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-[#00c990] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {approving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GitPullRequest className="h-4 w-4" />
            )}
            {approving ? "Opening PR…" : "Open PR on GitHub"}
          </button>
        </div>
      </div>

      <aside className="z-10 space-y-4 lg:mt-12 lg:sticky lg:top-[4.5rem] lg:self-start">
        <FixReviewHelpPanel
          previewIssues={previewIssues}
          copied={issuesCopied}
          onCopyIssues={previewIssues.length > 0 ? copyPreviewIssues : undefined}
          onPasteIntoFeedback={previewIssues.length > 0 ? pasteIssuesIntoFeedback : undefined}
        />
      </aside>
    </div>
  );
}

// ─── Completed ────────────────────────────────────────────────────────────────

interface AiFile {
  fixId: string;
  path: string;
  content: string;
}

function AiFilesPanel({ json, title }: { json: string | null; title?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!json) return null;
  let files: AiFile[] = [];
  try {
    files = JSON.parse(json) as AiFile[];
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  return (
    <div className="rounded-xl border border-accent/30 bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <BrainCircuit className="h-4 w-4 text-primary" />
        <h3 className="font-display text-sm font-semibold">{title ?? "AI-generated test files"}</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-2">
        {files.map((f) => (
          <div key={f.path} className="rounded-md border border-border bg-surface">
            <button
              onClick={() => setOpen((p) => (p === f.path ? null : f.path))}
              className="flex w-full items-center justify-between px-3 py-2 text-xs cursor-pointer"
            >
              <span className="min-w-0 truncate font-mono text-muted-foreground">{f.path}</span>
              {open === f.path ? (
                <ChevronUp className="h-3 w-3 shrink-0" />
              ) : (
                <ChevronDown className="h-3 w-3 shrink-0" />
              )}
            </button>
            {open === f.path && (
              <pre className="max-h-64 overflow-auto border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
                {f.content}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CompletedView({
  job,
  fixLabels,
  repoId,
  scan,
}: {
  job: FixRequestRow;
  fixLabels: string[];
  repoId: string;
  scan: Awaited<ReturnType<typeof getScanFn>> | null;
}) {
  const fixIds = job.fixes ? job.fixes.split(",").filter(Boolean) : [];
  let verificationNotes: { fixId: string; status: string; note: string }[] = [];
  try {
    verificationNotes = job.pending_verification_notes
      ? (JSON.parse(job.pending_verification_notes) as typeof verificationNotes)
      : [];
  } catch {
    verificationNotes = [];
  }
  const proof =
    scan && fixIds.length > 0 ? estimatePostFixProof(scan, fixIds, verificationNotes) : null;

  return (
    <div className="space-y-4">
      <StatusBadge status="completed" />
      <div className="rounded-xl border border-border bg-card p-5 sm:p-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h2 className="mt-5 font-display text-xl sm:text-2xl font-semibold">You&apos;re all set</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          PR #{job.pr_number} is ready — CI confirmed. Merge on GitHub when you&apos;re happy.
        </p>
        {job.pr_url && (
          <a
            href={job.pr_url}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-5 py-2.5 text-sm font-medium hover:bg-muted"
          >
            <GitPullRequest className="h-4 w-4" /> View PR on GitHub
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {proof && proof.scoreDelta > 0 && (
        <div className="rounded-xl border border-success/30 bg-success/5 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-success">
            <TrendingUp className="h-4 w-4" />
            Projected launch readiness after merge
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-3">
            <span className="font-display text-2xl sm:text-3xl font-semibold">
              {proof.projectedScore}
            </span>
            <span className="text-sm text-muted-foreground">
              up from {proof.currentScore} (+{proof.scoreDelta})
            </span>
          </div>
          <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
            <li>
              {proof.issuesAddressed} issue{proof.issuesAddressed !== 1 ? "s" : ""} addressed in
              this PR
            </li>
            {proof.blockersCleared > 0 && (
              <li>
                {proof.blockersCleared} launch blocker{proof.blockersCleared !== 1 ? "s" : ""}{" "}
                cleared
              </li>
            )}
          </ul>
          {proof.manualFollowUps.length > 0 && (
            <div className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span className="font-medium">Still needs attention after merge:</span>
              <ul className="mt-1 list-disc pl-4">
                {proof.manualFollowUps.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Re-scan after merging to confirm your actual score — estimates assume fixes land as
            expected.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Branch</div>
          <div className="mt-1 break-all font-mono text-sm">{job.branch_name}</div>
          {job.pr_url && (
            <>
              <div className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">
                PR URL
              </div>
              <a
                href={job.pr_url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate font-mono text-sm text-primary hover:underline"
              >
                {job.pr_url}
              </a>
            </>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Includes</div>
          <ul className="mt-2 space-y-1.5 text-sm">
            {fixLabels.map((l) => (
              <li key={l} className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> {l}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Gauge className="h-3.5 w-3.5 text-primary" />
            {job.effort_score === 0 ? "Template remediation" : `AI effort ${job.effort_score}`}
          </div>
        </div>
      </div>

      <AiFilesPanel json={job.ai_files ?? null} title="Your changes" />

      <FixSatisfactionWidget jobId={job.id} />

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-display text-sm font-semibold">Next steps</h3>
        <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>1. Merge the PR on GitHub when ready.</li>
          <li>2. Re-scan your repo to update your launch score.</li>
        </ol>
        <div className="mt-5 flex gap-2">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-muted"
          >
            Back to dashboard
          </Link>
          <Link
            to="/repo/$repoId"
            params={{ repoId }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-muted"
          >
            Re-scan repo
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Failed ───────────────────────────────────────────────────────────────────

function FailedView({ job, repoId }: { job: FixRequestRow; repoId: string }) {
  return (
    <>
      <StatusBadge status="failed" />
      <div className="rounded-xl border border-critical/30 bg-card p-5 sm:p-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-critical/10 text-critical">
          <XCircle className="h-7 w-7" />
        </div>
        <h2 className="mt-4 font-display text-lg sm:text-xl font-semibold">Job failed</h2>
        {job.error_message && (
          <p className="mt-2 rounded-md border border-critical/20 bg-critical/5 px-4 py-2 font-mono text-xs text-critical">
            {job.error_message}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <Link
            to="/repo/$repoId/fix"
            params={{ repoId }}
            search={{ fixes: job.fixes }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Try again
          </Link>
          <Link
            to="/repo/$repoId"
            params={{ repoId }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 text-sm hover:bg-muted"
          >
            Back to repo
          </Link>
        </div>
      </div>
      <FixRecoveryPanel jobId={job.id} hasHashes={Boolean(job.generated_file_hashes)} />
    </>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: {
    label: "Pending confirmation",
    className: "bg-warning/10 text-warning border-warning/20",
  },
  running: { label: "Running", className: "bg-primary/10 text-primary border-primary/20" },
  awaiting_review: {
    label: "Awaiting your review",
    className: "bg-primary/10 text-primary border-primary/20",
  },
  pr_open: {
    label: "PR open — check CI",
    className: "bg-primary/10 text-primary border-primary/20",
  },
  completed: { label: "Completed", className: "bg-success/10 text-success border-success/20" },
  failed: { label: "Failed", className: "bg-critical/10 text-critical border-critical/20" },
  cancelled: { label: "Cancelled", className: "bg-muted/50 text-muted-foreground border-border" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.cancelled;
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${cfg.className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {cfg.label}
    </div>
  );
}

function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
      {icon}
      <div>
        <div className="font-display text-base font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

// ─── Fix satisfaction widget ──────────────────────────────────────────────────

function FixSatisfactionWidget({ jobId }: { jobId: string }) {
  const storageKey = `fix-rating-${jobId}`;
  const [rating, setRating] = useState<"up" | "down" | null>(() => {
    try {
      return (localStorage.getItem(storageKey) as "up" | "down" | null) ?? null;
    } catch {
      return null;
    }
  });

  function handleRate(value: "up" | "down") {
    setRating(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      /* ignore storage errors */
    }
  }

  if (rating) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
        {rating === "up" ? "Thanks for the thumbs up!" : "Thanks for the feedback — we'll improve."}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="font-display text-sm font-semibold">How did this fix do?</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Your rating helps us improve AI output quality.
      </p>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => handleRate("up")}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-success/50 hover:bg-success/5 hover:text-success"
        >
          <ThumbsUp className="h-4 w-4" /> Looks good
        </button>
        <button
          type="button"
          onClick={() => handleRate("down")}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-critical/50 hover:bg-critical/5 hover:text-critical"
        >
          <ThumbsDown className="h-4 w-4" /> Needs work
        </button>
      </div>
    </div>
  );
}

// ─── Fix recovery ─────────────────────────────────────────────────────────────

type RecoveryDiagnosis = Awaited<ReturnType<typeof diagnoseRecoveryFn>>;

/**
 * Openers for people who have no log to paste.
 *
 * A blank box asks the user to know what we want; a chip is a real answer that gets a real
 * follow-up. Each seeds the composer with a line the diagnosis can actually use.
 */
const QUICK_STARTS = [
  { label: "Build fails locally", seed: "The build fails on my machine. Output:\n" },
  { label: "Tests fail", seed: "My tests fail after this PR. Output:\n" },
  { label: "Deploy fails", seed: "The deploy fails. Log:\n" },
  { label: "Not sure", seed: "Something looks wrong after this PR but I'm not sure what. " },
];

function FixRecoveryPanel({
  jobId,
  hasHashes,
  repoId,
  fixes,
  prominent = false,
}: {
  jobId: string;
  hasHashes: boolean;
  repoId?: string;
  fixes?: string;
  prominent?: boolean;
}) {
  const [open, setOpen] = useState(prominent);
  const [errorLog, setErrorLog] = useState("");
  const [diagnosing, setDiagnosing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [diagnosis, setDiagnosis] = useState<RecoveryDiagnosis | null>(null);
  const [patchPrUrl, setPatchPrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Real, already-known context — the files we put in this PR. Shown so the panel opens by
  // stating what it knows rather than by asking the user to supply everything.
  const contextChips = (fixes ?? "")
    .split(",")
    .filter(Boolean)
    .map((id) => FIX_DETAILS[id]?.label?.replace(/\s*\([^)]*\)\s*$/, "") ?? id)
    .slice(0, 4);

  if (!hasHashes && !prominent) return null;

  async function handleDiagnose() {
    if (errorLog.trim().length < 10) return;
    setDiagnosing(true);
    setError(null);
    setDiagnosis(null);
    setPatchPrUrl(null);
    try {
      const result = await diagnoseRecoveryFn({ data: { jobId, errorLog: errorLog.trim() } });
      setDiagnosis(result);
      if (result.appliedPrUrl) setPatchPrUrl(result.appliedPrUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Diagnosis failed");
    } finally {
      setDiagnosing(false);
    }
  }

  async function handleApplyPatch() {
    if (!diagnosis?.recoveryId) return;
    setApplying(true);
    setError(null);
    try {
      const result = await applyRecoveryFixFn({ data: { recoveryId: diagnosis.recoveryId } });
      setPatchPrUrl(result.prUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply fix");
    } finally {
      setApplying(false);
    }
  }

  // A long paste is evidence, not prose — collapse it to a chip so the composer stays readable
  // and the user can see it was actually received.
  const pastedLines = errorLog ? errorLog.split("\n").length : 0;
  const collapsed = errorLog.length > 400 && !showRaw;

  const panelBody = (
    <div className="mt-4 space-y-4">
      {/* What it already knows, before asking for anything. */}
      {contextChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {contextChips.map((chip) => (
            <span
              key={chip}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-foreground/[0.03] px-2 py-1 text-[11px] text-muted-foreground"
            >
              <FileEdit className="h-3 w-3 shrink-0 opacity-60" />
              {chip}
            </span>
          ))}
        </div>
      )}

      {collapsed ? (
        <button
          type="button"
          onClick={() => setShowRaw(true)}
          className="flex w-full items-center justify-between rounded-md border border-border bg-foreground/[0.03] px-3 py-2.5 text-left text-xs hover:bg-foreground/[0.06]"
        >
          <span className="flex items-center gap-2 text-foreground">
            <Package className="h-3.5 w-3.5 opacity-60" />
            Error log attached · {pastedLines} lines
          </span>
          <span className="text-muted-foreground">Show</span>
        </button>
      ) : (
        <textarea
          value={errorLog}
          onChange={(e) => setErrorLog(e.target.value)}
          placeholder={
            hasHashes
              ? "Paste the error — from your terminal, Vercel, Sentry, or a CI log."
              : "Describe what went wrong and I'll check the files I added against it."
          }
          rows={errorLog ? 6 : 3}
          className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2.5 font-mono text-xs leading-5 sm:text-[13px]"
        />
      )}

      {/* Nobody knows what to type into an empty box; everybody can pick the one that matches. */}
      {!errorLog && (
        <div className="flex flex-wrap gap-1.5">
          {QUICK_STARTS.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => setErrorLog(q.seed)}
              className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {q.label}
            </button>
          ))}
        </div>
      )}

      {!hasHashes && repoId && fixes && !prominent ? (
        <p className="text-xs text-muted-foreground">
          Snapshot unavailable for this job —{" "}
          <Link
            to="/repo/$repoId/fix"
            params={{ repoId }}
            search={{ fixes }}
            className="text-primary underline"
          >
            run the fix again
          </Link>{" "}
          from analysis instead.
        </p>
      ) : (
        <button
          type="button"
          onClick={handleDiagnose}
          disabled={diagnosing || errorLog.trim().length < 10}
          className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
            prominent
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "border border-border bg-surface hover:bg-muted"
          }`}
        >
          {diagnosing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {diagnosing ? "Diagnosing…" : prominent ? "Diagnose & fix" : "Try again"}
        </button>
      )}
      {prominent && errorLog.trim().length > 0 && errorLog.trim().length < 10 && (
        <p className="text-xs text-muted-foreground">
          Paste at least 10 characters of error output.
        </p>
      )}

      {error && (
        <p className="rounded-md border border-critical/20 bg-critical/5 px-3 py-2 text-xs text-critical">
          {error}
        </p>
      )}

      {diagnosis && (
        <div className="space-y-3 rounded-md border border-border bg-surface p-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Root cause
            </div>
            <p className="mt-1 text-sm">{diagnosis.rootCause}</p>
          </div>

          {diagnosis.driftMessage && (
            <p className="text-xs text-warning">{diagnosis.driftMessage}</p>
          )}

          {diagnosis.resolutionType === "escalated" && (
            <p className="text-sm text-muted-foreground">
              We&apos;ve tried twice — here&apos;s our diagnosis, please fix manually or contact
              support.
            </p>
          )}

          {diagnosis.checklist && diagnosis.checklist.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {diagnosis.checklist.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}

          {diagnosis.appliedPrUrl && !patchPrUrl && (
            <p className="text-sm text-muted-foreground">Opening recovery PR…</p>
          )}

          {diagnosis.patch && diagnosis.patchOffer && !patchPrUrl && !diagnosis.appliedPrUrl && (
            <div className="space-y-2">
              <div className="break-all text-xs text-muted-foreground">
                Suggested fix for <span className="font-mono">{diagnosis.patch.path}</span>
              </div>
              <pre className="max-h-48 overflow-auto rounded border border-border bg-card p-2 font-mono text-[10px]">
                {diagnosis.patch.content.slice(0, 2000)}
                {diagnosis.patch.content.length > 2000 ? "\n…" : ""}
              </pre>
              <button
                type="button"
                onClick={handleApplyPatch}
                disabled={applying}
                className="inline-flex items-center gap-2 rounded-md border border-primary bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
              >
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Gauge className="h-4 w-4" />
                )}
                {diagnosis.patchOffer === "auto" ? "Open fix PR" : "Apply this fix?"}
                {diagnosis.aiEffort > 0 && ` (AI effort ${diagnosis.aiEffort})`}
              </button>
            </div>
          )}

          {patchPrUrl && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {diagnosis.recreatedPr
                  ? "Full fix PR recreated with CI patch — merge to apply Playwright and all fixes."
                  : diagnosis.appliedPrUrl
                    ? "Fix PR updated automatically — merge it to fix CI."
                    : "Recovery PR ready — merge it to fix CI."}
              </p>
              <a
                href={patchPrUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <GitPullRequest className="h-4 w-4" /> View fix PR
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (prominent) {
    return (
      <div className="rounded-xl border border-border bg-card p-5" id="fix-feedback">
        <h3 className="font-display text-sm font-semibold">Not quite right?</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          CI or tests failed after the PR? Paste the error log — we&apos;ll patch your open fix PR.
        </p>
        {panelBody}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <h3 className="font-display text-sm font-semibold">CI failed?</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Paste your error log for a free diagnosis
          </p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && panelBody}
    </div>
  );
}
