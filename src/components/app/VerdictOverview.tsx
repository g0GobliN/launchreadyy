import { AlertTriangle, Loader2, Rocket } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ReadinessGauge } from "@/components/app/ReadinessGauge";
import { ScoreTrendCard, type ScoreTrendPoint } from "@/components/app/ScoreTrendCard";
import type { LaunchChecklistItem } from "@/lib/readiness/types";

type Severity = "critical" | "high" | "medium" | "low";

/**
 * Counts, in the order a launch decision is actually made: what stops you, then what to weigh.
 * Colour is carried by the status palette but never alone — every row is named.
 */
const SEVERITY_ROWS: Array<{ severity: Severity; label: string; tone: string }> = [
  { severity: "critical", label: "Blockers", tone: "text-critical" },
  { severity: "high", label: "High", tone: "text-warning" },
  { severity: "medium", label: "Medium", tone: "text-foreground" },
  { severity: "low", label: "Low", tone: "text-muted-foreground" },
];

function SummaryRow({
  label,
  value,
  tone = "text-foreground",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2.5 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

export function VerdictOverview({
  score,
  headline,
  summary,
  sandboxStatus,
  scannedAt,
  scannedAtIso,
  verifiedAtIso,
  issues,
  checklist,
  history,
  isUnsupported,
  unsupportedMessage,
  onRerun,
  rerunning,
  rerunError,
}: {
  score: number;
  headline: string;
  summary: string;
  sandboxStatus: string | null;
  scannedAt: string;
  scannedAtIso: string | null;
  verifiedAtIso: string | null;
  issues: Array<{ severity: string }>;
  checklist: LaunchChecklistItem[] | null | undefined;
  history: ScoreTrendPoint[];
  isUnsupported: boolean;
  unsupportedMessage: string;
  onRerun: () => void;
  rerunning: boolean;
  rerunError: string | null;
}) {
  const countOf = (s: Severity) => issues.filter((i) => i.severity === s).length;

  const verifiedAgo = verifiedAtIso
    ? formatDistanceToNow(new Date(verifiedAtIso), { addSuffix: true })
    : null;
  // A verification materially newer than the scan it belongs to means the commit was unchanged
  // and the scan came from cache. A couple of minutes apart is just one normal run.
  const reusedScan =
    Boolean(verifiedAtIso && scannedAtIso) &&
    new Date(verifiedAtIso!).getTime() - new Date(scannedAtIso!).getTime() > 5 * 60_000;
  const checklistReady = checklist?.filter((c) => c.status === "pass").length ?? 0;
  const checklistTotal = checklist?.length ?? 0;

  return (
    // Two across from md, three only at xl: at lg a third of the row leaves the gauge fighting
    // its own verdict text for space.
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <section className="rounded-[5px] border border-border bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Readiness score
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-5">
          {isUnsupported ? (
            <AlertTriangle className="h-10 w-10 shrink-0 text-muted-foreground" />
          ) : (
            <ReadinessGauge score={score} size={104} />
          )}
          <div className="min-w-[10rem] flex-1">
            <p className="text-lg font-semibold leading-snug text-foreground">
              {isUnsupported ? "Unsupported repository" : headline}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {isUnsupported ? unsupportedMessage : summary}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {sandboxStatus === "skipped" ? "Not build-verified" : "Build verified"}
          {verifiedAgo ? ` · ${verifiedAgo}` : ` · scanned ${scannedAt}`}
        </p>
        {/* Answers the obvious "I just ran this, why does it say an hour ago?" — the code hadn't
            changed, so the scan was reused and only the verification is new. */}
        {reusedScan && (
          <p className="mt-1 text-xs text-muted-foreground">
            No new commits since your last scan {scannedAt} — reused the existing result.
          </p>
        )}
        {/* One action, and it covers everything: new commits, and env var / build setting edits,
            which now invalidate a reused pass on their own (sandbox-verify/reuse.ts). */}
        <button
          type="button"
          onClick={onRerun}
          disabled={rerunning}
          className="mt-3 inline-flex items-center gap-1.5 rounded-[5px] border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
        >
          {rerunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Rocket className="h-3.5 w-3.5" />
          )}
          {rerunning ? "Starting…" : "Re-analyze"}
        </button>
        <p className="mt-2 text-xs text-muted-foreground">
          Checks your code and builds it again. Picks up new commits, env vars and build settings.
        </p>
        {rerunError && <p className="mt-2 text-xs text-critical">{rerunError}</p>}
      </section>

      <section className="rounded-[5px] border border-border bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Summary
        </h2>
        <div className="mt-3">
          <SummaryRow label="Total findings" value={issues.length} />
          {SEVERITY_ROWS.map((row) => (
            <SummaryRow
              key={row.severity}
              label={row.label}
              value={countOf(row.severity)}
              tone={countOf(row.severity) > 0 ? row.tone : "text-muted-foreground"}
            />
          ))}
          {checklistTotal > 0 && (
            <SummaryRow
              label="Launch checklist"
              value={`${checklistReady} / ${checklistTotal}`}
              tone={checklistReady === checklistTotal ? "text-success" : "text-foreground"}
            />
          )}
        </div>
      </section>

      <ScoreTrendCard history={history} />
    </div>
  );
}
