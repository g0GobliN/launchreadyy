import { Lock, Globe, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";

export function RepositoryCard({
  name,
  description,
  language,
  updatedAt,
  private: isPrivate,
  defaultBranch,
  selected,
  onClick,
  actionLabel = "Analyze",
  onAction,
  loading,
  disabled,
}: {
  name: string;
  description?: string | null;
  language?: string | null;
  updatedAt?: string | null;
  private?: boolean;
  defaultBranch?: string | null;
  selected?: boolean;
  onClick?: () => void;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
  /** Showcase / locked — button visible but non-interactive */
  disabled?: boolean;
}) {
  return (
    <article
      className={cn(
        "app-panel rounded-2xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-data/40",
        selected && "border-l-[3px] border-l-primary",
        onClick && !disabled && "cursor-pointer",
        disabled && "opacity-80",
      )}
      onClick={disabled ? undefined : onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-foreground">{name}</h3>
            <span className="inline-flex items-center gap-1 rounded-[5px] border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {isPrivate ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
              {isPrivate ? "Private" : "Public"}
            </span>
            {language && (
              <span className="rounded-[5px] bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
                {language}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {defaultBranch && (
              <span className="inline-flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                {defaultBranch}
              </span>
            )}
            {updatedAt && <span>Updated {updatedAt}</span>}
          </div>
        </div>
        {(onAction || disabled) && (
          <button
            type="button"
            disabled={loading || disabled}
            title={disabled ? "Connect GitHub to analyze this repo" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (!disabled) onAction?.();
            }}
            className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-[#00c990] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Starting…" : actionLabel}
          </button>
        )}
      </div>
    </article>
  );
}
