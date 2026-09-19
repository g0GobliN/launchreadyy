import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { HomeReveal } from "./HomeReveal";
import { HomeSection } from "./HomeSection";

const ITEMS = [
  {
    title: "Use the checks that matter",
    body: "The full Production Security suite, every finding backed by evidence.",
    href: "/security" as const,
    label: "Security",
  },
  {
    title: "Bring your own keys",
    body: "Your GitHub token, your optional AI provider. No metering, no middleman.",
    href: "/docs" as const,
    label: "Configuration",
  },
  {
    title: "Go live with confidence",
    body: "Live site scans and repository monitoring run from your own installation.",
    href: "/workflow" as const,
    label: "How it works",
  },
];

export function HomeFrontier() {
  return (
    <HomeSection>
      <div className="mx-auto max-w-6xl px-6">
        <HomeReveal>
          <h2 className="font-display text-3xl tracking-[-0.03em] text-white sm:text-4xl">
            Stay ready on the frontier.
          </h2>
        </HomeReveal>
        <div className="mt-14 grid gap-12 border-t border-white/[0.08] pt-12 md:grid-cols-3 md:gap-10">
          {ITEMS.map((item, i) => (
            <HomeReveal key={item.title} delay={i * 0.06}>
              <h3 className="font-display text-xl text-white">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/50">{item.body}</p>
              <Link
                to={item.href}
                className="mt-6 inline-flex items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
              >
                {item.label}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </HomeReveal>
          ))}
        </div>
      </div>
    </HomeSection>
  );
}
