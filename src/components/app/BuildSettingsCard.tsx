import { useCallback, useState } from "react";
import { ChevronRight, Loader2, Save, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveRepoBuildSettingsFn, type getRepoBuildSettingsFn } from "@/lib/api/sandbox.functions";

export type BuildData = Awaited<ReturnType<typeof getRepoBuildSettingsFn>>;

export type BuildSettingsForm = ReturnType<typeof useBuildSettingsForm>;

/**
 * Form state lives in a hook so the launch flow can save these values as part of
 * "Start sandbox" — typing a root directory and then launching has to apply it,
 * not silently run the old configuration because a separate Save was never clicked.
 */
export function useBuildSettingsForm(initial: BuildData) {
  const [rootDir, setRootDir] = useState(initial.settings.rootDir ?? "");
  const [buildCommand, setBuildCommand] = useState(initial.settings.buildCommand ?? "");
  const [nodeVersion, setNodeVersion] = useState(initial.settings.nodeVersion ?? "");
  const [includeTest, setIncludeTest] = useState(initial.settings.includeTest);

  const changed =
    rootDir.trim() !== (initial.settings.rootDir ?? "") ||
    buildCommand.trim() !== (initial.settings.buildCommand ?? "") ||
    nodeVersion.trim() !== (initial.settings.nodeVersion ?? "") ||
    includeTest !== initial.settings.includeTest;

  const save = useCallback(
    async (repoId: string) => {
      await saveRepoBuildSettingsFn({
        data: {
          repoId,
          rootDir: rootDir.trim() || null,
          buildCommand: buildCommand.trim() || null,
          nodeVersion: nodeVersion.trim() || null,
          includeTest,
        },
      });
    },
    [rootDir, buildCommand, nodeVersion, includeTest],
  );

  /** No-op when nothing was touched — keeps the launch path off a needless write. */
  const saveIfChanged = useCallback(
    async (repoId: string) => {
      if (changed) await save(repoId);
    },
    [changed, save],
  );

  return {
    rootDir,
    setRootDir,
    buildCommand,
    setBuildCommand,
    nodeVersion,
    setNodeVersion,
    includeTest,
    setIncludeTest,
    changed,
    save,
    saveIfChanged,
  };
}

const fieldClass =
  "h-10 w-full rounded-xl border border-input bg-background px-3 font-mono text-sm outline-none focus:border-data focus:ring-2 focus:ring-data/20";

/**
 * What we actually ran last time — reference, not input.
 *
 * This used to sit above the form as a bare list of full commands. Our own analyzer steps carry
 * forty exclude flags and an embedded regex, so it rendered as a wall of shell that buried the
 * three fields people came here to edit, and gave no clue which parts of the page were readable
 * versus fillable. Collapsed by default, marked read-only, and each command kept to one line.
 */
function DetectedSteps({ initial }: { initial: BuildData }) {
  if (!initial.lastRun || initial.lastRun.steps.length === 0) return null;
  return (
    <details className="group rounded-[5px] border border-border bg-muted/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
        <span className="font-medium">What we ran last time</span>
        <span className="rounded-full border border-border px-1.5 py-px text-[10px] uppercase tracking-wide">
          Read only
        </span>
        <span className="ml-auto tabular-nums">{initial.lastRun.steps.length} steps</span>
      </summary>
      <ul className="space-y-1 border-t border-border px-3 py-2">
        {initial.lastRun.steps.map((s) => (
          <li key={s.step} className="flex min-w-0 items-baseline gap-2 text-xs">
            <span className="w-24 shrink-0 truncate text-muted-foreground">{s.step}</span>
            {/* One line, always. The full text is in the tooltip and the build log. */}
            <code className="min-w-0 flex-1 truncate font-mono text-foreground" title={s.command}>
              {s.command}
            </code>
            {s.cwd && <span className="shrink-0 text-muted-foreground">{s.cwd}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function BuildSettingsFields({
  form,
  initial,
}: {
  form: BuildSettingsForm;
  initial: BuildData;
}) {
  const detectedBuild = initial.lastRun?.steps.find((s) => s.step === "build")?.command;
  const detectedNode = initial.lastRun?.nodeVersion ?? undefined;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id="build-root-dir"
          label="Root directory"
          hint="Path to the app inside a monorepo, e.g. apps/web. Leave blank to use the repository root."
        >
          <input
            id="build-root-dir"
            className={fieldClass}
            placeholder="repository root"
            value={form.rootDir}
            onChange={(e) => form.setRootDir(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field
          id="build-command"
          label="Build command"
          hint={
            detectedBuild
              ? `Last detected: ${detectedBuild}. Leave blank to keep auto-detect.`
              : "Leave blank to auto-detect from package.json scripts (e.g. npm run build)."
          }
        >
          <input
            id="build-command"
            className={fieldClass}
            placeholder={detectedBuild ?? "npm run build"}
            value={form.buildCommand}
            onChange={(e) => form.setBuildCommand(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field
          id="build-node-version"
          label="Node.js version"
          hint="Use a bare major like 22 to track the latest patch, or a full version. Blank reads .nvmrc / engines."
        >
          <input
            id="build-node-version"
            className={fieldClass}
            placeholder={detectedNode ?? ".nvmrc / engines"}
            value={form.nodeVersion}
            onChange={(e) => form.setNodeVersion(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-[5px] border border-border bg-surface px-3 py-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-[#00e5a8]"
          checked={form.includeTest}
          onChange={(e) => form.setIncludeTest(e.target.checked)}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">Run tests</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
            Off by default. When enabled, we run your test script after the build; a failing test
            blocks launch the same way a failing build does.
          </span>
        </span>
      </label>
    </div>
  );
}

function BuildSectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

/** Compact version for the launch flow — saved by "Start sandbox", so no Save button. */
export function BuildSettingsInline({
  form,
  initial,
}: {
  form: BuildSettingsForm;
  initial: BuildData;
}) {
  return (
    <section className="rounded-[5px] border border-border bg-card p-4 sm:p-5">
      <BuildSectionHeader
        title="Build settings"
        description="We detect these from your repository when possible. Only change a field if something looks wrong — updates are saved automatically when you start the sandbox."
      />
      <BuildSettingsFields form={form} initial={initial} />
      {/* Reference goes after the inputs — the fields are why anyone opens this page. */}
      <div className="mt-4">
        <DetectedSteps initial={initial} />
      </div>
    </section>
  );
}

/**
 * Detected-first, not a blank form: we show what the last run actually did and only
 * ask for a value when our guess was wrong.
 */
export function BuildSettingsCard({ repoId, initial }: { repoId: string; initial: BuildData }) {
  const form = useBuildSettingsForm(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await form.save(repoId);
      setNotice("Saved. The next sandbox build uses these settings.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save build settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={onSave}
      className="rounded-[5px] border border-border bg-card p-4 sm:p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <BuildSectionHeader
        title="Build settings"
        description="Every field below is optional. We detect these from your repository, so only fill one in when our detection is wrong — blank means keep detecting."
      />

      <BuildSettingsFields form={form} initial={initial} />

      {/* Reference goes after the inputs — the fields are why anyone opens this page. */}
      <div className="mt-4">
        <DetectedSteps initial={initial} />
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-foreground/25 bg-muted px-3 py-2 text-sm font-medium text-foreground">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-3 rounded-[5px] border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <div className="mt-4">
        <Button
          type="submit"
          disabled={saving}
          className="h-10 rounded-full bg-primary px-4 font-semibold text-primary-foreground hover:bg-[#00c990]"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save build settings
        </Button>
      </div>
    </form>
  );
}
