import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, type LucideIcon } from "lucide-react";

export type EmptyStateAction = {
  label: string;
  /** Route path, e.g. "/repos" or "/repo/$repoId/sandbox" */
  to: string;
  params?: Record<string, string>;
};

/**
 * One empty state for the whole app: say what is missing, why nothing is here,
 * the numbered path to fill it, and one action. Used on every tab.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  steps,
  action,
  secondary,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  steps?: string[];
  action?: EmptyStateAction;
  /** Plain text under the button — e.g. what it costs, or where else to look. */
  secondary?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-surface/60 px-6 py-12 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-data/10 text-data">
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="mt-5 font-display text-xl font-medium tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>

      {steps && steps.length > 0 && (
        <ol className="mx-auto mt-6 max-w-md space-y-2.5">
          {steps.map((step, i) => (
            <li
              key={i}
              className="flex gap-3 rounded-2xl border border-hairline bg-surface p-3.5 shadow-[var(--app-shadow)]"
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-data/10 font-mono text-[11px] font-semibold text-data">
                {i + 1}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>
      )}

      {children && <div className="mx-auto mt-6 max-w-md">{children}</div>}

      {action && (
        <div className="mt-6 flex justify-center">
          <Link
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- targets vary by page
            to={action.to as any}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- targets vary by page
            params={action.params as any}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-[#00c990]"
          >
            {action.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {secondary && <p className="mt-3 text-center text-xs text-muted-foreground">{secondary}</p>}
    </div>
  );
}
