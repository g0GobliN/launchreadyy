import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function CategoryCard({
  title,
  icon,
  score,
  status,
  evidenceCount,
  children,
  onClick,
  selected,
}: {
  title: string;
  icon?: ReactNode;
  score?: number;
  status?: "pass" | "warn" | "fail" | "unknown";
  evidenceCount?: number;
  children?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
}) {
  const statusColor =
    status === "pass"
      ? "bg-primary"
      : status === "warn"
        ? "bg-foreground"
        : status === "fail"
          ? "bg-foreground"
          : "bg-muted-foreground";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-[5px] border border-border bg-card p-4 text-left shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-transform duration-150 hover:scale-[1.01]",
        selected && "border-data ring-1 ring-data/30",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className={cn("h-2 w-2 rounded-full", statusColor)} />
        </div>
        <div className="flex items-center gap-2">
          {typeof score === "number" && (
            <span className="rounded-[5px] border border-border bg-muted px-2 py-0.5 text-xs font-medium">
              {score}%
            </span>
          )}
          {typeof evidenceCount === "number" && (
            <span className="text-xs text-muted-foreground">{evidenceCount} evidence</span>
          )}
        </div>
      </div>
      {children && <div className="mt-3 space-y-2">{children}</div>}
    </button>
  );
}
