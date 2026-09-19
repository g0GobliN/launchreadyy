import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  FolderSearch,
  LayoutDashboard,
  ScanSearch,
  ShieldAlert,
  Unplug,
} from "lucide-react";
import { AppLayout } from "@/components/layouts/AppLayout";
import { RepoLayout } from "@/components/layouts/RepoLayout";
import { getSessionUserFn } from "@/lib/api/session.functions";

/** Why the route could not render. Drives the copy and the suggested next step. */
export type NotFoundReason = "repo" | "scan" | "blockers" | "job" | "generic";

const COPY: Record<
  NotFoundReason,
  { icon: typeof FolderSearch; title: string; body: string; steps: string[] }
> = {
  repo: {
    icon: FolderSearch,
    title: "We can't find that repository",
    body: "It may have been disconnected, renamed on GitHub, or it belongs to an account you're not signed in to.",
    steps: [
      "Check that you're signed in as the account that connected the repo.",
      "If it was renamed on GitHub, reconnect it so we pick up the new name.",
      "Otherwise pick a different repository from your list.",
    ],
  },
  scan: {
    icon: ScanSearch,
    title: "This repository hasn't been scanned yet",
    body: "Fix previews are built from a scan's findings, so there's nothing to preview until the first scan finishes.",
    steps: [
      "Open the repository and run a scan.",
      "We install, build, and lint it in an isolated sandbox.",
      "Once it completes, every finding gets a fix preview here.",
    ],
  },
  blockers: {
    icon: ShieldAlert,
    title: "This repository hasn't been scanned yet",
    body: "Launch blockers are the findings a scan rates as ship-stopping, so the list stays empty until the first scan finishes.",
    steps: [
      "Open the repository and run a scan.",
      "We install, build, and lint it in an isolated sandbox.",
      "Anything that would break production shows up here, ranked.",
    ],
  },
  job: {
    icon: Unplug,
    title: "We can't find that fix job",
    body: "The job may have been cleared, or the link points at a job from a different repository.",
    steps: [
      "Open the repository's fix history to see jobs that are still available.",
      "Re-run the fix if the one you wanted has been cleared.",
      "Older jobs are removed once their branch is merged or deleted.",
    ],
  },
  generic: {
    icon: FolderSearch,
    title: "We can't find that page",
    body: "The link may be out of date, or the thing it pointed at has since been removed.",
    steps: [
      "Head back to your repositories and navigate from there.",
      "If you followed a link from an email, it may have expired.",
      "The item may have been deleted by another member of your team.",
    ],
  },
};

export function RepoNotFound({
  reason = "generic",
  repoName,
}: {
  reason?: NotFoundReason;
  /** Set when the repo itself resolved — keeps the repo nav instead of ejecting. */
  repoName?: string;
}) {
  const { icon: Icon, title, body, steps } = COPY[reason];
  // The route's loader failed, so there is no user in scope — fetch it here to
  // keep the sidebar (and its avatar) intact instead of dropping to a bare page.
  const { data: user } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: 60_000,
  });
  const params = useParams({ strict: false }) as { repoId?: string };
  const repoId = params.repoId;
  const inRepo = Boolean(repoName && repoId);

  const card = (
    <div className="mx-auto w-full max-w-lg rounded-[5px] border border-border bg-card p-6 sm:p-8">
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-[6px] bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-base font-semibold text-foreground">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
      </div>

      <ol className="mx-auto mt-6 max-w-md space-y-2.5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 rounded-[5px] border border-border bg-surface p-3">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-[11px] font-semibold text-primary">
              {i + 1}
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">{step}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {inRepo ? (
          <Link
            to="/repo/$repoId/sandbox"
            params={{ repoId: repoId! }}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Run the first scan
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <Link
            to="/repos"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Your repositories
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          Dashboard
        </Link>
      </div>
    </div>
  );

  // A valid repo keeps its own nav; only an unresolvable repo falls back to the
  // workspace shell.
  if (inRepo) {
    return (
      <RepoLayout user={user ?? null} repoId={repoId!} repoName={repoName!}>
        {card}
      </RepoLayout>
    );
  }

  return (
    <AppLayout user={user ?? null} breadcrumbs={[{ label: "Not found" }]}>
      {card}
    </AppLayout>
  );
}
