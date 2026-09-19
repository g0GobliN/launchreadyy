import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { Issue, LaunchTarget, LaunchTimeline } from "@/lib/mock-data";
import {
  launchVerdictForScan,
  pickTop3ForLaunch,
  pickTopLaunchBlockers,
} from "@/lib/launch-blockers";
import { isAutoFixableFixId } from "@/lib/readiness/enrich-finding";
import { SeverityBadge } from "@/components/ui-bits";
import { FindingWhyAndEvidence } from "@/components/finding-evidence";
import { AlertOctagon, ArrowRight, CheckCircle2, Share2, ShieldAlert } from "lucide-react";

const VERDICT_STYLE: Record<string, { border: string; bg: string; text: string }> = {
  not_ready: {
    border: "border-critical/40",
    bg: "bg-critical/5",
    text: "text-critical",
  },
  conditional: {
    border: "border-warning/40",
    bg: "bg-warning/5",
    text: "text-warning",
  },
  ready: {
    border: "border-success/40",
    bg: "bg-success/5",
    text: "text-success",
  },
};

export function LaunchBlockersPanel({
  repoId,
  score,
  issues,
  checklistFailed = 0,
  compact = false,
  launchTarget = null,
  launchTimeline = null,
  onAcceptRisk,
}: {
  repoId: string;
  score: number;
  issues: Issue[];
  checklistFailed?: number;
  compact?: boolean;
  launchTarget?: LaunchTarget | null;
  launchTimeline?: LaunchTimeline | null;
  onAcceptRisk?: (payload: {
    fixId: string;
    reasonType: "temporary" | "wont_fix" | "false_positive" | "not_applicable";
    note?: string;
  }) => Promise<void>;
}) {
  const blockers = pickTopLaunchBlockers(issues, compact ? 3 : 5);
  const verdict = launchVerdictForScan(score, issues, checklistFailed);
  const style = VERDICT_STYLE[verdict.verdict] ?? VERDICT_STYLE.conditional;
  const prioritized = useMemo(
    () => pickTop3ForLaunch(issues, { launchTarget, launchTimeline }),
    [issues, launchTarget, launchTimeline],
  );
  const prioritizedIds = useMemo(() => new Set(prioritized.map((i) => i.id)), [prioritized]);
  const deferred = useMemo(
    () =>
      issues
        .filter((issue) => !prioritizedIds.has(issue.id))
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)),
    [issues, prioritizedIds],
  );

  if (blockers.length === 0 && verdict.verdict === "ready") {
    return (
      <div className="rounded-xl border border-success/40 bg-success/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-9 w-9 place-items-center rounded-lg bg-success/10">
              <CheckCircle2 className="h-5 w-5 text-success" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-success">
                Production ready
              </div>
              <h2 className="font-display text-lg font-semibold">
                Your repo has the production foundation covered.
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                CI is running, tests exist, env is documented, and deployment is configured. This is
                what senior engineers set up on day one — you've already done it.
              </p>
            </div>
          </div>
          <Link
            to="/repo/$repoId/blockers"
            params={{ repoId }}
            className="inline-flex items-center gap-1 text-xs text-success hover:underline"
          >
            Full report <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <Share2 className="h-3.5 w-3.5 shrink-0" />
          Share your score below — a {score}/100 is worth showing off.
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 grid h-9 w-9 place-items-center rounded-lg ${style.bg}`}>
            {verdict.verdict === "ready" ? (
              <ShieldAlert className={`h-5 w-5 ${style.text}`} />
            ) : (
              <AlertOctagon className={`h-5 w-5 ${style.text}`} />
            )}
          </div>
          <div>
            <div className={`text-xs font-semibold uppercase tracking-widest ${style.text}`}>
              Launch verdict
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-semibold">{verdict.headline}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{verdict.summary}</p>
            <p className="mt-1 text-xs text-muted-foreground">Score: {score}/100</p>
          </div>
        </div>
        {!compact && (
          <Link
            to="/repo/$repoId/blockers"
            params={{ repoId }}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Full blocker report <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      {prioritized.length > 0 && (
        <ol className="mt-5 space-y-3">
          {prioritized.map((b, i) => (
            <BlockerRow
              key={b.id}
              index={i + 1}
              blocker={b}
              repoId={repoId}
              onAcceptRisk={onAcceptRisk}
            />
          ))}
        </ol>
      )}

      {deferred.length > 0 && (
        <details className="mt-4 rounded-lg border border-border bg-card/70 p-3">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            {deferred.length} other issues - safe to postpone until after launch
          </summary>
          <ol className="mt-3 space-y-2">
            {deferred.map((issue) => (
              <li key={issue.id} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <span>{issue.title}</span>
                  <SeverityBadge severity={issue.severity} />
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function BlockerRow({
  index,
  blocker,
  repoId,
  onAcceptRisk,
}: {
  index: number;
  blocker: Issue;
  repoId: string;
  onAcceptRisk?: (payload: {
    fixId: string;
    reasonType: "temporary" | "wont_fix" | "false_positive" | "not_applicable";
    note?: string;
  }) => Promise<void>;
}) {
  const canFix = isAutoFixableFixId(blocker.fixId);
  const [showAccept, setShowAccept] = useState(false);
  const [reasonType, setReasonType] = useState<
    "temporary" | "wont_fix" | "false_positive" | "not_applicable"
  >("temporary");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <li className="rounded-lg border border-border bg-card/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">Fix before launch #{index}</span>
        <span className="font-medium text-sm">{blocker.title}</span>
        <SeverityBadge severity={blocker.severity} />
        <span className="text-xs text-muted-foreground">effort: ~{blocker.timeSaved}</span>
        {blocker.riskLevel === "blocker" && (
          <span className="rounded-full bg-critical/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-critical">
            Blocker
          </span>
        )}
      </div>
      <FindingWhyAndEvidence issue={blocker} />
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {canFix && (
          <Link
            to="/repo/$repoId/fix"
            params={{ repoId }}
            search={{ fixes: blocker.fixId }}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Preview fix <ArrowRight className="h-3 w-3" />
          </Link>
        )}
        {onAcceptRisk && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setShowAccept((v) => !v)}
          >
            {showAccept ? "Cancel" : "Accept risk"}
          </button>
        )}
      </div>
      {showAccept && onAcceptRisk && (
        <form
          className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setSubmitting(true);
            try {
              await onAcceptRisk({ fixId: blocker.fixId, reasonType, note });
              setShowAccept(false);
              setNote("");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <select
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            value={reasonType}
            onChange={(e) => setReasonType(e.target.value as typeof reasonType)}
          >
            <option value="temporary">Temporary</option>
            <option value="wont_fix">Won't fix</option>
            <option value="false_positive">False positive</option>
            <option value="not_applicable">Not applicable</option>
          </select>
          <textarea
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            rows={2}
            placeholder="Optional note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60"
          >
            {submitting ? "Saving..." : "Save acceptance"}
          </button>
        </form>
      )}
    </li>
  );
}
