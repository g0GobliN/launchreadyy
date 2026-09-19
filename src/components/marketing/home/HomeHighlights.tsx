import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { HighlightEntry } from "@/lib/home-feed";
import { HomeReveal } from "./HomeReveal";
import { HomeSection } from "./HomeSection";

export function HomeHighlights({ entries }: { entries: HighlightEntry[] }) {
  return (
    <HomeSection>
      <div className="mx-auto max-w-6xl px-6">
        <HomeReveal className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/35">
              Guides & stories
            </p>
            <h2 className="mt-3 font-display text-3xl tracking-[-0.03em] text-white sm:text-4xl">
              Learn LaunchReadyy
            </h2>
            <p className="mt-2 text-sm text-white/45">
              Sandbox verify, Production Security, and fix PRs — in plain language.
            </p>
          </div>
        </HomeReveal>

        <div className="mt-14 grid gap-8 sm:grid-cols-2">
          {entries.map((h, i) => (
            <HomeReveal key={h.slug} delay={i * 0.05}>
              <Link to="/blog/$slug" params={{ slug: h.slug }} className="group block">
                <div className="home-media-frame overflow-hidden">
                  <img
                    src={h.image}
                    alt=""
                    className="aspect-[16/9] w-full object-cover transition duration-500 group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                </div>
                <p className="mt-4 font-mono text-[11px] text-white/35">
                  {h.date}
                  <span className="mx-2 text-white/20">·</span>
                  {h.category}
                </p>
                <h3 className="mt-2 font-display text-xl text-white transition group-hover:text-white/90">
                  {h.title}
                  <ArrowRight className="ml-1.5 inline h-4 w-4 opacity-0 transition group-hover:opacity-70" />
                </h3>
                <p className="mt-2 text-sm text-white/40">
                  {h.author} · {h.readTime}
                </p>
              </Link>
            </HomeReveal>
          ))}
        </div>
      </div>
    </HomeSection>
  );
}
