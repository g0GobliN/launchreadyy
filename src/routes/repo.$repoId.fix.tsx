import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { RepoLayout } from "@/components/layouts/RepoLayout";
import { DashboardPageHeader } from "@/components/app/DashboardKit";
import { useQuery } from "@tanstack/react-query";
import { getSessionUserFn } from "@/lib/api/session.functions";
import { AuthErrorScreen } from "@/components/auth-error-screen";
import { RepoNotFound, type NotFoundReason } from "@/components/app/RepoNotFound";
import { FIX_DETAILS, getFixPreviewDetails, type FileDiff } from "@/lib/mock-data";
import { getRepoFn, getScanFn } from "@/lib/api/db.functions";
import { createAndStartFixRequest, getFixPreviewFn } from "@/lib/api/github.functions";
import { useSandboxGate } from "@/hooks/useSandboxGate";
import { SandboxGateNotice } from "@/components/app/SandboxGateNotice";
import { DiffView } from "@/components/diff-view";
import { FixPreviewInsightPanel } from "@/components/fix-preview-insight";
import type { FixPreviewInsight } from "@/lib/fix-preview-insight.server";
import { defaultFixBranchName } from "@/lib/fix-branch";
import { buildFixRiskMap, DETERMINISTIC_AUDITOR_FIX_IDS, AI_FIX_IDS } from "@/lib/fix-meta";
import {
  FIX_PACKS,
  getAvailablePacks,
  packFixIdsAvailable,
  buildFixPlanPreview,
} from "@/lib/fix-packs";
import {
  frameworkToProjectLanguage,
  isNonNodeFramework,
  type ProjectLanguage,
} from "@/lib/project-context";
import { Input } from "@/components/ui/input";
import {
  expandBundledFixIds,
  isBundledReadmeFix,
  isReadmeBundledWithEnvExample,
} from "@/lib/fix-bundling";
import { isAutoFixableFixId } from "@/lib/readiness/enrich-finding";
import {
  AlertTriangle,
  ArrowLeft,
  FileEdit,
  FilePlus2,
  GitBranch,
  GitPullRequest,
  Loader2,
  Package,
  ShieldCheck,
  Sparkles,
  Layers,
  ClipboardList,
} from "lucide-react";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";

const LOADING_MESSAGES = [
  "Reading your repo…",
  "Scanning file structure…",
  "Tracing import graph…",
  "Analysing dependencies…",
  "Building context for AI…",
  "Fetching connected files…",
  "Generating diff preview…",
  "Still working, hang tight…",
  "Reviewing changes…",
  "Almost there…",
  "Wrapping up…",
  "Just a moment longer…",
];

function useRotatingMessage(active: boolean, intervalMs = 5000): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    const id = setInterval(() => setIndex((i) => (i + 1) % LOADING_MESSAGES.length), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return LOADING_MESSAGES[index]!;
}

