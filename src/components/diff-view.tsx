import { useState } from "react";
import type { FileDiff } from "@/lib/mock-data";
import { ChevronDown, FilePlus2, FileEdit, CheckCircle2, AlertTriangle } from "lucide-react";

function ValidationBadge({ validation }: { validation: FileDiff["validation"] }) {
  if (!validation || validation.status === "unverified") return null;
  if (validation.status === "valid") {
    return (
      <span
        title="Parses cleanly"
        className="shrink-0 flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success"
      >
        <CheckCircle2 className="h-3 w-3" /> Parses
      </span>
    );
  }
  return (
    <span
      title={validation.detail ?? "Syntax error"}
      className="shrink-0 flex items-center gap-1 rounded-full border border-critical/40 bg-critical/10 px-2 py-0.5 text-[10px] font-medium text-critical"
    >
      <AlertTriangle className="h-3 w-3" /> Syntax error
    </span>
  );
}

function lineColor(type: string) {
  switch (type) {
    case "add":
      return "bg-success/10 border-l-2 border-success/60";
    case "del":
      return "bg-critical/10 border-l-2 border-critical/60";
    case "hunk":
      return "bg-primary/10 text-primary";
    default:
      return "";
  }
}

function lineSign(type: string) {
  if (type === "add") return "+";
  if (type === "del") return "-";
  return " ";
}

export function DiffView({ diff }: { diff: FileDiff }) {
  const [open, setOpen] = useState(true);
  const adds = diff.lines.filter((l) => l.type === "add").length;
  const dels = diff.lines.filter((l) => l.type === "del").length;
  const Icon = diff.status === "added" ? FilePlus2 : FileEdit;
  const iconColor = diff.status === "added" ? "text-success" : "text-warning";

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-b border-border bg-surface px-3 py-2.5 text-left hover:bg-muted overflow-hidden rounded-t-lg"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition ${open ? "" : "-rotate-90"}`}
        />
        <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{diff.path}</span>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {diff.status}
        </span>
        <ValidationBadge validation={diff.validation} />
        <span className="shrink-0 font-mono text-xs text-success">+{adds}</span>
        {dels > 0 && <span className="shrink-0 font-mono text-xs text-critical">-{dels}</span>}
      </button>
      {open && (
        <div className="rounded-b-lg">
          <table className="w-full font-mono text-[11px] leading-5">
            <tbody>
              {diff.lines.map((l, idx) => (
                <tr key={idx} className={lineColor(l.type)}>
                  <td className="select-none w-8 shrink-0 px-1.5 py-0.5 text-right align-top text-muted-foreground/60">
                    {l.oldNo ?? ""}
                  </td>
                  <td className="select-none w-8 shrink-0 px-1.5 py-0.5 text-right align-top text-muted-foreground/60">
                    {l.newNo ?? ""}
                  </td>
                  <td className="select-none w-4 shrink-0 px-1 py-0.5 align-top text-muted-foreground">
                    {lineSign(l.type)}
                  </td>
                  <td className="break-all whitespace-pre-wrap px-2 py-0.5">{l.text || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
