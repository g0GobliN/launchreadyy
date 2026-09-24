import type { ReactNode } from "react";

/**
 * The heading block every page starts with: an eyebrow, a display title, and one paragraph of
 * orientation. Kept separate from `Page` because `/docs` pairs the same hero with a two-column
 * documentation shell instead of the prose grid.
 */
export function PageHero({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: string;
  intro: string;
}) {
  return (
    <div className="page-hero">
      <div className="kicker">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{intro}</p>
    </div>
  );
}

/**
 * Narrative pages (about, legal, security, contact): hero followed by a bordered two-column grid
 * of `<section>` blocks. Long-form reference content uses the layout in `docs.tsx` instead.
 */
export function Page({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="page-shell">
      <PageHero eyebrow={eyebrow} title={title} intro={intro} />
      <div className="prose">{children}</div>
    </div>
  );
}
