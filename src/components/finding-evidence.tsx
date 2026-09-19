import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Issue } from "@/lib/mock-data";
import {
  getCheckedForCopy,
  getConfidenceCopy,
  getDetectionCopy,
  getWhyItMattersCopy,
  isSandboxVerified,
} from "@/lib/finding-evidence";
import { CheckCircle2 } from "lucide-react";

/**
 * Always-visible "why this matters" line plus a collapsible "what we checked" evidence
 * disclosure. Shared by every finding-list surface so the two never drift out of sync again.
 */
export function FindingWhyAndEvidence({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false);
  const checkedForCopy = getCheckedForCopy(issue);
  const confidence = getConfidenceCopy(issue);
  const detection = getDetectionCopy(issue);
  const verified = isSandboxVerified(issue);
  const lookedFor =
    issue.checkedFor && issue.checkedFor.length > 0 ? issue.checkedFor.join(", ") : null;
  const evidenceBody = issue.foundEvidence
    ? issue.foundEvidence
    : lookedFor
      ? `Checked: ${lookedFor}. None found.`
      : null;

  return (
    <>
      {verified && (
        <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full border border-success bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
          <CheckCircle2 className="h-3 w-3" />
          Verified in sandbox
          {issue.verifiedAt && ` · ${formatDistanceToNow(new Date(issue.verifiedAt))} ago`}
        </span>
      )}
      {/* The card fills the (now wider) column, but the prose stops at a readable measure —
          a full-width paragraph here runs past 180 characters a line. */}
      <p className="mt-1 max-w-[85ch] text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Why this matters: </span>
        {getWhyItMattersCopy(issue)}
      </p>
      {issue.recommendedFix && (
        <p className="mt-1 max-w-[85ch] text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Recommended fix: </span>
          {issue.recommendedFix}
        </p>
      )}
      {checkedForCopy && evidenceBody && (
        <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
          <CollapsibleTrigger
            type="button"
            onClick={(e) => {
              // Only stop propagation (so the label wrapping FindingCard doesn't also toggle
              // its checkbox) — NOT preventDefault, which would suppress Radix's own internal
              // open/close handler for this trigger.
              e.stopPropagation();
            }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {open ? "▾" : "▸"} What we checked
            {confidence && (
              <span className="ml-1 rounded-full border border-border px-1.5 py-px text-[10px] uppercase tracking-wide">
                {confidence.label} confidence
              </span>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden text-xs data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
            <div className="mt-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
              <p>{evidenceBody}</p>
              {issue.foundEvidence && lookedFor && (
                <p className="mt-1 text-[11px]">Looked for: {lookedFor}</p>
              )}
              {detection && (
                <p className="mt-1">
                  <span className="font-medium text-foreground">Detection: </span>
                  {detection}
                </p>
              )}
              {confidence?.note && <p className="mt-1 italic">{confidence.note}</p>}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}
