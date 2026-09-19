import { Link } from "@tanstack/react-router";
import { Github } from "lucide-react";
import { BrandWordmark } from "@/components/brand-wordmark";
import { HomeReveal } from "./HomeReveal";
import { HomeSection } from "./HomeSection";

export function HomeCta() {
  return (
    <HomeSection tone="muted" className="!py-24 sm:!py-32">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <HomeReveal>
          <h2 className="font-display text-4xl tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
            Try <BrandWordmark className="text-white" /> now.
          </h2>
          <p className="mx-auto mt-6 max-w-md text-base text-white/50">
            Connect a repo. Watch the sandbox. Merge the PR. Know before you ship.
          </p>
          <Link
            to="/dashboard"
            className="mt-10 inline-flex h-12 items-center gap-2 rounded-full bg-white px-8 text-sm font-medium text-black transition hover:bg-white/90"
          >
            <Github className="h-4 w-4" />
            Connect GitHub
          </Link>
        </HomeReveal>
      </div>
    </HomeSection>
  );
}
