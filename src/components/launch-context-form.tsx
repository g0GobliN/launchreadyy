import { useState } from "react";
import type { LaunchTarget, LaunchTimeline } from "@/lib/mock-data";

export function LaunchContextForm({
  onSave,
}: {
  onSave: (payload: {
    launchTarget: LaunchTarget;
    launchTimeline: LaunchTimeline;
  }) => Promise<void>;
}) {
  const [launchTarget, setLaunchTarget] = useState<LaunchTarget>("mvp");
  const [launchTimeline, setLaunchTimeline] = useState<LaunchTimeline>("today");
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);

  if (dismissed) return null;

  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-4">
      <h3 className="font-medium">Personalize priorities</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Two quick answers help us rank your critical path for launch.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select
          className="rounded-md border border-border bg-background px-2 py-2 text-sm"
          value={launchTarget}
          onChange={(e) => setLaunchTarget(e.target.value as LaunchTarget)}
        >
          <option value="mvp">MVP users</option>
          <option value="startup">Startup customers</option>
          <option value="enterprise">Enterprise teams</option>
          <option value="oss">Open source users</option>
          <option value="product_hunt">Product Hunt launch</option>
          <option value="investors">Investors</option>
        </select>
        <select
          className="rounded-md border border-border bg-background px-2 py-2 text-sm"
          value={launchTimeline}
          onChange={(e) => setLaunchTimeline(e.target.value as LaunchTimeline)}
        >
          <option value="today">Today</option>
          <option value="this_week">This week</option>
          <option value="this_month">This month</option>
          <option value="exploring">Exploring</option>
        </select>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={saving}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({ launchTarget, launchTimeline });
              setDismissed(true);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving..." : "Save context"}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
