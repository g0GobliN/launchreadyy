import { createFileRoute } from "@tanstack/react-router";
import { RepoLayout } from "@/components/layouts/RepoLayout";
import { RepoNotFound } from "@/components/app/RepoNotFound";
import { useQuery } from "@tanstack/react-query";
import { LiveSiteSecurityView } from "@/components/security/live-site-security-view";
import { getSessionUserFn } from "@/lib/api/session.functions";
import { listLiveSiteScansFn } from "@/lib/api/security.functions";
import { getLiveSiteMonitorsFn } from "@/lib/api/monitor.functions";
import { LiveSiteMonitoringPanel } from "@/components/security/live-site-monitoring-panel";
import { getRepoFn } from "@/lib/api/db.functions";
import { z } from "zod";
import { DashboardPageHeader } from "@/components/app/DashboardKit";
import type { LiveScanPoint } from "@/lib/live-scan-points";

type LoaderScan = {
  id: string;
  domain: string;
  status: string;
  security_score: number | null;
  created_at: string;
  finished_at: string | null;
};
import type { LiveSiteMonitorState } from "@/lib/services/security/live-site-monitor.server";

const searchSchema = z.object({
  scan: z.string().optional(),
});

export const Route = createFileRoute("/repo/$repoId_/live-security")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Live website security — LaunchReadyy" }] }),
  component: LiveSecurityPage,
  loader: async ({ params }) => {
    const repo = await getRepoFn({ data: { repoId: params.repoId } }).catch(() => null);
    const [history, monitors] = repo
      ? await Promise.all([
          listLiveSiteScansFn({
            data: { repoId: params.repoId, limit: 10 },
          }).catch(() => []) as Promise<LoaderScan[]>,
          getLiveSiteMonitorsFn({ data: { repoId: params.repoId } }).catch(() => []) as Promise<
            LiveSiteMonitorState[]
          >,
        ])
      : [[], []];
    return { repo, history, monitors };
  },
});

function LiveSecurityPage() {
  const { repo, history, monitors } = Route.useLoaderData();
  const { repoId } = Route.useParams();
  const { scan: initialScanId } = Route.useSearch();
  const { data: sessionUser } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: Infinity,
  });

  if (!repo) {
    return <RepoNotFound reason="repo" />;
  }

  return (
    <RepoLayout user={sessionUser} repoId={repoId} repoName={repo.name}>
      <div>
        <DashboardPageHeader
          eyebrow="Verdict · Production security"
          title="Live website scan"
          description="Know what your deployed site exposes before customers do."
        />

        {monitors.length > 0 && (
          <div>
            <LiveSiteMonitoringPanel monitors={monitors} history={history} />
          </div>
        )}

        <div className="mt-6">
          <LiveSiteSecurityView repoId={repoId} initialScanId={initialScanId} history={history} />
        </div>
      </div>
    </RepoLayout>
  );
}
