import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AppLayout } from "@/components/layouts/AppLayout";
import { EmptyState } from "@/components/app/EmptyState";
import { loadDashboardFn } from "@/lib/api/github.functions";
import { FileText } from "lucide-react";
import { DashboardPageHeader } from "@/components/app/DashboardKit";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports — LaunchReadyy" }] }),
  loader: async () => {
    const data = await loadDashboardFn();
    if (!data.user) throw redirect({ to: "/dashboard" });
    return data;
  },
  component: ReportsPage,
});

function scoreColor(score: number) {
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-critical";
}

function ReportsPage() {
  const { user, recentScans } = Route.useLoaderData();

  return (
    <AppLayout user={user} breadcrumbs={[{ label: "Reports" }]}>
      <DashboardPageHeader
        eyebrow="Deliver"
        title="Reports"
        description="Evidence-backed, sandbox-verified launch reports ready to review or share with stakeholders."
      />

      {recentScans.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={FileText}
            title="No reports yet"
            body="A report is the shareable version of a scan — score, evidence, and what was checked. None exist yet."
            steps={[
              "Scan a repository from Repositories.",
              "Open Production verdict to read the score and its evidence.",
              "Launch report turns that into a page you can share with anyone.",
            ]}
            action={{ label: "Choose a repository", to: "/repos" }}
          />
        </div>
      ) : (
        <div className="app-panel mt-5 divide-y divide-hairline overflow-hidden rounded-2xl">
          {recentScans.map((s) => (
            <Link
              key={s.repoId}
              to="/repo/$repoId/report"
              params={{ repoId: s.repoId }}
              className="flex items-center justify-between gap-4 bg-surface px-4 py-4 text-sm transition hover:bg-muted/40 sm:px-5"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-xs text-foreground">{s.repo}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{s.when}</div>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                {s.blockers > 0 && (
                  <span className="text-xs font-medium text-critical">
                    {s.blockers} blocker{s.blockers > 1 ? "s" : ""}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {s.checklistPassed}/{s.checklistTotal} checks
                </span>
                <span className={`text-lg font-semibold tabular-nums ${scoreColor(s.score)}`}>
                  {s.score}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