export const Route = createFileRoute("/repo/$repoId/fix")({
  head: () => ({ meta: [{ title: "Preview changes — LaunchReadyy" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ fixes: (s.fixes as string) ?? "" }),
  component: FixPage,
  notFoundComponent: ({ data }) => {
    const d = data as { reason?: NotFoundReason; repoName?: string } | undefined;
    return <RepoNotFound reason={d?.reason ?? "generic"} repoName={d?.repoName} />;
  },
  errorComponent: ({ error }) => <AuthErrorScreen error={error} />,
  loader: async ({ params }) => {
    const [repo, scan] = await Promise.all([
      getRepoFn({ data: { repoId: params.repoId } }),
      getScanFn({ data: { repoId: params.repoId } }),
    ]);
    // Split the two causes: an unknown repo and a repo that simply has no scan
    // yet need different next steps.
    if (!repo) throw notFound({ data: { reason: "repo" } });
    if (!scan) throw notFound({ data: { reason: "scan", repoName: repo.full_name } });
    return { repo, scan };
  },
});

function FixPage() {
  const { repo, scan } = Route.useLoaderData();
  const { fixes } = Route.useSearch();
  const navigate = Route.useNavigate();
  const scanFixIds = useMemo(() => new Set(scan.issues.map((i) => i.fixId)), [scan]);
  const packOpts = useMemo(() => {
    const isNodeProject = !isNonNodeFramework(repo.framework);
    const language = frameworkToProjectLanguage(repo.framework);
    return { language, isNodeProject };
  }, [repo.framework]);

  useEffect(() => {
    setBranchName(defaultFixBranchName());
  }, [repo.full_name]);
  const bundledReadme = isReadmeBundledWithEnvExample(scanFixIds);
  // Lets a caller outside the normal scan flow (e.g. the live-site scan's "Fix PR" link)
  // request a specific fix directly via ?fixes=. Gated on isAutoFixableFixId + a real
  // FIX_DETAILS entry so a typo'd/garbage id can't render a broken checkbox — everything
  // reachable through in-app navigation is unaffected, since those fixIds are already in
  // scanFixIds and therefore already included below.
  const requestedExtraFixIds = useMemo(
    () =>
      fixes
        .split(",")
        .map((s) => s.trim())
        .filter((id) => id && !scanFixIds.has(id) && isAutoFixableFixId(id) && FIX_DETAILS[id]),
    [fixes, scanFixIds],
  );
  const availableFixes = useMemo(() => {
    const fromScan = Object.entries(FIX_DETAILS).filter(
      ([id]) => scanFixIds.has(id) && !isBundledReadmeFix(id, scanFixIds),
    );
    const extra = requestedExtraFixIds.map((id) => [id, FIX_DETAILS[id]!] as const);
    return [...fromScan, ...extra];
  }, [scanFixIds, requestedExtraFixIds]);
  const initial = fixes
    ? fixes.split(",").filter(Boolean)
    : availableFixes.slice(0, 4).map(([id]) => id);
  const [selected, setSelected] = useState<string[]>(initial);
  const effectiveSelected = useMemo(
    () => expandBundledFixIds(selected, scanFixIds),
    [selected, scanFixIds],
  );
  const [branchName, setBranchName] = useState(defaultFixBranchName);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [realDiffs, setRealDiffs] = useState<FileDiff[] | null>(null);
  const [previewInsight, setPreviewInsight] = useState<FixPreviewInsight | null>(null);
  const [verificationNotes, setVerificationNotes] = useState<
    { fixId: string; status: string; note: string }[]
  >([]);
  const [diffsLoading, setDiffsLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const loadingMessage = useRotatingMessage(diffsLoading);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Approximate file/dep counts from templates (instant, no server call)
  const applyPack = (packId: string) => {
    const pack = FIX_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    const ids = packFixIdsAvailable(pack, scanFixIds, packOpts);
    setSelected(ids);
  };

  const availablePacks = useMemo(
    () => getAvailablePacks(scanFixIds, packOpts),
    [scanFixIds, packOpts],
  );

  const scanRiskByFixId = useMemo(
    () =>
      buildFixRiskMap(
        scan.issues.map((i) => ({
          fixId: i.fixId,
          riskLevel: i.riskLevel,
          severity: i.severity,
        })),
      ),
    [scan.issues],
  );

  const fixDetail = useCallback(
    (id: string) => getFixPreviewDetails(id, repo.framework) ?? FIX_DETAILS[id],
    [repo.framework],
  );

  const preview = useMemo(() => {
    const added = new Set<string>();
    const changed = new Set<string>();
    const deps = new Set<string>();
    effectiveSelected.forEach((id) => {
      const f = fixDetail(id);
      if (!f) return;
      f.files_added.forEach((x) => added.add(x));
      f.files_changed.forEach((x) => changed.add(x));
      f.deps.forEach((x) => deps.add(x));
    });
    return { added: [...added], changed: [...changed], deps: [...deps] };
  }, [effectiveSelected, scanRiskByFixId, fixDetail]);

  const fixPlan = useMemo(
    () =>
      buildFixPlanPreview({
        fixIds: effectiveSelected,
        branchName,
        filesAdded: preview.added,
        filesChanged: preview.changed,
        deps: preview.deps,
        effort: selected.length,
        language: packOpts.language,
      }),
    [effectiveSelected, branchName, preview, packOpts.language],
  );

  // Real diffs fetched from the server — debounced so rapid checkbox clicks don't spam
  useEffect(() => {
    if (effectiveSelected.length === 0) {
      setRealDiffs([]);
      setPreviewInsight(null);
      setVerificationNotes([]);
      setPreviewError(null);
      return;
    }
    setDiffsLoading(true);
    setPreviewError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await getFixPreviewFn({
          data: { repoId: repo.id, fixIds: effectiveSelected, scanId: scan.id },
        });
        const payload = result as {
          diffs: FileDiff[];
          insight?: FixPreviewInsight | null;
          verificationNotes?: { fixId: string; status: string; note: string }[];
        };
        setRealDiffs(payload.diffs);
        setPreviewInsight(payload.insight ?? null);
        setVerificationNotes(payload.verificationNotes ?? []);
      } catch (err) {
        setRealDiffs(null); // fall back to template diffs on error
        setPreviewError(
          err instanceof Error ? err.message : "Failed to build preview. Please try again.",
        );
      } finally {
        setDiffsLoading(false);
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [effectiveSelected, repo.id, scan.id, retryToken]);

  // Use real diffs when available, fall back to template diffs only when not loading.
  // For AI fixes the server only returns the package.json change — supplement with
  // mock diffs so users see the AI-generated file that will be created.
  const displayDiffs: FileDiff[] = useMemo(() => {
    if (diffsLoading) return [];
    if (realDiffs !== null) return realDiffs;
    const diffs: FileDiff[] = [];
    effectiveSelected.forEach((id) => {
      if (DETERMINISTIC_AUDITOR_FIX_IDS.has(id) || AI_FIX_IDS.has(id)) return;
      FIX_DETAILS[id]?.diffs.forEach((d) => diffs.push(d));
    });
    return diffs;
  }, [realDiffs, diffsLoading, effectiveSelected]);

  const hasRealPreview = realDiffs !== null && !diffsLoading;
  const canGenerate =
    selected.length > 0 &&
    hasRealPreview &&
    (displayDiffs.length > 0 ||
      effectiveSelected.some((id) => AI_FIX_IDS.has(id) && !DETERMINISTIC_AUDITOR_FIX_IDS.has(id)));

  // Use real diff paths once loaded — show nothing while loading to avoid flicker
  const fileListAdded =
    realDiffs !== null
      ? [
          ...new Set([
            ...realDiffs.filter((d) => d.status === "added").map((d) => d.path),
            ...effectiveSelected.flatMap((id) =>
              AI_FIX_IDS.has(id) ? (fixDetail(id)?.files_added ?? []) : [],
            ),
          ]),
        ]
      : [];
  const fileListChanged =
    realDiffs !== null ? realDiffs.filter((d) => d.status === "modified").map((d) => d.path) : [];

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { jobId } = await createAndStartFixRequest({
        data: {
          repoId: repo.id,
          scanId: scan.id,
          fixes: effectiveSelected.join(","),
          branchName,
          estFilesAdded: preview.added.length,
          estFilesChanged: preview.changed.length,
          estDeps: preview.deps.length,
          effortScore: 0,
        },
      });
      navigate({
        to: "/repo/$repoId/job/$jobId",
        params: { repoId: repo.id, jobId },
        search: { from: "" },
        replace: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create job. Please try again.";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const { data: sessionUser } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: Infinity,
  });
  const { blocked: sandboxBlocked } = useSandboxGate({ scan, repoId: repo.id });

  if (sandboxBlocked) {
    return <SandboxGateNotice user={sessionUser} repoId={repo.id} repoName={repo.name} />;
  }

  return (
    <RepoLayout user={sessionUser} repoId={repo.id} repoName={repo.name}>
      <div>
        <DashboardPageHeader
          eyebrow="Fix · Pull request"
          title="Fix PR"
          description={
            <>
              Turn selected readiness gaps into a reviewable GitHub pull request. Changes are
              generated, previewed, and verified without pushing directly to{" "}
              <span className="font-mono">main</span>.
            </>
          }
        />

        <div className="grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-3">
          <div className="bg-surface px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-data">
              01 · Choose
            </p>
            <p className="mt-1 text-sm text-foreground">
              Pick findings or a fix pack from the verdict.
            </p>
          </div>
          <div className="bg-surface px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-data">
              02 · Generate
            </p>
            <p className="mt-1 text-sm text-foreground">
              Preview the exact files and diff before anything ships.
            </p>
          </div>
          <div className="bg-surface px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-data">
              03 · Verify &amp; PR
            </p>
            <p className="mt-1 text-sm text-foreground">
              Sandbox-check the patch, then open a reviewable PR.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3 sm:p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-data" />
          <div className="text-sm">
            <div className="font-medium text-foreground">Separate from sandbox scan</div>
            <div className="mt-0.5 text-muted-foreground">
              Sandbox build proves the <em>current</em> repo. Fix PR proposes changes, re-verifies
              those changes, then opens a PR you merge yourself.
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Mobile: compact summary — full picker is desktop-only */}
          <div className="lg:hidden rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {selected.length} fix{selected.length !== 1 ? "es" : ""} selected
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {selected
                    .map((id) => FIX_DETAILS[id]?.label ?? id)
                    .slice(0, 2)
                    .join(" · ")}
                  {selected.length > 2 ? ` +${selected.length - 2} more` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-xs font-medium">Free</span>
                <Link
                  to="/repo/$repoId"
                  params={{ repoId: repo.id }}
                  className="text-xs text-primary hover:underline"
                >
                  Change
                </Link>
              </div>
            </div>
          </div>

          <div className="hidden lg:block rounded-xl border border-border bg-card p-5">
            <h3 className="font-display text-sm font-semibold">Fixes ({selected.length})</h3>
            <div className="mt-3 space-y-2">
              {availableFixes.map(([id, f]) => {
                const isSel = selected.includes(id);
                return (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() =>
                        setSelected((s) =>
                          s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
                        )
                      }
                      className="h-4 w-4 accent-[color:var(--color-primary)]"
                    />
                    <span className="flex-1">
                      {(id === "env-example" || id === "env-example-ai") && bundledReadme
                        ? "Add .env.example + setup docs"
                        : f.label}
                    </span>
                  </label>
                );
              })}
            </div>

            {availablePacks.length > 0 && (
              <div className="mt-5 border-t border-border pt-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  <Layers className="h-3.5 w-3.5" /> Fix packs
                </div>
                <div className="mt-2 space-y-2">
                  {availablePacks.map((pack) => {
                    const ids = packFixIdsAvailable(pack, scanFixIds, packOpts);
                    return (
                      <button
                        key={pack.id}
                        type="button"
                        onClick={() => applyPack(pack.id)}
                        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-left text-xs hover:bg-muted transition"
                      >
                        <div className="font-medium">{pack.name}</div>
                        <div className="mt-0.5 text-muted-foreground line-clamp-2">
                          {pack.description}
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-muted-foreground">{ids.length} fixes</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-5">
            {effectiveSelected.length > 0 && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ClipboardList className="h-4 w-4 text-primary" /> Fix plan
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{fixPlan.summary}</p>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-md border border-border bg-card px-3 py-2">
                    <span className="text-muted-foreground">Risk</span>
                    <div className="font-medium capitalize">{fixPlan.riskLevel}</div>
                  </div>
                  <div className="rounded-md border border-border bg-card px-3 py-2">
                    <span className="text-muted-foreground">Fixes</span>
                    <div className="font-medium">{fixPlan.effort}</div>
                  </div>
                </div>
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-primary">Test & rollback notes</summary>
                  <ul className="mt-2 list-disc pl-4 space-y-1 text-muted-foreground">
                    {[...fixPlan.testInstructions, ...fixPlan.rollbackNotes].map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
              </div>
            )}

            {(previewInsight || diffsLoading) && (
              <FixPreviewInsightPanel insight={diffsLoading ? null : previewInsight} />
            )}

            {previewError && !diffsLoading && (
              <div className="rounded-xl border border-critical/30 bg-critical/10 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-critical">
                  <AlertTriangle className="h-4 w-4" />
                  Couldn't build the preview
                </div>
                <p className="text-xs text-muted-foreground">{previewError}</p>
                <button
                  type="button"
                  onClick={() => setRetryToken((t) => t + 1)}
                  className="text-xs font-medium text-primary underline"
                >
                  Retry
                </button>
              </div>
            )}

            <CIConfidenceWarning
              selectedFixIds={effectiveSelected}
              deployTargets={scan?.stackDetected?.deployTargets ?? []}
              isMonorepo={(previewInsight?.monorepoPackages.length ?? 0) > 1}
            />

            <div className="rounded-xl border border-border bg-card p-5 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <GitBranch className="h-4 w-4 text-primary" />
                <span className="font-medium">Branch name</span>
              </div>
              <Input
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="font-mono text-sm"
                spellCheck={false}
                aria-label="Pull request branch name"
              />
              <p className="text-xs text-muted-foreground">
                Opens on a new branch — edit if you already used this name today.
              </p>
            </div>

            <PreviewBlock
              icon={<FilePlus2 className="h-4 w-4 text-primary" />}
              title="Files added"
              items={fileListAdded}
              mono
              loading={diffsLoading}
            />
            <PreviewBlock
              icon={<FileEdit className="h-4 w-4 text-warning" />}
              title="Files changed"
              items={fileListChanged}
              mono
              loading={diffsLoading}
            />
            <PreviewBlock
              icon={<Package className="h-4 w-4 text-primary" />}
              title="Dependencies to install"
              items={preview.deps}
              mono
            />

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold">File diffs</h3>
                <span className="text-xs text-muted-foreground flex items-center gap-2">
                  {diffsLoading && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                  {displayDiffs.length} file{displayDiffs.length === 1 ? "" : "s"}
                </span>
              </div>
              {displayDiffs.length === 0 && !diffsLoading ? (
                <div className="space-y-3 text-sm text-muted-foreground">
                  {verificationNotes.length > 0 ? (
                    verificationNotes.map((n) => (
                      <div
                        key={n.fixId}
                        className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3"
                      >
                        <p className="font-medium text-foreground">
                          {FIX_DETAILS[n.fixId]?.label ?? n.fixId}
                        </p>
                        <p className="mt-1">{n.note}</p>
                        {n.status === "verified" && displayDiffs.length === 0 && (
                          <p className="mt-2 text-xs">
                            No PR needed —{" "}
                            <Link
                              to="/repo/$repoId"
                              params={{ repoId: repo.id }}
                              className="text-primary underline"
                            >
                              re-scan your repo
                            </Link>{" "}
                            to clear this finding.
                          </p>
                        )}
                      </div>
                    ))
                  ) : (
                    <>
                      <span className="hidden lg:inline">
                        Select a fix on the left to preview its diff.
                      </span>
                      <span className="lg:hidden">Preview will appear once diffs are ready.</span>
                    </>
                  )}
                </div>
              ) : diffsLoading && displayDiffs.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="transition-all duration-500">{loadingMessage}</span>
                  <span className="text-xs text-muted-foreground/60">
                    This usually takes 10–30 s
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  {displayDiffs.map((d, i) => {
                    const isAiPlaceholder = effectiveSelected.some(
                      (id) => AI_FIX_IDS.has(id) && FIX_DETAILS[id]?.ai_output_file === d.path,
                    );
                    if (isAiPlaceholder) {
                      return (
                        <div
                          key={`${d.path}-${i}`}
                          className="rounded-lg border border-primary/20 bg-primary/5 p-4"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <code className="text-xs font-mono text-muted-foreground">
                              {d.path}
                            </code>
                            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
                              AI generated
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Sparkles className="h-4 w-4 text-primary shrink-0" />
                            AI will analyse your repo and write this file based on your actual code
                            when you click <strong>Generate PR</strong>.
                          </div>
                        </div>
                      );
                    }
                    return <DiffView key={`${d.path}-${i}`} diff={d} />;
                  })}
                </div>
              )}
            </div>

            {effectiveSelected.includes("monitoring") && (
              <div className="rounded-xl border border-foreground/25 bg-muted px-4 py-3 text-sm text-foreground">
                <p className="font-medium mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  After merging this PR
                </p>
                <ol className="list-decimal list-inside space-y-0.5 text-xs">
                  <li>
                    Sign up at{" "}
                    <a
                      href="https://sentry.io"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      sentry.io
                    </a>{" "}
                    (free)
                  </li>
                  <li>Create a project and copy your DSN</li>
                  <li>
                    Add{" "}
                    <code className="rounded bg-foreground/10 px-1 font-mono">
                      {repo.framework === "React Vite" ||
                      repo.framework === "Vite" ||
                      repo.framework === "React"
                        ? "VITE_SENTRY_DSN"
                        : "SENTRY_DSN"}
                    </code>{" "}
                    to your environment variables
                  </li>
                </ol>
              </div>
            )}

            {submitError && (
              <div className="rounded-md border border-critical/30 bg-critical/10 px-4 py-2.5 text-sm text-critical">
                {submitError}
              </div>
            )}

            <div className="sticky bottom-4 z-30 mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-card/90 p-4 backdrop-blur glow-primary">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm text-muted-foreground">
                  {fileListAdded.length} added · {fileListChanged.length} changed ·{" "}
                  {preview.deps.length} dep{preview.deps.length !== 1 ? "s" : ""}
                </div>
                <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs">
                  <span className="text-success font-medium">
                    Runs on your configured providers
                  </span>
                </div>
              </div>
              <button
                onClick={submit}
                disabled={submitting || !canGenerate}
                title={
                  diffsLoading
                    ? loadingMessage
                    : previewError
                      ? `Preview failed: ${previewError}`
                      : !canGenerate && effectiveSelected.some((id) => AI_FIX_IDS.has(id))
                        ? "Review the generated diff preview before opening a PR"
                        : !canGenerate && hasRealPreview && displayDiffs.length === 0
                          ? "Nothing to patch — re-scan your repo if this finding is already fixed"
                          : undefined
                }
                className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                <GitPullRequest className="h-4 w-4" />
                {submitting ? "Starting…" : "Generate PR"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </RepoLayout>
  );
}

function PreviewBlock({
  icon,
  title,
  items,
  mono,
  loading,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  mono?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="font-display text-sm font-semibold">{title}</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : items.length}
        </span>
      </div>
      {loading ? (
        <div className="mt-3 space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-7 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-3 text-sm text-muted-foreground">Nothing in this category.</div>
      ) : (
        <ul
          className={`mt-3 grid gap-1.5 ${mono ? "font-mono text-xs" : "text-sm"} sm:grid-cols-2`}
        >
          {items.map((x) => (
            <li key={x} className="rounded-md border border-border bg-surface px-2.5 py-1.5">
              {x}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CI_FIX_IDS = new Set(["ci-ai", "github-actions"]);

function CIConfidenceWarning({
  selectedFixIds,
  deployTargets,
  isMonorepo,
}: {
  selectedFixIds: string[];
  deployTargets: string[];
  isMonorepo: boolean;
}) {
  const hasCIFix = selectedFixIds.some((id) => CI_FIX_IDS.has(id));
  const hasExistingCI = deployTargets.includes("GitHub Actions");

  if (!hasCIFix) return null;

  const warnings: string[] = [];
  if (hasExistingCI) {
    warnings.push(
      "This repo already has a GitHub Actions workflow. LaunchReadyy will not overwrite it — the CI fix will be skipped. Remove or rename the existing workflow first if you want a new one generated.",
    );
  }
  if (isMonorepo) {
    warnings.push(
      "Monorepo detected. The generated CI runs jobs per package — verify the package paths match your actual workspace layout before merging.",
    );
  }

  if (warnings.length === 0) return null;

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-warning">
        <AlertTriangle className="h-4 w-4" />
        Review before merging
      </div>
      <ul className="space-y-1.5 text-xs text-muted-foreground">
        {warnings.map((w) => (
          <li key={w} className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
            {w}
          </li>
        ))}
      </ul>
    </div>
  );
}
