import { HOME_CHECKS } from "./checks";
import { HomeReveal } from "./HomeReveal";
import { HomeSection } from "./HomeSection";

export function HomeChecks() {
  return (
    <HomeSection tone="muted">
      <div className="mx-auto max-w-6xl px-6">
        <HomeReveal>
          <h2 className="max-w-3xl font-display text-3xl tracking-[-0.03em] text-white sm:text-4xl lg:text-5xl">
            What a scan actually checks.
          </h2>
          <p className="mt-3 text-sm text-white/35">
            Every run covers the same ground, and every finding comes back with the file behind it.
          </p>
        </HomeReveal>

        <div className="mt-16 columns-1 gap-8 sm:columns-2 lg:columns-3">
          {HOME_CHECKS.map((c, i) => (
            <HomeReveal key={c.name} delay={i * 0.04} className="mb-8 break-inside-avoid">
              <article className="border-t border-white/[0.08] pt-6">
                <p className="text-[15px] leading-relaxed text-white/70">{c.detail}</p>
                <footer className="mt-5">
                  <p className="text-sm font-medium text-white">{c.name}</p>
                  <p className="text-xs text-white/40">{c.category}</p>
                </footer>
              </article>
            </HomeReveal>
          ))}
        </div>
      </div>
    </HomeSection>
  );
}
