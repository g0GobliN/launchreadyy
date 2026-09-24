import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

/**
 * Static changelog.
 *
 * This page used to render `marketing_articles` rows through the home-feed server functions, with
 * every entry linking to an in-app article (`/blog/$slug`). Those article routes are gone — the
 * public site under `site/` owns marketing content — so the entries live here as plain data.
 * Newest first.
 */
type Entry = { date: string; title: string; body: string };

const ENTRIES: Entry[] = [
  {
    date: "Aug 6, 2026",
    title: "Sandbox verify: install, build, lint before you trust the score",
    body: "A verdict now unlocks behind a real sandbox run, so a green static scan can't stand in for an app that doesn't boot.",
  },
  {
    date: "Aug 3, 2026",
    title: "Sandbox concurrency, tuned for a single machine",
    body: "Runs share one pool (SANDBOX_MAX_CONCURRENT) and a spike queues instead of failing; unchanged commits reuse their last result.",
  },
  {
    date: "Jul 28, 2026",
    title: "Production Security findings with file evidence",
    body: "Every finding carries the file it came from, plus an optional passive live-site scan for domains you confirm you own.",
  },
  {
    date: "Jul 22, 2026",
    title: "One-click fix PRs for CI, env, Docker, and tests",
    body: "Template fixes stay deterministic and AI fixes use your own provider key — always on a branch, never a commit to main.",
  },
];

export const Route = createFileRoute("/changelog")({
  head: () => ({
    meta: [
      { title: "Changelog — LaunchReadyy" },
      {
        name: "description",
        content:
          "What’s new in LaunchReadyy Community — sandbox verification, readiness findings, and remediation workflows.",
      },
    ],
  }),
  component: ChangelogPage,
});

function ChangelogPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Updates
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Changelog
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
          Product updates for scanning, verification, evidence, and remediation.
        </p>

        <ul className="mt-12 divide-y divide-border border-t border-border">
          {ENTRIES.map((e) => (
            <li key={e.title} className="flex flex-col gap-1 py-5 sm:flex-row sm:gap-8">
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{e.date}</span>
              <div className="min-w-0">
                <p className="text-base text-foreground/90">{e.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{e.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
