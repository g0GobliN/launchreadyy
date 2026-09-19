import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, GitPullRequest, Loader2 } from "lucide-react";
import { HomeReveal } from "./HomeReveal";
import { HomeSection } from "./HomeSection";
import { homeAssets } from "./assets";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    id: "connect",
    n: "01",
    t: "Connect",
    d: "Pick a public or private repo.",
    image: homeAssets.integrateConnect,
    imageAlt: "GitHub repository connected in LaunchReadyy",
  },
  {
    id: "scan",
    n: "02",
    t: "Scan",
    d: "Readiness + security with file evidence.",
    image: homeAssets.score,
    imageAlt: "Readiness score and findings",
  },
  {
    id: "sandbox",
    n: "03",
    t: "Sandbox",
    d: "Install, build, and lint for real.",
    image: homeAssets.sandbox,
    imageAlt: "Sandbox verification running",
  },
  {
    id: "pr",
    n: "04",
    t: "Fix PR",
    d: "One reviewable PR that closes the gaps.",
    image: homeAssets.integratePr,
    imageAlt: "Merge-ready fix pull request",
  },
] as const;

const INTERVAL_MS = 4800;

export function HomeIntegrate() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const step = STEPS[active]!;

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % STEPS.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [reduce, active]);

  return (
    <HomeSection>
      <div className="mx-auto max-w-6xl px-6">
        <HomeReveal className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/35">
            Workflow
          </p>
          <h2 className="mt-4 font-display text-3xl tracking-[-0.03em] text-white sm:text-4xl lg:text-5xl">
            GitHub in. Merge-ready out.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-white/55">
            Four steps from connect to a PR you can ship — scored on a real sandbox, not a guess.
          </p>
        </HomeReveal>

        <HomeReveal delay={0.1} className="mt-12 sm:mt-14">
          <div className="home-media-frame relative overflow-hidden">
            {/* Stage */}
            <div className="relative aspect-[16/10] bg-[#070708] sm:aspect-[16/9]">
              {/* Stack all frames — opacity only (scale transforms soft-blur the bitmap). */}
              {STEPS.map((s, i) => (
                <img
                  key={s.id}
                  src={s.image}
                  alt={s.imageAlt}
                  className={cn(
                    "absolute inset-0 h-full w-full object-cover",
                    !reduce && "transition-opacity duration-500 ease-out",
                    i === active ? "opacity-100" : "opacity-0",
                  )}
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                />
              ))}

              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-transparent" />

              {/* Live accent overlays */}
              <div className="absolute inset-0 z-10 p-3 sm:p-6 lg:p-8">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={step.id}
                    className="flex h-full flex-col justify-between"
                    initial={reduce ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: -8 }}
                    transition={{ duration: 0.35 }}
                  >
                    <StepAccent panel={step.id} />
                    <div className="max-w-[12rem] sm:max-w-md">
                      <p className="font-mono text-[10px] text-primary/90 sm:text-[11px]">
                        {step.n}
                      </p>
                      <p className="mt-0.5 font-display text-xl tracking-tight text-white sm:mt-1 sm:text-3xl">
                        {step.t}
                      </p>
                      <p className="mt-1 text-xs text-white/65 sm:mt-2 sm:text-base">{step.d}</p>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* Timeline */}
            <div className="grid grid-cols-4 border-t border-white/[0.06] bg-[#0a0a0b]">
              {STEPS.map((s, i) => {
                const on = i === active;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActive(i)}
                    className={cn(
                      "relative px-2 py-3 text-left transition sm:px-4 sm:py-4",
                      on ? "bg-white/[0.04]" : "hover:bg-white/[0.02]",
                      i > 0 && "border-l border-white/[0.06]",
                    )}
                  >
                    {!reduce && on && (
                      <span className="absolute inset-x-0 top-0 h-px overflow-hidden bg-white/10">
                        <span key={active} className="home-step-progress block h-full bg-primary" />
                      </span>
                    )}
                    <span
                      className={cn("font-mono text-[10px]", on ? "text-primary" : "text-white/30")}
                    >
                      {s.n}
                    </span>
                    <span
                      className={cn(
                        "mt-1 block text-xs font-medium sm:text-sm",
                        on ? "text-white" : "text-white/45",
                      )}
                    >
                      {s.t}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </HomeReveal>
      </div>
    </HomeSection>
  );
}

