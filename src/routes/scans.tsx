import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/layouts/AppLayout";
import { EmptyState } from "@/components/app/EmptyState";
import { ListPagination } from "@/components/app/ListPagination";
import { listScansPageFn } from "@/lib/api/db.functions";
import { getSessionUserFn } from "@/lib/api/session.functions";
import { formatDistanceToNow } from "date-fns";
import { Activity, ScanSearch } from "lucide-react";
import { z } from "zod";
import { DashboardPageHeader } from "@/components/app/DashboardKit";

const PAGE_SIZE = 20;

export const Route = createFileRoute("/scans")({
  head: () => ({ meta: [{ title: "Scans — LaunchReadyy" }] }),
  validateSearch: z.object({
    page: z.coerce.number().int().min(1).default(1),
  }),
  loaderDeps: ({ search: { page } }) => ({ page }),
  loader: async ({ deps }) => {
    const user = await getSessionUserFn();
    if (!user) throw redirect({ to: "/dashboard" });
    const list = await listScansPageFn({
      data: { page: deps.page, pageSize: PAGE_SIZE },
    });
    return { user, ...list };
  },
  component: ScansPage,
});

function scoreColor(score: number) {
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-critical";
}

function ScansPage() {
  const { user, items, total, page, pageSize } = Route.useLoaderData();
  const navigate = useNavigate({ from: "/scans" });

  return (
    <AppLayout user={user} breadcrumbs={[{ label: "Scans" }]}>
      <DashboardPageHeader
        eyebrow="Verification history"
        title="Scans"
        description={`Every verification run, most recent first — not only the latest per repository.${total > 0 ? ` ${total} total.` : ""}`}
      />

      {items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={ScanSearch}
            title="No scans yet"
            body="Every scan you run lands here, newest first. You have not scanned a repository yet."
            steps={[
              "Connect a repository from Repositories.",
              "Run a sandbox build so the score is backed by a real install and build.",
              "The finished scan appears here with its score and blockers.",
            ]}
            action={{ label: "Choose a repository", to: "/repos" }}
          />
        </div>
      ) : (
        <>
          <div className="app-panel mt-5 divide-y divide-hairline overflow-hidden rounded-2xl">
            {items.map((s, i) => (
              <div
                key={`${s.repo}-${s.when}-${i}`}
                className="flex items-center justify-between gap-4 bg-surface px-4 py-4 text-sm transition hover:bg-muted/40 sm:px-5"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-foreground">{s.repo}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(s.when), { addSuffix: true })}
                    {s.trigger === "monitor" && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium">
                        <Activity className="h-2.5 w-2.5" aria-hidden /> Automatic
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  {s.blockers > 0 && (
                    <span className="text-xs font-medium text-critical">
                      {s.blockers} blocker{s.blockers > 1 ? "s" : ""}
                    </span>
                  )}
                  {s.checklistPct != null && (
                    <span className="text-xs text-muted-foreground">
                      {s.checklistPct}% checklist
                    </span>
                  )}
                  <span className={`text-lg font-semibold tabular-nums ${scoreColor(s.score)}`}>
                    {s.score}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <ListPagination
            className="mt-4"
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={(p) => navigate({ search: (prev) => ({ ...prev, page: p }) })}
          />
        </>
      )}
    </AppLayout>
  );
}
