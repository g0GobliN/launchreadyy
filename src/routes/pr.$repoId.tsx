import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { getLatestPrJobFn, getRepoFn } from "@/lib/api/db.functions";

/** Legacy URL — redirects to the real fix job page (never shows a fake PR). */
export const Route = createFileRoute("/pr/$repoId")({
  head: () => ({ meta: [{ title: "Redirecting… — LaunchReadyy" }] }),
  loader: async ({ params }) => {
    const repo = await getRepoFn({ data: { repoId: params.repoId } });
    if (!repo) throw notFound();

    const job = await getLatestPrJobFn({ data: { repoId: params.repoId } });
    if (job) {
      throw redirect({
        to: "/repo/$repoId/job/$jobId",
        params: { repoId: params.repoId, jobId: job.id },
        search: { from: "" },
      });
    }

    throw redirect({
      to: "/repo/$repoId",
      params: { repoId: params.repoId },
    });
  },
  component: () => null,
});