function StepAccent({ panel }: { panel: (typeof STEPS)[number]["id"] }) {
  if (panel === "connect") {
    return (
      <div className="ml-auto w-full max-w-[148px] rounded-md border border-white/10 bg-black/55 p-2 shadow-2xl backdrop-blur-md sm:max-w-[220px] sm:p-3 lg:max-w-[260px]">
        <p className="text-[9px] uppercase tracking-wider text-white/40 sm:text-[10px]">Repos</p>
        <p className="mt-0.5 truncate text-xs text-white sm:mt-1 sm:text-sm">acme/checkout-api</p>
        <p className="mt-0.5 text-[10px] text-white/40 sm:text-[11px]">Private · TypeScript</p>
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary sm:mt-3 sm:gap-1.5 sm:px-2 sm:text-[10px]">
          <Check className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          Connected
        </span>
      </div>
    );
  }

  if (panel === "scan") {
    return (
      <div className="ml-auto w-full max-w-[128px] rounded-md border border-white/10 bg-black/55 p-2 shadow-2xl backdrop-blur-md sm:max-w-[200px] sm:p-3 lg:max-w-[240px]">
        <p className="text-[9px] uppercase tracking-wider text-white/40 sm:text-[10px]">Score</p>
        <p className="font-display text-2xl tracking-tight text-white sm:text-4xl">78</p>
        <p className="mt-0.5 text-[10px] text-amber-200/80 sm:mt-1 sm:text-xs">
          Near ready · 4 blockers
        </p>
      </div>
    );
  }

  if (panel === "sandbox") {
    return (
      <div className="ml-auto w-full max-w-[148px] overflow-hidden rounded-md border border-white/10 bg-black/70 font-mono text-[9px] shadow-2xl backdrop-blur-md sm:max-w-[260px] sm:text-[11px] lg:max-w-[300px]">
        <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-2 py-1.5 text-white/40 sm:gap-2 sm:px-3 sm:py-2">
          <Loader2 className="h-2.5 w-2.5 animate-spin text-primary sm:h-3 sm:w-3" />
          sandbox · node 22
        </div>
        <div className="space-y-0 px-2 py-1.5 text-white/65 sm:space-y-0.5 sm:px-3 sm:py-2.5">
          <p className="text-primary/90">✓ clone</p>
          <p className="text-primary/90">✓ install</p>
          <p className="text-primary/90">✓ build</p>
          <p className="animate-pulse text-white/45">… lint</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ml-auto w-full max-w-[120px] rounded-md border border-white/10 bg-black/55 p-1.5 shadow-2xl backdrop-blur-md sm:max-w-[240px] sm:p-3 lg:max-w-[280px]">
      <div className="flex items-center gap-1 text-[10px] text-white sm:gap-2 sm:text-sm">
        <GitPullRequest className="h-2.5 w-2.5 shrink-0 text-primary sm:h-4 sm:w-4" />
        <span className="truncate font-medium">fix/foundation</span>
      </div>
      <p className="mt-1 text-[9px] text-primary/90 sm:mt-2 sm:text-[11px]">Ready to merge</p>
      <ul className="mt-1 space-y-0 font-mono text-[8px] text-white/50 sm:mt-2 sm:space-y-1 sm:text-[10px]">
        <li className="flex justify-between gap-1.5">
          <span>ci.yml</span>
          <span className="text-primary/80">+48</span>
        </li>
        <li className="flex justify-between gap-1.5">
          <span>.env.example</span>
          <span className="text-primary/80">+22</span>
        </li>
      </ul>
    </div>
  );
}
