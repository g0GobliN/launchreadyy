import { createFileRoute, Link } from "@tanstack/react-router";
import { RepoLayout } from "@/components/layouts/RepoLayout";
import { EmptyState } from "@/components/app/EmptyState";
import { useQuery } from "@tanstack/react-query";
import { getSessionUserFn } from "@/lib/api/session.functions";
import { getRepoFn } from "@/lib/api/db.functions";
import { LaunchReportDocument } from "@/components/launch-report-document";
import { createLaunchReportShareFn, getLaunchReportFn } from "@/lib/api/launch-report.functions";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileText,
  Link2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/repo/$repoId_/report")({
  head: () => ({ meta: [{ title: "Launch Report — LaunchReadyy" }] }),
  component: ReportPage,
  loader: async ({ params }) => {
    const repo = await getRepoFn({ data: { repoId: params.repoId } }).catch(() => null);
    const reportPayload = await getLaunchReportFn({ data: { repoId: params.repoId } }).catch(
      () => null,
    );
    return { repo, reportPayload };
  },
});

function ReportPage() {
  const { repo, reportPayload } = Route.useLoaderData();
  const { data: sessionUser } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: Infinity,
  });
  const { repoId } = Route.useParams();
  const [shareUrl, setShareUrl] = useState<string | null>(reportPayload?.shareUrl ?? null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  if (!reportPayload) {
    return (
      <RepoLayout user={sessionUser} repoId={repoId} repoName={repo?.name ?? repoId}>
        <main className="py-6">
          <EmptyState
            icon={FileText}
            title="No launch report yet"
            body="A report is the shareable proof that this repo is ready — score, evidence, and what was checked. This repo has not been scanned yet."
            steps={[
              "Run a sandbox build so the score is backed by a real install and build.",
              "Open Production verdict to see the score and its evidence.",
              "Come back here to generate a report link you can send to anyone.",
            ]}
            action={{ label: "Go to Production verdict", to: "/repo/$repoId", params: { repoId } }}
          />
        </main>
      </RepoLayout>
    );
  }

  const { report } = reportPayload;

  async function createShareLink() {
    setSharing(true);
    setShareError(null);
    try {
      const { shareUrl: url } = await createLaunchReportShareFn({ data: { repoId } });
      setShareUrl(url);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Failed to create link");
    } finally {
      setSharing(false);
    }
  }

  async function copyLink() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <RepoLayout user={sessionUser} repoId={repoId} repoName={repo?.name ?? repoId}>
      <main className="py-2">
        <div className="print-hide mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/repo/$repoId"
            params={{ repoId }}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to audit
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-[5px] border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" /> Save as PDF
            </button>
            {shareUrl ? (
              <>
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex items-center gap-1.5 rounded-[5px] border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={createShareLink}
                  disabled={sharing}
                  className="inline-flex items-center gap-1.5 rounded-[5px] border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                >
                  {sharing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  New link
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={createShareLink}
                disabled={sharing}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-[#00c990] disabled:opacity-60"
              >
                {sharing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                Create share link
              </button>
            )}
          </div>
        </div>

        {shareUrl && (
          <div className="print-hide mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[5px] border border-border bg-card px-4 py-2.5 text-xs">
            <span className="text-muted-foreground">Share link:</span>
            <a
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 break-all font-mono text-primary hover:underline"
            >
              {shareUrl}
            </a>
            <span className="text-muted-foreground">
              Anyone with this link can read the report.
            </span>
          </div>
        )}
        {shareError && <div className="print-hide mb-4 text-sm text-critical">{shareError}</div>}

        <LaunchReportDocument report={report} />
      </main>
    </RepoLayout>
  );
}
