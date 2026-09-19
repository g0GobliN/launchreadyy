import type { Severity } from "@/lib/mock-data";

export function SeverityBadge({ severity }: { severity: Severity }) {
  const dot: Record<Severity, string> = {
    critical: "bg-critical",
    high: "bg-warning",
    medium: "bg-accent",
    low: "bg-muted-foreground/40",
  };
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dot[severity]}`} />
      {severity}
    </span>
  );
}

export function ScoreRing({ score, size = 140 }: { score: number; size?: number }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color =
    score >= 80
      ? "var(--color-success)"
      : score >= 60
        ? "var(--color-warning)"
        : "var(--color-critical)";
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--color-border)"
          strokeWidth={10}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={10}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-3xl font-semibold">{score}</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">/ 100</div>
      </div>
    </div>
  );
}
