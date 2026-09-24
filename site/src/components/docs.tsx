import type { ReactNode } from "react";
import { DOCS_SECTIONS } from "../lib/docs-sections";
import { useActiveSection } from "../lib/use-active-section";

/**
 * The documentation shell: a sticky table of contents beside a single reading column.
 *
 * Unlike the prose grid used by narrative pages, reference content is one column wide, because
 * tables and command blocks stop being readable when they are split across a two-column grid.
 */
export function DocsLayout({ children }: { children: ReactNode }) {
  const active = useActiveSection(DOCS_SECTIONS);

  return (
    <div className="docs-shell">
      <nav className="docs-nav" aria-label="Documentation sections">
        <div className="docs-nav-title">On this page</div>
        <ol>
          {DOCS_SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className={active === section.id ? "active" : undefined}
                aria-current={active === section.id ? "true" : undefined}
              >
                {section.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="docs-body">{children}</div>
    </div>
  );
}

export function DocsSection({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="docs-section">
      <h2>{title}</h2>
      {lead ? <p className="docs-lead">{lead}</p> : null}
      {children}
    </section>
  );
}

/** Definition-style table: first column is a setting or term, the rest describe it. */
export function DocsTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="docs-table-wrap">
      <table className="docs-table">
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Callout for a caveat that is easy to miss while skimming a section. */
export function DocsNote({ children }: { children: ReactNode }) {
  return <aside className="docs-note">{children}</aside>;
}

/** Collapsible question/answer pairs, used for the troubleshooting section. */
export function DocsFaq({ items }: { items: { question: string; answer: ReactNode }[] }) {
  return (
    <div className="docs-faq">
      {items.map((item) => (
        <details key={item.question}>
          <summary>{item.question}</summary>
          <div className="docs-faq-answer">{item.answer}</div>
        </details>
      ))}
    </div>
  );
}

/** Link cards for "read this next" — the site's exit points into the repository docs. */
export function DocsCards({ items }: { items: { title: string; body: string; href: string }[] }) {
  return (
    <div className="docs-cards">
      {items.map((item) => (
        <a key={item.title} className="docs-card" href={item.href} target="_blank" rel="noreferrer">
          <span className="docs-card-title">
            {item.title} <span aria-hidden="true">↗</span>
          </span>
          <span className="docs-card-body">{item.body}</span>
        </a>
      ))}
    </div>
  );
}
