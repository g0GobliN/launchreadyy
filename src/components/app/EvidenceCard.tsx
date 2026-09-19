import { useState } from "react";
import type { Issue, Severity } from "@/lib/mock-data";
import {
  getCheckedForCopy,
  getConfidenceCopy,
  getDetectionCopy,
  getWhyItMattersCopy,
  isSandboxVerified,
} from "@/lib/finding-evidence";
import { FindingWhyAndEvidence } from "@/components/finding-evidence";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-foreground",
  high: "bg-foreground/80",
  medium: "bg-foreground/60",
  low: "bg-muted-foreground",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[5px] border border-border bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_DOT[severity])} />
      {severity}
    </span>
  );
}

export function EvidenceCard({
  issue,
  sandboxEvidence,
  aiFixAvailable,
  onAutoFix,
  selected,
  onSelect,
  compact,
}: {
  issue: Issue;
  sandboxEvidence?: string;
  aiFixAvailable?: boolean;
  onAutoFix?: () => void;
  selected?: boolean;
  onSelect?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const evidence = sandboxEvidence ?? getCheckedForCopy(issue);
  const verified = isSandboxVerified(issue);
  const detection = getDetectionCopy(issue);
  const confidence = getConfidenceCopy(issue);

  return (
    <article
      className={cn(
        "rounded-[5px] border border-border bg-card p-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-transform duration-150 hover:scale-[1.01]",
        selected && "border-l-[3px] border-l-primary",
        onSelect && "cursor-pointer",
      )}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={issue.severity} />
            {verified && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                <CheckCircle2 className="h-3 w-3" />
                Sandbox evidence
                {issue.verifiedAt && ` · ${formatDistanceToNow(new Date(issue.verifiedAt))} ago`}
              </span>
            )}
          </div>
          <h3 className="mt-1.5 text-sm font-semibold text-foreground">{issue.title}</h3>
          {!compact && issue.why && (
            <p className="mt-1 text-xs text-muted-foreground">{issue.why}</p>
          )}
        </div>
      </div>

      {!compact && <FindingWhyAndEvidence issue={issue} />}

      {evidence && (
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 text-xs text-data hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          {open ? "Hide evidence" : "Sandbox evidence"}
        </button>
      )}

      {open && evidence && (
        <pre className="app-terminal mt-2 max-h-40 overflow-auto rounded-[5px] p-3 font-mono text-[11px] leading-relaxed">
          {evidence}
          {detection && `\n\nDetection: ${detection}`}
          {confidence?.note && `\n${confidence.note}`}
        </pre>
      )}

      {!compact && (
        <p className="mt-2 max-w-[85ch] text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Why this matters: </span>
          {getWhyItMattersCopy(issue)}
        </p>
      )}

      {aiFixAvailable && onAutoFix && (
        <button
          type="button"
          className="mt-3 inline-flex h-9 items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-[#00c990]"
          onClick={(e) => {
            e.stopPropagation();
            onAutoFix();
          }}
        >
          Fix with PR
        </button>
      )}
    </article>
  );
}
