import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { RepoNotFound } from "@/components/app/RepoNotFound";
import { RepoLayout } from "@/components/layouts/RepoLayout";
import { EmptyState } from "@/components/app/EmptyState";
import { useQuery } from "@tanstack/react-query";
import { getSessionUserFn } from "@/lib/api/session.functions";
import { AuthErrorScreen } from "@/components/auth-error-screen";
import { ScoreRing, SeverityBadge } from "@/components/ui-bits";
import { getRepoFn } from "@/lib/api/db.functions";
import { getArchScanFn, runArchScanFn } from "@/lib/api/github.functions";
import type { ArchFinding } from "@/lib/arch-scanner.server";
import { isArchScanSupported, ARCH_SCAN_UNSUPPORTED_MESSAGE } from "@/lib/project-context";
import {
  ArrowLeft,
  BrainCircuit,
  FileX,
  PackageX,
  FileWarning,
  Layers,
  Copy,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { DashboardPageHeader, dashboardPrimaryAction } from "@/components/app/DashboardKit";

export const Route = createFileRoute("/repo/$repoId_/arch")({
  head: () => ({ meta: [{ title: "Architecture — LaunchReadyy" }] }),
  component: ArchPage,
  notFoundComponent: () => <RepoNotFound reason="repo" />,
  errorComponent: ({ error }) => <AuthErrorScreen error={error} />,
  loader: async ({ params }) => {
    const [repo, archScan] = await Promise.all([
      getRepoFn({ data: { repoId: params.repoId } }),
      getArchScanFn({ data: { repoId: params.repoId } }).catch(() => null),
    ]);
    if (!repo) throw notFound();
    return { repo, archScan };
  },
});

// ─── Finding type config ──────────────────────────────────────────────────────

const FINDING_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; label: string; color: string }
> = {
  "circular-dep": { icon: AlertCircle, label: "Circular dependency", color: "text-critical" },
  "dead-file": { icon: FileX, label: "Dead file", color: "text-muted-foreground" },
  "unused-package": { icon: PackageX, label: "Unused package", color: "text-muted-foreground" },
  "oversized-file": { icon: FileWarning, label: "Oversized file", color: "text-warning" },
  "separation-issue": { icon: Layers, label: "Separation of concerns", color: "text-warning" },
  "duplicate-logic": { icon: Copy, label: "Duplicate logic", color: "text-primary" },
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// ─── Page component ───────────────────────────────────────────────────────────

function ArchPage() {
  const { repo, archScan: initial } = Route.useLoaderData();
  const { data: sessionUser } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: Infinity,
  });
  const [archScan, setArchScan] = useState(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archSupported = isArchScanSupported(repo.framework);

  async function handleRun() {
    if (!archSupported) return;
    setRunning(true);
    setError(null);
    try {
      const result = await runArchScanFn({ data: { repoId: repo.id } });
      setArchScan(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Analysis failed.";
      setError(msg);
    } finally {
      setRunning(false);
    }
  }

  const sortedFindings = archScan
    ? [...archScan.findings].sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
      )
    : [];

  return (
    <RepoLayout user={sessionUser} repoId={repo.id} repoName={repo.name}>
      <div>
        <DashboardPageHeader
          eyebrow="Verdict · Structure"
          title="Architecture analysis"
          description="Map imports, surface structural risks, and explain complex findings across your codebase."
          actions={
            <button
              onClick={handleRun}
              disabled={running || !archSupported}
              title={!archSupported ? ARCH_SCAN_UNSUPPORTED_MESSAGE : undefined}
              className={dashboardPrimaryAction}
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {running ? "Scanning…" : archScan ? "Re-scan" : "Run analysis"}
            </button>
          }
        />

        {error && (
          <div className="mt-4 rounded-md border border-critical/30 bg-critical/10 px-4 py-2.5 text-sm text-critical">
            {error}
          </div>
        )}

        {!archSupported && (
          <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
            {ARCH_SCAN_UNSUPPORTED_MESSAGE}
          </div>
        )}

        {!archScan && !running && archSupported && (
          <div className="mt-6">
            <EmptyState
              icon={BrainCircuit}
              title="No architecture analysis yet"
              body={`Nothing has been analyzed for ${repo.full_name} so far. This scan reads the import graph and flags structure problems the readiness score does not cover.`}
              steps={[
                "Hit Run analysis above — we fetch the source files and map every import.",
                "Findings come back sorted by severity: dead files, cycles, oversized modules, duplication.",
                "Complex findings get an AI explanation so you know why each one matters.",
              ]}
              secondary="Takes 10–20 seconds. Re-run any time after a refactor."
            />
          </div>
        )}

        {running && (
          <div className="mt-16 flex flex-col items-center text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">
              Fetching source files and analyzing structure…
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Complex findings are explained by AI. This may take 10–20 s.
            </p>
          </div>
        )}

        {archScan && !running && (
          <div className="mt-8 grid gap-6 lg:grid-cols-[240px_1fr]">
            {/* Left panel — score + summary */}
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex flex-col items-center">
                  <ScoreRing score={archScan.score} />
                  <div className="mt-4 text-center">
                    <div className="font-display text-base font-semibold">Architecture Score</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {archScan.scannedFiles} file{archScan.scannedFiles !== 1 ? "s" : ""} analyzed
                      · {archScan.createdAt}
                    </div>
                  </div>
                </div>
                <div className="mt-5 space-y-1.5 border-t border-border pt-4 text-xs">
                  {Object.entries(FINDING_CONFIG).map(([type, cfg]) => {
                    const count = sortedFindings.filter((f) => f.type === type).length;
                    const Icon = cfg.icon;
                    return (
                      <div key={type} className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Icon className={`h-3 w-3 ${cfg.color}`} />
                          {cfg.label}
                        </div>
                        <span className={count > 0 ? cfg.color : "text-success"}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Link
                to="/repo/$repoId"
                params={{ repoId: repo.id }}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-surface"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to issues
              </Link>
            </div>

            {/* Right panel — findings list */}
            <div>
              {sortedFindings.length === 0 ? (
                <div className="rounded-xl border border-success/30 bg-success/5 p-10 text-center">
                  <div className="font-display text-lg font-semibold text-success">
                    Clean architecture
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    No structural issues detected in the {archScan.scannedFiles} files analyzed.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    {sortedFindings.length} finding{sortedFindings.length !== 1 ? "s" : ""} — sorted
                    by severity
                  </div>
                  {sortedFindings.map((finding) => (
                    <FindingCard key={finding.id} finding={finding} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </RepoLayout>
  );
}

// ─── Finding card ─────────────────────────────────────────────────────────────

function FindingCard({ finding }: { finding: ArchFinding }) {
  const [open, setOpen] = useState(false);
  const cfg = FINDING_CONFIG[finding.type];
  const Icon = cfg?.icon ?? AlertCircle;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-start gap-4 p-4 text-left hover:bg-surface transition cursor-pointer"
      >
        <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${cfg?.color ?? "text-muted-foreground"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">{finding.title}</span>
            <SeverityBadge severity={finding.severity} />
            {finding.aiExplanation && (
              <span className="flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                <Sparkles className="h-2.5 w-2.5" /> AI
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{finding.detail}</p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4 space-y-3">
          <p className="text-sm text-muted-foreground">{finding.detail}</p>

          {(finding.foundEvidence || (finding.checkedFor && finding.checkedFor.length > 0)) && (
            <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">What we checked</p>
              <p className="mt-1">
                {finding.foundEvidence ?? `Checked: ${finding.checkedFor!.join(", ")}. None found.`}
              </p>
              {finding.checkedFor && finding.checkedFor.length > 0 && finding.foundEvidence && (
                <p className="mt-1 text-[11px]">Looked for: {finding.checkedFor.join(", ")}</p>
              )}
            </div>
          )}

          {finding.files.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Affected files
              </div>
              <div className="flex flex-wrap gap-1.5">
                {finding.files.map((f) => (
                  <span
                    key={f}
                    className="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-xs"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {finding.aiExplanation && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
                <BrainCircuit className="h-3.5 w-3.5" /> AI explanation
              </div>
              <p className="text-sm text-foreground">{finding.aiExplanation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
