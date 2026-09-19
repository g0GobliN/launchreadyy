import { Link } from "@tanstack/react-router";
import { ArrowRight, Github } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { homeAssets } from "./assets";
import { HomeReveal } from "./HomeReveal";

/**
 * Cursor-style hero: statement + CTAs up top, product media as the
 * dominant visual plane under the fold of the copy — not a dim wallpaper.
 */
export function HomeHero() {
  const reduce = useReducedMotion();

  return (
    <section className="relative isolate overflow-hidden border-b border-white/[0.08] pb-10 sm:pb-14">
      <div className="mx-auto max-w-5xl px-6 pt-28 pb-10 text-center sm:pt-36 sm:pb-14">
        <HomeReveal>
          <p className="mb-5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
            Production readiness for any repo
          </p>
          <h1 className="font-display text-[2.75rem] leading-[1.05] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
            <span className="text-balance">Know before you ship.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-white/55 sm:text-lg">
            Install, build, and lint in an isolated sandbox — then open one pull request that closes
            the readiness gaps.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/dashboard"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-medium text-black transition hover:bg-white/90"
            >
              <Github className="h-4 w-4" />
              Connect GitHub
            </Link>
            <Link
              to="/workflow"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 text-sm font-medium text-white/90 transition hover:bg-white/10"
            >
              See how it works
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <p className="mt-6 text-sm text-white/35">
            <Link to="/docs" className="underline-offset-4 hover:text-white/60 hover:underline">
              Read the docs
            </Link>
          </p>
        </HomeReveal>
      </div>

      {/* Dominant product visual — Cursor puts the demo under the statement */}
      <HomeReveal delay={0.12} className="relative mx-auto max-w-6xl px-4 pb-4 sm:px-6 sm:pb-8">
        <div className="home-media-frame relative overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
          {reduce ? (
            <img
              src={homeAssets.heroPoster}
              alt="LaunchReadyy sandbox verify and readiness score"
              className="aspect-[16/9] w-full object-cover object-top"
            />
          ) : (
            <video
              className="aspect-[16/9] w-full object-cover object-top"
              autoPlay
              muted
              loop
              playsInline
              poster={homeAssets.heroPoster}
            >
              <source src={homeAssets.heroWebm} type="video/webm" />
              <source src={homeAssets.heroMp4} type="video/mp4" />
            </video>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--background)] to-transparent" />
        </div>
      </HomeReveal>
    </section>
  );
}
