import type { LaunchReportData } from "@/lib/launch-report.server";
import type { Issue } from "@/lib/mock-data";
import { SeverityBadge } from "@/components/ui-bits";
import { ReadinessGauge } from "@/components/app/ReadinessGauge";
import { CategoryBreakdown, LaunchChecklistPanel, StackTags } from "@/components/readiness-panel";
import { getCheckedForCopy, getConfidenceCopy } from "@/lib/finding-evidence";
import { installLaunchReportPrintLift } from "@/lib/print-launch-report";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";

const VERDICT_STYLE: Record<
  LaunchReportData["verdict"],
  { icon: typeof CheckCircle2; label: string; pill: string }
> = {
  ready: {
    icon: CheckCircle2,
    label: "Ready to launch",
    pill: "border-success/40 bg-success/10 text-success",
  },
  conditional: {
    icon: AlertTriangle,
    label: "Conditional",
    pill: "border-warning/40 bg-warning/10 text-warning",
  },
  not_ready: {
    icon: XCircle,
    label: "Not ready",
    pill: "border-critical/40 bg-critical/10 text-critical",
  },
};

export function LaunchReportDocument({
  report,
  publicView = false,
}: {
  report: LaunchReportData;
  publicView?: boolean;
}) {
  const v = VERDICT_STYLE[report.verdict];
  const Icon = v.icon;
  const scannedDate = format(new Date(report.scannedAt), "MMM d, yyyy 'at' h:mm a");
  const rootRef = useRef<HTMLElement>(null);
  const delta =
    report.previousScore != null && report.previousScore !== report.score
      ? report.score - report.previousScore
      : null;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    return installLaunchReportPrintLift(el);
  }, []);

  const meta = [
    report.repo.framework,
    report.repo.language,
    report.repo.private ? "Private repo" : "Public repo",
    `Scanned ${scannedDate}`,
  ].filter(Boolean);

  return (
    <article
      ref={rootRef}
      className={`launch-report-document ${publicView ? "public-report" : ""}`}
    >
      <header className="report-no-break rounded-[5px] border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Launch report
            </h2>
            <h1 className="mt-1.5 text-lg font-semibold leading-snug">{report.repo.name}</h1>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{report.repo.fullName}</p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${v.pill}`}
          >
            <Icon className="h-3 w-3" />
            {v.label}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-5">
          <ReadinessGauge score={report.score} size={104} />
          <div className="min-w-[10rem] flex-1">
            <p className="text-lg font-semibold leading-snug text-foreground">
              {report.verdictHeadline}
            </p>
            <p className="mt-1 max-w-[85ch] text-sm leading-relaxed text-muted-foreground">
              {report.verdictSummary}
            </p>
            {delta != null && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                <span className={delta > 0 ? "text-success" : "text-critical"}>
                  {delta > 0 ? "+" : ""}
                  {delta}
                </span>{" "}
                since the last scan (was {report.previousScore})
              </p>
            )}
          </div>
        </div>

        {report.repo.description && (
          <p className="mt-4 max-w-[85ch] text-sm text-muted-foreground">
            {report.repo.description}
          </p>
        )}

        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          {meta.join(" · ")}
        </p>
      </header>

      <section className="report-no-break mt-4 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Launch blockers"
          value={report.blockers.length}
          caption={report.blockers.length ? "must be fixed first" : "nothing blocking release"}
          tone={report.blockers.length ? "text-critical" : "text-success"}
        />
        <Stat
          label="Launch checklist"
          value={`${report.checklistStats.passed} / ${report.checklistStats.total}`}
          caption={
            report.checklistStats.failed
              ? `${report.checklistStats.failed} item${report.checklistStats.failed > 1 ? "s" : ""} still open`
              : "every item passing"
          }
          tone={report.checklistStats.failed ? "text-warning" : "text-success"}
        />
        <Stat
          label="Fix PRs merged"
          value={report.completedFixCount}
          caption={report.completedFixCount ? "shipped through LaunchReadyy" : "none merged yet"}
        />
      </section>

      {report.stackDetected && (
        <section className="report-no-break mt-4 rounded-[5px] border border-border bg-card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Stack profile
          </h2>
          <p className="mt-2 text-sm font-medium">{report.stackDetected.profile}</p>
          <StackTags stack={report.stackDetected} />
        </section>
      )}

      {report.blockers.length > 0 && (
        <section className="report-allow-break mt-6">
          <SectionHeading
            title="Launch blockers"
            count={report.blockers.length}
            note="Ship-stopping problems. Fix these before anyone sees the product."
          />
          <div className="mt-3 space-y-3">
            {report.blockers.map((issue) => (
              <FindingBlock key={issue.id} issue={issue} blocker />
            ))}
          </div>
        </section>
      )}

      {report.fixBeforeLaunch.length > 0 && (
        <section className="report-allow-break mt-6">
          <SectionHeading
            title="Fix before launch"
            count={report.fixBeforeLaunch.length}
            note="Not blocking, but each one bites within the first weeks of real traffic."
          />
          <div className="mt-3 space-y-3">
            {report.fixBeforeLaunch.map((issue) => (
              <FindingBlock key={issue.id} issue={issue} />
            ))}
          </div>
        </section>
      )}

      <div className="report-allow-break mt-6 grid gap-4 lg:grid-cols-2">
        {report.checklist.length > 0 && (
          <div className="report-no-break rounded-[5px] border border-border bg-card p-5">
            <LaunchChecklistPanel items={report.checklist} />
          </div>
        )}
        {report.categoryScores.length > 0 && (
          <div className="report-no-break rounded-[5px] border border-border bg-card p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Category scores
            </h2>
            <CategoryBreakdown scores={report.categoryScores} />
          </div>
        )}
      </div>

      <footer className="report-no-break mt-6 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        <p className="max-w-[85ch]">{report.disclaimer}</p>
        <p className="mt-1.5">Generated by LaunchReadyy Community</p>
      </footer>
    </article>
  );
}

function Stat({
  label,
  value,
  caption,
  tone = "text-foreground",
}: {
  label: string;
  value: string | number;
  caption: string;
  tone?: string;
}) {
  return (
    <div className="rounded-[5px] border border-border bg-card p-4">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

function SectionHeading({ title, count, note }: { title: string; count: number; note: string }) {
  return (
    <div className="report-no-break">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
        <span className="rounded-full border border-border px-1.5 py-px text-[10px] tabular-nums">
          {count}
        </span>
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function FindingBlock({ issue, blocker = false }: { issue: Issue; blocker?: boolean }) {
  const checkedForCopy = getCheckedForCopy(issue);
  const confidence = getConfidenceCopy(issue);

  return (
    <div className="report-no-break rounded-[5px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium leading-snug">{issue.title}</span>
        {blocker ? (
          <span className="rounded-full border border-critical/40 bg-critical/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-critical">
            Blocker
          </span>
        ) : (
          <SeverityBadge severity={issue.severity} />
        )}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {issue.category}
        </span>
      </div>

      <p className="mt-1 max-w-[85ch] text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Why this matters: </span>
        {issue.businessImpact ?? issue.why}
      </p>
      {issue.productionScenario && (
        <p className="mt-1 max-w-[85ch] text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Production risk: </span>
          {issue.productionScenario}
        </p>
      )}
      {issue.recommendedFix && (
        <p className="mt-1 max-w-[85ch] text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Recommended fix: </span>
          {issue.recommendedFix}
        </p>
      )}
      {checkedForCopy && (
        <p className="mt-2 max-w-[85ch] text-xs text-muted-foreground">
          <span className="font-medium text-foreground">What we checked: </span>
          {checkedForCopy}
          {confidence && (
            <span className="ml-1 rounded-full border border-border px-1.5 py-px text-[10px] uppercase tracking-wide">
              {confidence.label} confidence
            </span>
          )}
        </p>
      )}
    </div>
  );
}
