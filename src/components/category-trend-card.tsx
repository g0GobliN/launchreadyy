"use client";

import type { CategoryTrend } from "@/lib/finding-fingerprint";

export function CategoryTrendCard({ trend }: { trend: CategoryTrend }) {
  const deltaLabel =
    trend.delta == null
      ? null
      : trend.delta > 0
        ? `↑ +${trend.delta}`
        : trend.delta < 0
          ? `↓ ${trend.delta}`
          : "→ 0";

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{trend.category}</h3>
        <div className="text-right">
          <span className="text-lg font-semibold tabular-nums">{trend.currentScore}</span>
          {deltaLabel && (
            <span
              className={`ml-2 text-xs ${
                (trend.delta ?? 0) > 0
                  ? "text-success"
                  : (trend.delta ?? 0) < 0
                    ? "text-critical"
                    : "text-muted-foreground"
              }`}
            >
              {deltaLabel}
              {trend.previousScore != null && (
                <span className="text-muted-foreground"> vs last scan</span>
              )}
            </span>
          )}
        </div>
      </div>
      {trend.topImprovement && (
        <p className="text-xs text-muted-foreground">
          Top improvement: <span className="text-foreground">{trend.topImprovement}</span>
        </p>
      )}
      {trend.topRegression && (
        <p className="text-xs text-muted-foreground">
          Top regression: <span className="text-foreground">{trend.topRegression}</span>
        </p>
      )}
      {(trend.resolved.length > 0 || trend.newTitles.length > 0) && (
        <div className="grid gap-2 sm:grid-cols-2 text-xs">
          <div>
            <div className="mb-1 font-medium text-success">Resolved</div>
            <ul className="space-y-0.5 text-muted-foreground">
              {trend.resolved.length === 0 && <li>—</li>}
              {trend.resolved.map((t) => (
                <li key={t}>✓ {t}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 font-medium text-warning">New</div>
            <ul className="space-y-0.5 text-muted-foreground">
              {trend.newTitles.length === 0 && <li>—</li>}
              {trend.newTitles.map((t) => (
                <li key={t}>• {t}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
