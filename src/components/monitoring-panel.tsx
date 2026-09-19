"use client";

import type { ScoreHistoryPoint } from "@/lib/api/monitor.functions";
import { setRepoMonitorEnabledFn } from "@/lib/api/monitor.functions";
import { MonitoringCard } from "@/components/app/MonitoringCard";

/** Below this the repo has an unresolved blocker — a different kind of bad than a low score. */
const BLOCKER_BAND = 40;

/**
 * Repo-side monitoring: scheduled re-scans of the code.
 *
 * The sparkline covers the same series as ScoreTrendCard higher up the page, and earns the
 * repeat by marking which scans the monitor ran itself — hollow dots. That is the question
 * this card exists to answer ("is it actually watching?"), and the trend chart cannot show
 * it without becoming about two things at once.
 */
export function MonitoringPanel({
  repoId,
  history,
  monitor,
}: {
  repoId: string;
  history: ScoreHistoryPoint[];
  monitor: { enabled: boolean; cadence: "weekly" | "daily"; lastCheckedAt: string | null } | null;
}) {
  const autoCount = history.filter((p) => p.trigger === "monitor").length;

  return (
    <MonitoringCard
      cadence={monitor?.cadence ?? "weekly"}
      enabled={monitor?.enabled ?? false}
      lastCheckedAt={monitor?.lastCheckedAt ?? null}
      onToggle={async (enabled) => {
        await setRepoMonitorEnabledFn({ data: { repoId, enabled } });
      }}
      points={history.map((p) => ({
        value: p.score,
        at: p.createdAt,
        automatic: p.trigger === "monitor",
      }))}
      baseline={BLOCKER_BAND}
      chartLabel="Readiness score history"
      emptyChartHint={
        <>
          Score history appears after your second scan. New CVEs are checked against your
          dependencies on every run, so findings can change even when your code doesn&apos;t.
        </>
      }
      note={
        history.length >= 2 ? (
          <>
            {history.length} scans
            {autoCount > 0 && ` · ${autoCount} automatic`}
            {" · we email you when a new blocker or high-severity issue appears"}
          </>
        ) : (
          <>We email you when a new blocker or high-severity issue appears.</>
        )
      }
    />
  );
}
