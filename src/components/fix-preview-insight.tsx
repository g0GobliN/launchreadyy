import type { FixPreviewInsight } from "@/lib/fix-preview-insight.server";
import { GitBranch, Layers, Server, Variable } from "lucide-react";

export function FixPreviewInsightPanel({ insight }: { insight: FixPreviewInsight | null }) {
  if (!insight) return null;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Server className="h-4 w-4 text-primary" />
        CI intelligence (from your code)
      </div>
      <p className="text-sm text-muted-foreground">{insight.ciSummary}</p>

      {insight.ciRelevant && (
        <>
          <InsightSection title="Pipeline jobs" icon={<GitBranch className="h-3.5 w-3.5" />}>
            <TagList items={insight.ciJobs} />
          </InsightSection>
          <InsightSection title="Quality gates" icon={<Layers className="h-3.5 w-3.5" />}>
            <TagList items={insight.ciSteps} />
          </InsightSection>
        </>
      )}

      {(insight.buildEnvVars.length > 0 || insight.testEnvVars.length > 0) && (
        <InsightSection title="Env vars injected in CI" icon={<Variable className="h-3.5 w-3.5" />}>
          {insight.buildEnvVars.length > 0 && (
            <div className="text-xs">
              <span className="font-medium text-muted-foreground">Build job: </span>
              <span className="font-mono">{insight.buildEnvVars.join(", ")}</span>
            </div>
          )}
          {insight.testEnvVars.length > 0 && (
            <div className="mt-1 text-xs">
              <span className="font-medium text-muted-foreground">Test job: </span>
              <span className="font-mono">{insight.testEnvVars.join(", ")}</span>
            </div>
          )}
        </InsightSection>
      )}

      {insight.monorepoPackages.length > 0 && (
        <InsightSection title="Monorepo packages" icon={<Layers className="h-3.5 w-3.5" />}>
          <TagList items={insight.monorepoPackages} />
        </InsightSection>
      )}

      {insight.integrations.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Detected: {insight.integrations.join(" · ")}
        </div>
      )}

      {insight.bundledFixIds.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Production CI also bundles:{" "}
          <span className="font-mono">{insight.bundledFixIds.join(", ")}</span>
        </p>
      )}

      {insight.verificationNotes.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground border-t border-border/60 pt-3">
          {insight.verificationNotes.map((n) => (
            <li
              key={`${n.fixId}-${n.note}`}
              className={n.status === "warning" ? "text-warning" : ""}
            >
              {n.status === "warning" ? "⚠ " : "✓ "}
              {n.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InsightSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px]"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
