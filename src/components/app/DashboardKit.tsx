import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardPageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-7 flex flex-wrap items-end justify-between gap-5", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-data">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-[clamp(1.9rem,4.5vw,2.75rem)] font-medium leading-[1.03] tracking-[-0.04em] text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function DashboardPanel({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: ComponentProps<"section"> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={cn("app-panel rounded-3xl p-6 sm:p-7", className)} {...props}>
      {title || description || actions ? (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title ? <h2 className="text-sm font-semibold tracking-tight">{title}</h2> : null}
            {description ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function MetricGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "neutral" | "data" | "success" | "warning" | "critical";
}) {
  const toneClass = {
    neutral: "text-foreground",
    data: "text-data",
    success: "text-success",
    warning: "text-warning",
    critical: "text-critical",
  }[tone];
  return (
    <div className="min-w-0 bg-surface px-5 py-4 sm:py-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {Icon ? <Icon className={cn("h-3.5 w-3.5", toneClass)} /> : null}
        <span>{label}</span>
      </div>
      <p
        className={cn(
          "app-metric-serif mt-2 text-[28px] font-medium leading-none tabular-nums",
          toneClass,
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FilterChip({
  active,
  className,
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
        active
          ? "border-data bg-data text-data-foreground shadow-sm"
          : "border-border bg-surface text-muted-foreground hover:border-data/40 hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function StatusPill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "data" | "success" | "warning" | "critical";
  className?: string;
}) {
  const styles = {
    neutral: "border-border bg-muted text-muted-foreground",
    data: "border-data/30 bg-data/10 text-data",
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/30 bg-warning/10 text-warning",
    critical: "border-critical/30 bg-critical/10 text-critical",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        styles,
        className,
      )}
    >
      {children}
    </span>
  );
}

export const dashboardPrimaryAction =
  "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-[#00c990] active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50";

export const dashboardSecondaryAction =
  "inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border bg-surface px-5 text-sm font-medium text-foreground transition hover:border-data/40 hover:bg-muted active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50";

export const dashboardInput =
  "h-10 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-data focus:ring-2 focus:ring-data/20";
