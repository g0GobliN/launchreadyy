import { useState } from "react";
import type { CategoryScore, Issue, LaunchChecklistItem } from "@/lib/mock-data";
import { isAutoFixableFixId } from "@/lib/readiness/enrich-finding";
import { isLanguageAiTestFix } from "@/lib/language-test-fixes";
import { AI_TEST_COMING_SOON_MESSAGE } from "@/lib/language-setup";
import { getFixEffortLabel, formatFixEffortLabel } from "@/lib/fix-meta";
import { SeverityBadge } from "@/components/ui-bits";
import { FindingWhyAndEvidence } from "@/components/finding-evidence";
import { AlertOctagon, CheckCircle2, Circle, Clock, Coins, Sparkles, Wrench } from "lucide-react";

export function CategoryBreakdown({ scores }: { scores: CategoryScore[] }) {
  const active = scores.filter((s) => s.issueCount > 0);
  if (active.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">All categories clear — strong launch posture.</p>
    );
  }

  return (
    <div className="space-y-2.5">
      {active.map((s) => (
        <div key={s.category}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted-foreground truncate pr-2">{s.category}</span>
            <span
              className={`font-medium tabular-nums ${s.score < 60 ? "text-critical" : s.score < 80 ? "text-warning" : "text-success"}`}
            >
              {s.score}
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-foreground/25 transition-all"
              style={{ width: `${s.score}%` }}
            />
          </div>
          {s.blockerCount > 0 && (
            <div className="mt-0.5 text-[10px] text-critical">
              {s.blockerCount} blocker{s.blockerCount > 1 ? "s" : ""}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function FindingCard({
  issue,
  selected,
  onToggle,
  onAcceptRisk,
  repoUrl,
}: {
  issue: Issue;
  selected: boolean;
  onToggle: () => void;
  onAcceptRisk?: (payload: {
    fixId: string;
    reasonType: "temporary" | "wont_fix" | "false_positive" | "not_applicable";
    note?: string;
  }) => Promise<void>;
  repoUrl?: string;
}) {
  const canSelect = isAutoFixableFixId(issue.fixId);
  const [showAccept, setShowAccept] = useState(false);
  const [reasonType, setReasonType] = useState<
    "temporary" | "wont_fix" | "false_positive" | "not_applicable"
  >("temporary");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);

  const isSecurity = (issue.readinessCategory ?? issue.category) === "Security";

  async function explain() {
    setExplaining(true);
    setExplainError(null);
    try {
      const { explainSecurityFindingFn } = await import("@/lib/api/security.functions");
      const res = await explainSecurityFindingFn({
        data: {
          issue: {
            id: issue.id,
            category: issue.category,
            title: issue.title,
            severity: issue.severity,
            why: issue.why,
            timeSaved: issue.timeSaved,
            fixId: issue.fixId,
            confidence: issue.confidence,
            foundEvidence: issue.foundEvidence,
            checkedFor: issue.checkedFor,
            recommendedFix: issue.recommendedFix,
            autoFixable: issue.autoFixable,
          },
          repoUrl,
        },
      });
      setExplanation(
        [res.whatIsWrong, res.whyItMatters, res.howToFix].filter(Boolean).join("\n\n"),
      );
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : "Explain failed");
    } finally {
      setExplaining(false);
    }
  }

  return (
    <label
      className={`flex cursor-pointer items-start gap-4 p-4 transition hover:bg-surface ${!canSelect ? "opacity-90" : ""}`}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={!canSelect}
        onChange={onToggle}
        className="mt-1 h-4 w-4 accent-[color:var(--color-primary)] disabled:opacity-40"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium leading-snug">{issue.title}</span>
          <SeverityBadge severity={issue.severity} />
        </div>
        <FindingWhyAndEvidence issue={issue} />
        {isSecurity && (
          <div className="mt-2">
            <button
              type="button"
              disabled={explaining}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void explain();
              }}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3" />
              {explaining ? "Explaining…" : "Explain with AI"}
            </button>
            {explainError && <p className="mt-1 text-xs text-critical">{explainError}</p>}
            {explanation && (
              <p className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                {explanation}
              </p>
            )}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {issue.fixDifficulty && (
            <span className="inline-flex items-center gap-1">
              <Wrench className="h-3 w-3" /> {issue.fixDifficulty} fix
            </span>
          )}
          {issue.affectedAudience && <span>Affects: {issue.affectedAudience}</span>}
          {issue.priority != null && <span>Priority #{issue.priority}</span>}
          <span className="inline-flex items-center gap-1 text-primary/70">
            <Clock className="h-3 w-3" /> ~{issue.timeSaved} saved
          </span>
          {canSelect && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Coins className="h-3 w-3" />
              {formatFixEffortLabel(getFixEffortLabel(issue.fixId, issue.riskLevel))}
            </span>
          )}
          {canSelect && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Sparkles className="h-3 w-3" /> Fix PR available
            </span>
          )}
          {!canSelect && isLanguageAiTestFix(issue.fixId) && (
            <span className="text-muted-foreground">{AI_TEST_COMING_SOON_MESSAGE}</span>
          )}
          {issue.source === "auditor" && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <AlertOctagon className="h-3 w-3" /> Auditor
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {onAcceptRisk && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowAccept((v) => !v);
              }}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              {showAccept ? "Cancel" : "Skip for now"}
            </button>
          )}
        </div>
        {showAccept && onAcceptRisk && (
          <form
            className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              setSubmitting(true);
              try {
                await onAcceptRisk({ fixId: issue.fixId, reasonType, note });
                setShowAccept(false);
                setNote("");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <p className="text-xs text-muted-foreground">
              Hides this from your active list. You can undo this at the bottom of the page.
            </p>
            <select
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
              value={reasonType}
              onChange={(e) => setReasonType(e.target.value as typeof reasonType)}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="temporary">I&apos;ll fix it later</option>
              <option value="wont_fix">Not a priority right now</option>
              <option value="false_positive">Scanner got this wrong</option>
              <option value="not_applicable">Doesn&apos;t apply to my project</option>
            </select>
            <textarea
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
              rows={2}
              placeholder="Optional note (e.g. using Railway, no Dockerfile needed)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="submit"
              disabled={submitting}
              onClick={(e) => e.stopPropagation()}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Skip this issue"}
            </button>
          </form>
        )}
      </div>
    </label>
  );
}

export function ReadinessSections({
  issues,
  selected,
  onToggle,
  onAcceptRisk,
}: {
  issues: Issue[];
  selected: Set<string>;
  onToggle: (fixId: string) => void;
  onAcceptRisk?: (payload: {
    fixId: string;
    reasonType: "temporary" | "wont_fix" | "false_positive" | "not_applicable";
    note?: string;
  }) => Promise<void>;
}) {
  const blockers = issues.filter((i) => i.riskLevel === "blocker");
  const fixBefore = issues
    .filter((i) => i.riskLevel === "high" || (i.riskLevel === "medium" && (i.priority ?? 99) <= 5))
    .filter((i) => !blockers.includes(i));
  const canWait = issues.filter((i) => !blockers.includes(i) && !fixBefore.includes(i));

  const sections = [
    {
      key: "blockers",
      title: "Critical blockers",
      subtitle: "Fix before any launch",
      items: blockers,
    },
    {
      key: "before",
      title: "Fix before launch",
      subtitle: "High impact gaps",
      items: fixBefore,
    },
    {
      key: "later",
      title: "Can fix later",
      subtitle: "Improve but not blocking",
      items: canWait,
    },
  ].filter((s) => s.items.length > 0);

  if (sections.length === 0) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/10 p-8 text-center">
        <p className="font-display font-semibold text-success">Launch ready</p>
        <p className="mt-1 text-sm text-muted-foreground">No open findings on this scan.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <div key={section.key}>
          <div className="mb-2">
            <h2 className="font-display text-sm font-semibold uppercase tracking-widest">
              {section.title}
            </h2>
            <p className="text-xs text-muted-foreground">{section.subtitle}</p>
          </div>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {section.items.map((i) => (
              <FindingCard
                key={i.id}
                issue={i}
                selected={selected.has(i.fixId)}
                onToggle={() => onToggle(i.fixId)}
                onAcceptRisk={onAcceptRisk}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function LaunchChecklistPanel({ items }: { items: LaunchChecklistItem[] }) {
  const applicable = items.filter((i) => i.status !== "na");
  const passed = applicable.filter((i) => i.status === "pass").length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Launch checklist
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {passed}/{applicable.length} ready
        </span>
      </div>
      <ul className="space-y-1.5">
        {applicable.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-xs">
            {item.status === "pass" ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-success" />
            ) : (
              <Circle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/50" />
            )}
            <span
              className={item.status === "pass" ? "text-muted-foreground" : "text-foreground/80"}
            >
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StackTags({
  stack,
}: {
  stack: { profile: string; services: string[]; deployTargets: string[] };
}) {
  const tags = [...new Set([...stack.services.slice(0, 4), ...stack.deployTargets.slice(0, 2)])];
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {tags.map((t) => (
        <span
          key={t}
          className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          {t}
        </span>
      ))}
    </div>
  );
}
