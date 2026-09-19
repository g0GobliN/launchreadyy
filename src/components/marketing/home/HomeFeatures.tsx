import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { HomeReveal } from "./HomeReveal";
import { HomeSection } from "./HomeSection";
import { homeAssets } from "./assets";

type Feature = {
  eyebrow: string;
  title: string;
  body: string;
  image: string;
  imageAlt: string;
  href: "/workflow" | "/docs" | "/security";
  linkLabel: string;
  reverse?: boolean;
};

const FEATURES: Feature[] = [
  {
    eyebrow: "Sandbox",
    title: "Verify in a real sandbox.",
    body: "We clone your repo into an isolated environment and run install, build, and lint — so the score reflects a bootable app, not a static guess.",
    image: homeAssets.sandbox,
    imageAlt: "Sandbox verification terminal",
    href: "/workflow",
    linkLabel: "Learn about sandbox verify",
  },
  {
    eyebrow: "Score",
    title: "A score with evidence.",
    body: "Every finding points to files and confidence. Production Readiness and Production Security — so you know what still blocks launch.",
    image: homeAssets.score,
    imageAlt: "Readiness score and findings",
    href: "/docs",
    linkLabel: "See how scoring works",
    reverse: true,
  },
  {
    eyebrow: "Fix PRs",
    title: "Ship the fix as a pull request.",
    body: "One-click PRs close CI, tests, env, Docker, and security gaps. You review and merge — we don’t push to main.",
    image: homeAssets.pr,
    imageAlt: "Automated fix pull request",
    href: "/workflow",
    linkLabel: "See the fix workflow",
  },
];

export function HomeFeatures() {
  return (
    <div>
      {FEATURES.map((f, i) => (
        <HomeSection key={f.title} tone={i % 2 === 0 ? "muted" : "default"}>
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2 lg:gap-16">
            <HomeReveal delay={0.05} className={f.reverse ? "lg:order-2" : undefined}>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary/80">
                {f.eyebrow}
              </p>
              <h2 className="mt-4 font-display text-3xl tracking-[-0.03em] text-white sm:text-4xl lg:text-5xl">
                {f.title}
              </h2>
              <p className="mt-5 max-w-md text-base leading-relaxed text-white/55">{f.body}</p>
              <Link
                to={f.href}
                className="mt-8 inline-flex items-center gap-2 text-sm text-white/80 transition hover:text-white"
              >
                {f.linkLabel}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </HomeReveal>
            <HomeReveal delay={0.12} className={f.reverse ? "lg:order-1" : undefined}>
              <div className="home-media-frame overflow-hidden">
                <img
                  src={f.image}
                  alt={f.imageAlt}
                  className="aspect-[16/10] w-full object-cover"
                  loading={i === 0 ? "eager" : "lazy"}
                />
              </div>
            </HomeReveal>
          </div>
        </HomeSection>
      ))}
    </div>
  );
}
