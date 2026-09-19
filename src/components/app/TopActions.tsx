import { useEffect, useState } from "react";
import { HelpButton } from "@/components/app/HelpCenter";
import { cn } from "@/lib/utils";

/**
 * Floating help cluster. It belongs to the top of the page,
 * so it slides away as soon as the content scrolls and comes back at the top.
 */
export function TopActions() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>("[data-app-scroll]");
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 24);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const away = scrolled;

  return (
    <div
      className={cn(
        "print-hide absolute right-3 top-3 z-30 flex items-center gap-0.5 transition-all duration-200 ease-out lg:right-4",
        away && "pointer-events-none -translate-y-3 opacity-0",
      )}
    >
      <HelpButton />
    </div>
  );
}
