import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ListPagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [draft, setDraft] = useState(String(page));

  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  if (total <= pageSize) return null;

  function go(raw: string) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) {
      setDraft(String(page));
      return;
    }
    const next = Math.min(totalPages, Math.max(1, n));
    setDraft(String(next));
    if (next !== page) onPageChange(next);
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const inputWidth = `${Math.max(2, String(totalPages).length)}ch`;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4",
        className,
      )}
    >
      <p className="text-xs text-muted-foreground">
        <span className="tabular-nums text-foreground/80">
          {from}–{to}
        </span>
        <span className="mx-1 text-muted-foreground/50">·</span>
        <span className="tabular-nums">{total.toLocaleString()}</span> total
      </p>

      <div className="inline-flex items-stretch overflow-hidden rounded-full border border-border bg-surface text-xs shadow-sm">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex items-center gap-1 border-r border-border px-2.5 py-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Prev</span>
        </button>

        <label className="flex items-center gap-1.5 bg-muted/30 px-2.5 py-1.5 text-muted-foreground">
          <span className="hidden sm:inline">Page</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 5))}
            onBlur={() => go(draft)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                if (page < totalPages) onPageChange(page + 1);
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (page > 1) onPageChange(page - 1);
              }
            }}
            style={{ width: inputWidth }}
            className="h-6 rounded-full border border-border bg-background px-1 text-center text-xs font-medium tabular-nums text-foreground outline-none focus:border-data focus:ring-1 focus:ring-data/30"
            aria-label="Go to page"
          />
          <span className="tabular-nums">
            of <span className="text-foreground/80">{totalPages}</span>
          </span>
        </label>

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex items-center gap-1 border-l border-border px-2.5 py-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
