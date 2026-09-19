import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { RepoNotFound, type NotFoundReason } from "@/components/app/RepoNotFound";
import { RepoLayout } from "@/components/layouts/RepoLayout";
import { DashboardPageHeader } from "@/components/app/DashboardKit";
import { AuthErrorScreen } from "@/components/auth-error-screen";
import { useQuery } from "@tanstack/react-query";
import { getSessionUserFn } from "@/lib/api/session.functions";
import {
  acceptRiskFn,
  getRepoFn,
  getRiskAcceptancesFn,
  getScanFn,
  revokeRiskAcceptanceFn,
} from "@/lib/api/db.functions";
import { launchVerdictForScan, pickTopLaunchBlockers } from "@/lib/launch-blockers";
import { isReadmeBundledWithEnvExample } from "@/lib/fix-bundling";
import { isAutoFixableFixId } from "@/lib/readiness/enrich-finding";
import { ReadinessSections } from "@/components/readiness-panel";
import { AlertOctagon, ArrowRight, CheckCircle2, ShieldAlert, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useSandboxGate } from "@/hooks/useSandboxGate";
import { SandboxGateNotice } from "@/components/app/SandboxGateNotice";

export const Route = createFileRoute("/repo/$repoId/blockers")({
  head: () => ({ meta: [{ title: "Launch blockers — LaunchReadyy" }] }),
  component: BlockersPage,
  notFoundComponent: ({ data }) => {
    const d = data as { reason?: NotFoundReason; repoName?: string } | undefined;
    return <RepoNotFound reason={d?.reason ?? "repo"} repoName={d?.repoName} />;
  },
  errorComponent: ({ error }) => <AuthErrorScreen error={error} />,
  loader: async ({ params }) => {
    const [repo, scan, acceptances] = await Promise.all([
      getRepoFn({ data: { repoId: params.repoId } }),
      getScanFn({ data: { repoId: params.repoId } }),
      getRiskAcceptancesFn({ data: { repoId: params.repoId } }).catch(() => []),
    ]);
    if (!repo) throw notFound({ data: { reason: "repo" } });
    if (!scan) throw notFound({ data: { reason: "blockers", repoName: repo.full_name } });
    return { repo, scan, acceptances };
  },
});

const VERDICT_STYLE = {
  not_ready: {
    border: "border-critical/40",
    bg: "bg-critical/5",
    text: "text-critical",
    Icon: AlertOctagon,
  },
  conditional: {
    border: "border-warning/40",
    bg: "bg-warning/5",
    text: "text-warning",
    Icon: ShieldAlert,
  },
  ready: {
    border: "border-success/40",
    bg: "bg-success/5",
    text: "text-success",
    Icon: CheckCircle2,
  },
};

function BlockersPage() {
  const { repo, scan, acceptances: initialAcceptances } = Route.useLoaderData();
  const [selected] = useState<Set<string>>(new Set());
  const [acceptances, setAcceptances] = useState(initialAcceptances ?? []);
  const { data: sessionUser } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: Infinity,
  });
  const { blocked: sandboxBlocked } = useSandboxGate({ scan, repoId: repo.id });

  const visibleIssues = useMemo(() => {
    const now = Date.now();
    const activeAcceptanceFixIds = new Set(
      acceptances
        .filter((a) => {
          if (a.reasonType === "temporary") {
            const age = now - new Date(a.acceptedAt).getTime();
            return age < 7 * 24 * 60 * 60 * 1000;
          }
          return true;
        })
        .map((a) => a.fixId),
    );
    const scanFixIds = new Set(scan.issues.map((i) => i.fixId));
    const bundledReadme = isReadmeBundledWithEnvExample(scanFixIds);
    return scan.issues
      .filter((i) => !(bundledReadme && i.fixId === "readme-ai"))
      .filter((i) => !activeAcceptanceFixIds.has(i.fixId))
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  }, [scan.issues, acceptances]);

  const allBlockers = pickTopLaunchBlockers(visibleIssues, 20);
  const fixableIds = allBlockers.filter((b) => isAutoFixableFixId(b.fixId)).map((b) => b.fixId);
  const verdict = launchVerdictForScan(
    scan.score,
    visibleIssues,
    scan.checklist?.filter((c) => c.status === "fail").length ?? 0,
    scan.sandboxVerify?.status,
  );
  const s = VERDICT_STYLE[verdict.verdict];

  if (sandboxBlocked) {
    return <SandboxGateNotice user={sessionUser} repoId={repo.id} repoName={repo.name} />;
  }

  return (
    <RepoLayout user={sessionUser} repoId={repo.id} repoName={repo.name}>
      <div className="mx-auto max-w-3xl">
        <DashboardPageHeader
          eyebrow="Fix · Priorities"
          title="Launch blockers"
          description="The highest-priority risks to resolve before this repository ships."
        />
        <div className={`flex items-start gap-3 rounded-xl border ${s.border} ${s.bg} p-5`}>
          <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg ${s.bg}`}>
            <s.Icon className={`h-5 w-5 ${s.text}`} />
          </div>
          <div>
            <div className={`text-xs font-semibold uppercase tracking-widest ${s.text}`}>
              Launch verdict
            </div>
            <h1 className="font-display text-xl font-semibold">{verdict.headline}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{verdict.summary}</p>
          </div>
        </div>

        {visibleIssues.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              All prioritized risks
            </h2>
            <ReadinessSections
              issues={visibleIssues}
              selected={selected}
              onToggle={() => {}}
              onAcceptRisk={async ({ fixId, reasonType, note }) => {
                const result = await acceptRiskFn({
                  data: { repoId: repo.id, fixId, reasonType, note },
                });
                setAcceptances((prev) => [result, ...prev]);
              }}
            />
          </div>
        )}

        {fixableIds.length > 0 && (
          <div className="mt-8 flex gap-3">
            <Link
              to="/repo/$repoId/fix"
              params={{ repoId: repo.id }}
              search={{ fixes: fixableIds.join(",") }}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Wrench className="h-4 w-4" />
              Fix all auto-fixable ({fixableIds.length})
            </Link>
            <Link
              to="/repo/$repoId/report"
              params={{ repoId: repo.id }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 text-sm hover:bg-muted"
            >
              Launch report <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {acceptances.length > 0 && (
          <details className="mt-8 rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
              Skipped issues ({acceptances.length})
            </summary>
            <div className="mt-3 space-y-2">
              {acceptances.map((acceptance) => {
                const matchedIssue = scan.issues.find((i) => i.fixId === acceptance.fixId);
                const reasonLabel: Record<string, string> = {
                  temporary: "I'll fix it later",
                  wont_fix: "Not a priority right now",
                  false_positive: "Scanner got this wrong",
                  not_applicable: "Doesn't apply to my project",
                };
                return (
                  <div
                    key={acceptance.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div>
                      <div>{matchedIssue?.title ?? acceptance.fixId}</div>
                      <div className="text-xs text-muted-foreground">
                        {reasonLabel[acceptance.reasonType] ?? acceptance.reasonType} ·{" "}
                        {formatDistanceToNow(new Date(acceptance.acceptedAt), { addSuffix: true })}
                        {acceptance.note && ` · ${acceptance.note}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={async () => {
                        await revokeRiskAcceptanceFn({ data: { id: acceptance.id } });
                        setAcceptances((prev) => prev.filter((a) => a.id !== acceptance.id));
                      }}
                    >
                      Undo
                    </button>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </RepoLayout>
  );
}
