import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { getChangelogArchiveFn } from "@/lib/api/home-feed.functions";
import { DEFAULT_HOME_FEED } from "@/lib/home-feed";

export const Route = createFileRoute("/changelog")({
  loader: async () => {
    try {
      return await getChangelogArchiveFn();
    } catch {
      return DEFAULT_HOME_FEED;
    }
  },
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
  const feed = Route.useLoaderData();

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
          {feed.changelog.map((e) => (
            <li key={e.slug}>
              <Link
                to="/blog/$slug"
                params={{ slug: e.slug }}
                className="group flex flex-col gap-1 py-5 transition hover:bg-muted/40 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8 -mx-2 px-2 rounded-md"
              >
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{e.date}</span>
                <span className="text-base text-foreground/90 transition group-hover:text-foreground sm:text-right">
                  {e.title}
                  <ArrowRight className="ml-2 inline h-3.5 w-3.5 opacity-0 transition group-hover:opacity-70" />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {feed.highlights.length > 0 ? (
          <section className="mt-16">
            <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              Guides & stories
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Longer reads on sandbox verify, security, and shipping.
            </p>
            <ul className="mt-8 space-y-6">
              {feed.highlights.map((h) => (
                <li key={h.slug}>
                  <Link
                    to="/blog/$slug"
                    params={{ slug: h.slug }}
                    className="group block overflow-hidden rounded-md border border-border bg-card/40 transition hover:border-border/80"
                  >
                    {h.image ? (
                      <img
                        src={h.image}
                        alt=""
                        className="aspect-[16/9] w-full object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <div className="p-4 sm:p-5">
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {h.date}
                        <span className="mx-2 text-muted-foreground/40">·</span>
                        {h.category}
                      </p>
                      <p className="mt-2 text-base font-medium text-foreground group-hover:underline underline-offset-4">
                        {h.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {h.author}
                        {h.readTime ? ` · ${h.readTime}` : ""}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
