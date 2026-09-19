import { HomeReveal } from "./HomeReveal";
import { HomeSection } from "./HomeSection";

const STACKS = ["Node", "Python", "Go", "Rust", "Ruby", "PHP", "Java", ".NET", "Flutter", "Expo"];

export function HomeTrust() {
  return (
    <HomeSection className="!py-14 sm:!py-16">
      <div className="mx-auto max-w-6xl px-6">
        <HomeReveal>
          <p className="text-center font-mono text-[11px] uppercase tracking-[0.16em] text-white/35">
            Trusted every day by teams that ship
          </p>
          <p className="mt-6 text-center text-sm text-white/45 sm:text-base">
            Works across{" "}
            {STACKS.map((s, i) => (
              <span key={s}>
                <span className="text-white/75">{s}</span>
                {i < STACKS.length - 1 ? <span className="text-white/25"> · </span> : null}
              </span>
            ))}
            <span className="text-white/25"> · </span>
            <span className="text-white/55">and more</span>
          </p>
        </HomeReveal>
      </div>
    </HomeSection>
  );
}
