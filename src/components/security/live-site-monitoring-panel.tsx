"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Activity, AlertTriangle, Pause, Play } from "lucide-react";
import { MonitoringCard, Sparkline } from "@/components/app/MonitoringCard";
import { setLiveSiteMonitorEnabledFn } from "@/lib/api/monitor.functions";
import type { LiveSiteMonitorState } from "@/lib/services/security/live-site-monitor.server";
import { liveScanPoints, type LiveScanPoint } from "@/lib/live-scan-points";

/** Ownership confirmation has lapsed, so scheduled monitoring will skip this domain. */
function isLapsed(monitor: LiveSiteMonitorState): boolean {
  if (!monitor.confirmationExpiresAt) return true;
  return new Date(monitor.confirmationExpiresAt).getTime() <= Date.now();
}

/**
 * Live-site monitoring: scheduled re-scans of the deployed domains.
 *
 * These re-scans run on a fixed cadence with nothing on the page saying so — a feature the
 * operator had no way to observe.
 *
 * Two layouts, because one domain and eight domains are different questions. Alone, a
 * domain gets the full card: there is nothing to compare it against, so the space goes to
 * detail. Past that the question becomes "which of these is sliding?", and stacking full
 * cards answers it worst — a wall of near-identical blocks the reader has to scroll and
 * hold in their head. The compact list puts every domain's trend on one screen instead.
 */
export function LiveSiteMonitoringPanel({
  monitors,
  history = [],
}: {
  monitors: LiveSiteMonitorState[];
  /** Newest-first, as the scan list returns it. */
  history?: LiveScanPoint[];
}) {
  if (monitors.length === 0) return null;

  if (monitors.length === 1) {
    const monitor = monitors[0]!;
    const points = liveScanPoints(history, monitor.domain);
    return (
      <MonitoringCard
        title={monitor.domain}
        cadence={monitor.cadence}
        enabled={monitor.enabled}
        lastCheckedAt={monitor.lastCheckedAt}
        onToggle={async (enabled) => {
          await setLiveSiteMonitorEnabledFn({ data: { domain: monitor.domain, enabled } });
        }}
        points={points}
        chartLabel={`Security score history for ${monitor.domain}`}
        emptyChartHint={<>The trend appears after the second scan of {monitor.domain}.</>}
        warning={
          isLapsed(monitor)
            ? `Ownership confirmation has expired — scan ${monitor.domain} and re-confirm to resume automatic checks.`
            : null
        }
        note={
          <>
            {points.length >= 2 && `${points.length} scans · `}
            Watching for new exposure — certificate expiry, missing headers, and anything newly
            reachable. We email you when a high-severity issue appears.
          </>
        }
      />
    );
  }

  const cadence = monitors[0]!.cadence;
  const sameCadence = monitors.every((m) => m.cadence === cadence);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
        <div>
          <h3 className="text-sm font-medium">Monitoring</h3>
          <p className="text-xs text-muted-foreground">
            {monitors.length} domains
            {sameCadence && ` · re-scanned ${cadence}`} · we email you when a high-severity issue
            appears
          </p>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {monitors.map((monitor) => (
          <MonitorRow
            key={monitor.domain}
            monitor={monitor}
            points={liveScanPoints(history, monitor.domain)}
          />
        ))}
      </ul>
    </div>
  );
}

function MonitorRow({
  monitor,
  points,
}: {
  monitor: LiveSiteMonitorState;
  points: Array<{ value: number; at: string }>;
}) {
  const [enabled, setEnabled] = useState(monitor.enabled);
  const [saving, setSaving] = useState(false);
  const latest = points[points.length - 1];
  const lapsed = isLapsed(monitor);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    setEnabled(next); // optimistic — the only failure mode is it flips back
    try {
      await setLiveSiteMonitorEnabledFn({ data: { domain: monitor.domain, enabled: next } });
    } catch {
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="p-3 sm:px-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{monitor.domain}</p>
          <p className="truncate text-xs text-muted-foreground">
            {enabled
              ? monitor.lastCheckedAt
                ? `${monitor.cadence} · ${formatDistanceToNow(new Date(monitor.lastCheckedAt), { addSuffix: true })}`
                : monitor.cadence
              : "Paused"}
          </p>
        </div>

        {/* Hidden on the narrowest screens: at that width the line is too short to read a
            shape from, and the score beside it already carries the number. */}
        {points.length >= 2 && (
          <div className="hidden w-24 shrink-0 sm:block">
            <Sparkline
              points={points}
              label={`Security score history for ${monitor.domain}`}
              className="h-8 w-full"
            />
          </div>
        )}

        <div className="w-14 shrink-0 text-right">
          {latest ? (
            <span className="text-sm font-medium tabular-nums">{latest.value}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
          <span className="block text-[10px] text-muted-foreground">
            {latest ? "/ 100" : "no scan"}
          </span>
        </div>

        <button
          type="button"
          onClick={toggle}
          disabled={saving}
          aria-pressed={enabled}
          aria-label={`${enabled ? "Pause" : "Resume"} monitoring for ${monitor.domain}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {enabled ? (
            <>
              <Pause className="h-3 w-3" aria-hidden /> Pause
            </>
          ) : (
            <>
              <Play className="h-3 w-3" aria-hidden /> Resume
            </>
          )}
        </button>
      </div>

      {lapsed && enabled && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>Ownership confirmation expired — re-confirm to resume automatic checks.</span>
        </p>
      )}
    </li>
  );
}
