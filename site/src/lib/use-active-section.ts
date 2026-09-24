import { useEffect, useMemo, useState } from "react";

/**
 * The id of the section currently under the sticky header, for the `/docs` sidebar.
 *
 * Observes the section elements directly rather than computing scroll offsets, so it stays correct
 * after web fonts load or content reflows. `rootMargin` trims the sticky header off the top of the
 * viewport and ignores the lower 60%, so the highlighted entry is the section being read rather
 * than one already scrolled past. Without IntersectionObserver the first section stays active
 * instead of the sidebar going blank.
 */
export function useActiveSection(sections: readonly { id: string }[]): string {
  const ids = useMemo(() => sections.map((section) => section.id), [sections]);
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const next = visible[0]?.target.id;
        if (next) setActive(next);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [ids]);

  return active;
}
