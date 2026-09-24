import type { ReactNode } from "react";

/**
 * Internal link.
 *
 * The public site is a single-page app, so a click on an in-site path is handled here: the URL is
 * pushed to history and a `popstate` event tells the router to re-render. Modified clicks fall
 * through to the browser so "open in new tab" and middle-click keep working, and in-page anchors
 * (`#section`) are never intercepted — `html { scroll-behavior: smooth }` already handles them.
 */
export function Link({
  href,
  children,
  className = "",
  onNavigate,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  onNavigate?: () => void;
}) {
  const internal = href.startsWith("/");

  return (
    <a
      href={href}
      className={className}
      onClick={
        internal
          ? (event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNavigate?.();
              window.history.pushState({}, "", href);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }
          : undefined
      }
    >
      {children}
    </a>
  );
}
