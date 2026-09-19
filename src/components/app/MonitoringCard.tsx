"use client";

import { useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { Activity, AlertTriangle, Pause, Play } from "lucide-react";

const W = 260;
const H = 44;
const PAD = 3;

export type MonitorPoint = {
  /** 0-100. Readiness score on the repo card, security score on the live-site card. */
  value: number;
  at: string;
  /** Ran by the monitor rather than by hand. Drawn hollow so the cadence is visible. */
  automatic?: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "24 Jul" from an ISO timestamp, read straight off the UTC parts.
 *
 * Deliberately not toLocaleDateString/toLocaleString: those render in the runtime's zone, so
 * the server produced one string and the browser another, and React threw the whole tree away
 * with a hydration mismatch rather than reusing the server HTML. Anything rendered during SSR
 * has to be timezone-independent or it is not the same string twice.
 */
function utcDayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** First and last date in the series, e.g. "24 Jul – 12 Aug". */
function spanLabel(points: MonitorPoint[]): string {
  const first = utcDayLabel(points[0]!.at);
  const last = utcDayLabel(points[points.length - 1]!.at);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * What the monitor has seen, oldest to newest.
 *
 * Fixed 0-100 domain rather than a fitted one: both scores genuinely live on that scale, and
 * auto-fitting would turn a two-point wobble into a cliff.
 */
export function Sparkline({
  points,
  baseline,
  label,
  className = "h-11 w-full",
}: {
  className?: string;
  points: MonitorPoint[];
  baseline?: number;
  label: string;
}) {
  const step = (W - PAD * 2) / (points.length - 1);
  const y = (v: number) => H - PAD - (Math.max(0, Math.min(100, v)) / 100) * (H - PAD * 2);
  const coords = points.map((p, i) => `${PAD + i * step},${y(p.value)}`);
  const last = points[points.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={`${label}, currently ${last.value} out of 100`}
      preserveAspectRatio="none"
    >
      {baseline !== undefined && (
        <line
          x1={0}
          x2={W}
          y1={y(baseline)}
          y2={y(baseline)}
          className="stroke-border"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
      )}
      <polyline
        points={coords.join(" ")}
        fill="none"
        className="stroke-primary"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((p, i) => (
        <circle
          key={`dot-${p.at}-${i}`}
          cx={PAD + i * step}
          cy={y(p.value)}
          r={p.automatic ? 2 : 2.5}
          className={p.automatic ? "fill-muted-foreground" : "fill-primary"}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* Hit targets, not marks. The dots are ~2px in a chart squashed by
          preserveAspectRatio="none", so hovering one exactly is luck; a full-height band per
          point is what makes the date reachable at all. */}
      {points.map((p, i) => (
        <rect
          key={`hit-${p.at}-${i}`}
          x={PAD + i * step - step / 2}
          y={0}
          width={step}
          height={H}
          fill="transparent"
        >
          <title>{`${p.value}/100 · ${p.automatic ? "automatic check" : "manual scan"} · ${utcDayLabel(p.at)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/**
 * "Something is watching this, here is when it last looked, here is the switch."
 *
 * Shared because there are two monitors — repo re-scans and live-site re-scans — and they
 * answer the same three questions. The subject differs; the card does not. Keeping one
 * component is also what stops the two from drifting into different words for one idea.
 *
 * Purely presentational: callers own the fetch and the toggle.
 */
export function MonitoringCard({
  title = "Monitoring",
  cadence,
  enabled: initialEnabled,
  lastCheckedAt,
  onToggle,
  note,
  warning,
  points = [],
  baseline,
  chartLabel = "Score history",
  emptyChartHint,
}: {
  /** The subject being watched. Defaults to the generic label; the live-site cards name the domain. */
  title?: string;
  cadence: "daily" | "weekly";
  enabled: boolean;
  lastCheckedAt: string | null;
  onToggle: (next: boolean) => Promise<void>;
  /** What this monitor does for the user — one line, plain words. */
  note?: ReactNode;
  /** Surfaces a monitor that is enabled but silently not running. */
  warning?: ReactNode;
  /** Oldest-first. Fewer than two and the chart is replaced by emptyChartHint. */
  points?: MonitorPoint[];
  /** Optional dashed reference line, e.g. the score below which a blocker exists. */
  baseline?: number;
  chartLabel?: string;
  emptyChartHint?: ReactNode;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    setEnabled(next); // optimistic — the only failure mode is it flips back
    try {
      await onToggle(next);
    } catch {
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
          <div>
            <h3 className="text-sm font-medium">{title}</h3>
            <p className="text-xs text-muted-foreground">
              {enabled ? `Re-scanned ${cadence}` : "Paused — no automatic re-scans"}
              {lastCheckedAt && enabled && (
                <>
                  {" · last checked "}
                  {formatDistanceToNow(new Date(lastCheckedAt), { addSuffix: true })}
                </>
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={saving}
          aria-pressed={enabled}
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

      {warning && enabled && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{warning}</span>
        </p>
      )}

      {points.length >= 2 ? (
        <div className="space-y-1.5">
          <Sparkline points={points} baseline={baseline} label={chartLabel} />
          {/* Without this the dashed rule and the two dot styles read as decoration —
              the chart says nothing it can be asked about. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden /> manual scan
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" aria-hidden />{" "}
              automatic check
            </span>
            {baseline !== undefined && (
              <span className="inline-flex items-center gap-1">
                <span className="h-px w-3 border-t border-dashed border-border" aria-hidden /> below{" "}
                {baseline} means an unresolved blocker
              </span>
            )}
            {/* The span as text, not "hover for the date". The per-point dates ride an SVG
                <title>, which never fires on touch — on a phone that instruction pointed at
                something unreachable, and the chart had no dates at all. */}
            <span className="sm:ml-auto">{spanLabel(points)}</span>
          </div>
        </div>
      ) : (
        emptyChartHint && <p className="text-xs text-muted-foreground">{emptyChartHint}</p>
      )}

      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
