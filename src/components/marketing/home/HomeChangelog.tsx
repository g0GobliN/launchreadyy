import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ChangelogEntry } from "@/lib/home-feed";
import { HomeReveal } from "./HomeReveal";
import { HomeSection } from "./HomeSection";

export function HomeChangelog({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <HomeSection tone="muted">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-20">
          <HomeReveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/35">
              Changelog
            </p>
            <h2 className="mt-4 font-display text-3xl tracking-[-0.03em] text-white sm:text-4xl">
              What’s new in LaunchReadyy
            </h2>
            <p className="mt-4 text-sm text-white/45">
              Product updates — sandbox verification, evidence, scores, and fix PRs.
            </p>
            <Link
              to="/changelog"
              className="mt-6 inline-flex items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
            >
              View all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </HomeReveal>

          <ul className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
            {entries.map((e, i) => (
              <HomeReveal key={e.slug} delay={i * 0.04}>
                <li>
                  <Link
                    to="/blog/$slug"
                    params={{ slug: e.slug }}
                    className="group flex flex-col gap-1 py-5 transition hover:bg-white/[0.02] sm:flex-row sm:items-baseline sm:justify-between sm:gap-8"
                  >
                    <span className="shrink-0 font-mono text-xs text-white/35">{e.date}</span>
                    <span className="text-base text-white/85 transition group-hover:text-white sm:text-right">
                      {e.title}
                      <ArrowRight className="ml-2 inline h-3.5 w-3.5 opacity-0 transition group-hover:opacity-70" />
                    </span>
                  </Link>
                </li>
              </HomeReveal>
            ))}
          </ul>
        </div>
      </div>
    </HomeSection>
  );
}
