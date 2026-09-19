import { Copy, Plus, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type EnvVarRowData = {
  /** Stable row id for edits (draft or stored). */
  id: string;
  key: string;
  value: string;
  required: boolean;
  useDummy: boolean;
  detectedIn?: string[];
  description?: string;
  stored?: boolean;
  /** When true, key cell is an editable input (for newly added blank rows). */
  editableKey?: boolean;
};

export function EnvironmentVariableTable({
  rows,
  onChangeValue,
  onChangeKey,
  onToggleDummy,
  onDelete,
  onAdd,
  onEnvPaste,
}: {
  rows: EnvVarRowData[];
  onChangeValue: (id: string, value: string) => void;
  onChangeKey?: (id: string, key: string) => void;
  onToggleDummy: (id: string) => void;
  onDelete?: (id: string) => void;
  onAdd?: () => void;
  /** Paste a whole .env into Key — parent splits into rows. Returns true if handled. */
  onEnvPaste?: (text: string) => boolean;
}) {
  function handleKeyPaste(e: React.ClipboardEvent<HTMLInputElement>, rowId: string) {
    const text = e.clipboardData.getData("text");
    if (!onEnvPaste || !text.includes("=")) return;
    // Multi-line or KEY=value blob → auto-split
    if (text.includes("\n") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(text.trim())) {
      const handled = onEnvPaste(text);
      if (handled) {
        e.preventDefault();
        return;
      }
    }
    void rowId;
  }

  return (
    <div className="overflow-hidden rounded-[5px] border border-border bg-card">
      <div className="grid grid-cols-[1.2fr_1.4fr_0.7fr_0.9fr_auto] gap-2 border-b border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>Key</span>
        <span>Value</span>
        <span title="Whether a real value is required for this run">Required</span>
        <span title="Use a safe placeholder instead of a real secret">Use dummy</span>
        <span className="w-8" />
      </div>

      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[1.2fr_1.4fr_0.7fr_0.9fr_auto] items-center gap-2 border-b border-border px-3 py-2"
        >
          <div className="min-w-0">
            {row.editableKey || !row.stored ? (
              <input
                value={row.key}
                onChange={(e) => onChangeKey?.(row.id, e.target.value)}
                onPaste={(e) => handleKeyPaste(e, row.id)}
                placeholder="KEY_NAME — or paste .env"
                className="h-9 w-full min-w-0 rounded-xl border border-input bg-background px-3 font-mono text-[13px] outline-none focus:border-data focus:ring-2 focus:ring-data/20"
              />
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                <code className="truncate font-mono text-[13px] text-foreground">{row.key}</code>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Copy ${row.key}`}
                  onClick={() => void navigator.clipboard.writeText(row.key)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
          <input
            type={row.useDummy ? "text" : "password"}
            value={row.useDummy ? "••••••••" : row.value}
            disabled={row.useDummy || Boolean(row.stored && !row.value)}
            placeholder={row.stored && !row.value ? "Saved (write-only)" : "Value"}
            onChange={(e) => onChangeValue(row.id, e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (onEnvPaste && text.includes("\n") && text.includes("=")) {
                const handled = onEnvPaste(text);
                if (handled) e.preventDefault();
              }
            }}
            className={cn(
              "h-9 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-data focus:ring-2 focus:ring-data/20",
              (row.useDummy || (row.stored && !row.value)) && "bg-muted text-muted-foreground",
            )}
          />
          <span
            className={cn(
              "inline-flex w-fit rounded-[5px] px-2 py-0.5 text-[11px] font-medium",
              row.required ? "bg-primary/10 text-data" : "bg-muted text-muted-foreground",
            )}
          >
            {row.required ? "Required" : "Optional"}
          </span>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={row.useDummy} onCheckedChange={() => onToggleDummy(row.id)} />
            Use dummy
          </label>
          {onDelete ? (
            <button
              type="button"
              className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground"
              onClick={() => onDelete(row.id)}
              aria-label={`Delete ${row.key || "variable"}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : (
            <span className="w-8" />
          )}
        </div>
      ))}

      {onEnvPaste && (
        <p className="border-t border-border px-3 py-2.5 text-xs leading-relaxed text-primary">
          Tip: paste an entire <code className="font-mono text-[11px]">.env</code> file into the{" "}
          <strong>Key</strong> field to add multiple variables at once. Comments and blank lines are
          ignored; existing keys are updated in place.
        </p>
      )}

      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          Add variable
        </button>
      )}
    </div>
  );
}
