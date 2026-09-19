import { createFileRoute, Link, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { RepoNotFound } from "@/components/app/RepoNotFound";
import { z } from "zod";
import { RepoLayout } from "@/components/layouts/RepoLayout";
import {
  EnvironmentVariableTable,
  type EnvVarRowData,
} from "@/components/app/EnvironmentVariableTable";
import { AuthErrorScreen } from "@/components/auth-error-screen";
import { getRepoFn } from "@/lib/api/db.functions";
import {
  deleteRepoEnvVarFn,
  getRepoBuildSettingsFn,
  listRepoEnvVarsFn,
  upsertRepoEnvVarFn,
  upsertRepoEnvVarsBulkFn,
} from "@/lib/api/sandbox.functions";
import {
  BuildSettingsCard,
  BuildSettingsInline,
  useBuildSettingsForm,
  type BuildData,
} from "@/components/app/BuildSettingsCard";
import { triggerScan } from "@/lib/api/github.functions";
import { getSessionUserFn } from "@/lib/api/session.functions";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EyeOff, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardPageHeader } from "@/components/app/DashboardKit";

type DraftEnvRow = {
  id: string;
  key: string;
  value: string;
  useDummy: boolean;
  stored: boolean;
};

/** Parses a pasted .env blob: skips blanks/comments, strips `export `, unwraps quotes. */
function parseEnvBlob(blob: string): { key: string; value: string }[] {
  const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const out: { key: string; value: string }[] = [];
  for (const rawLine of blob.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.replace(/^export\s+/, "");
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!KEY_RE.test(key) || !value) continue;
    out.push({ key, value });
  }
  return out;
}

const envSearchSchema = z.object({
  intent: z.enum(["launch"]).optional(),
});

export const Route = createFileRoute("/repo/$repoId/env")({
  head: () => ({ meta: [{ title: "Environment variables — LaunchReadyy" }] }),
  validateSearch: envSearchSchema,
  component: RepoEnvPage,
  notFoundComponent: () => <RepoNotFound reason="repo" />,
  errorComponent: ({ error }) => <AuthErrorScreen error={error} />,
  loader: async ({ params }) => {
    const [repo, envVars, build] = await Promise.all([
      getRepoFn({ data: { repoId: params.repoId } }),
      listRepoEnvVarsFn({ data: { repoId: params.repoId } }),
      getRepoBuildSettingsFn({ data: { repoId: params.repoId } }),
    ]);
    if (!repo) throw notFound();
    return { repo, envVars, build };
  },
});

function RepoEnvPage() {
  const { repoId } = Route.useParams();
  const { intent } = Route.useSearch();
  const { repo, envVars: initial, build } = Route.useLoaderData();
  const { data: sessionUser } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: Infinity,
  });

  const isLaunch = intent === "launch";

  return (
    <RepoLayout user={sessionUser} repoId={repoId} repoName={repo.name}>
      <DashboardPageHeader
        eyebrow="Verify · Configuration"
        title="Build & environment"
        description={
          <>
            Configure the next sandbox run without touching production. Add build options and
            environment variables, or paste a <code className="font-mono text-xs">.env</code> file.
          </>
        }
      />

      {isLaunch ? (
        <LaunchEnvConfig repoId={repoId} initial={initial} build={build} />
      ) : (
        <div className="space-y-6">
          <BuildSettingsCard repoId={repoId} initial={build} />
          <section>
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-foreground">Environment variables</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Paste a <code className="font-mono">.env</code> into Key, or add one at a time.
                Saved values stay encrypted.
              </p>
            </div>
            <VariablesTab repoId={repoId} initial={initial} />
          </section>
        </div>
      )}
    </RepoLayout>
  );
}

/** True when clipboard text looks like a multi-line .env (paste detection). */
function looksLikeEnvFile(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes("\n") && !trimmed.includes("=")) return false;
  return parseEnvBlob(trimmed).length >= 1 && (trimmed.includes("\n") || /=[^\n]+/.test(trimmed));
}

function mergeEnvEntriesIntoRows(
  prev: DraftEnvRow[],
  entries: { key: string; value: string }[],
): DraftEnvRow[] {
  const withoutBlankDrafts = prev.filter((r) => r.key.trim() || r.value.trim() || r.stored);
  const byKey = new Map(withoutBlankDrafts.filter((r) => r.key.trim()).map((r) => [r.key, r]));
  for (const e of entries) {
    const existing = byKey.get(e.key);
    if (existing) {
      byKey.set(e.key, { ...existing, value: e.value, useDummy: false, stored: false });
    } else {
      byKey.set(e.key, {
        id: `draft-${e.key}-${crypto.randomUUID()}`,
        key: e.key,
        value: e.value,
        useDummy: false,
        stored: false,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Launch-gate env UI —  paste .env into Variable name → auto-split. */
function LaunchEnvConfig({
  repoId,
  initial,
  build,
}: {
  repoId: string;
  initial: Awaited<ReturnType<typeof listRepoEnvVarsFn>>;
  build: BuildData;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const buildForm = useBuildSettingsForm(build);
  const [rows, setRows] = useState<DraftEnvRow[]>(() => {
    if (initial.length > 0) {
      return initial.map((v) => ({
        id: v.id,
        key: v.key,
        value: "",
        useDummy: true,
        stored: true,
      }));
    }
    return [
      {
        id: `draft-new-${crypto.randomUUID()}`,
        key: "",
        value: "",
        useDummy: false,
        stored: false,
      },
    ];
  });
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tableRows: EnvVarRowData[] = useMemo(
    () =>
      rows.map((r) => ({
        id: r.id,
        key: r.key,
        value: r.value,
        required: !r.useDummy,
        useDummy: r.useDummy,
        stored: r.stored,
        editableKey: !r.stored,
      })),
    [rows],
  );

  function ingestEnvPaste(text: string): boolean {
    const entries = parseEnvBlob(text);
    if (entries.length === 0) return false;
    setRows((prev) => mergeEnvEntriesIntoRows(prev, entries));
    setError(null);
    setNotice(
      `Added ${entries.length} variable${entries.length > 1 ? "s" : ""} from paste. Review the table, then start the sandbox.`,
    );
    return true;
  }

  async function launchSandbox(skipConfig: boolean) {
    setLaunching(true);
    setError(null);
    try {
      // Before anything else — a root directory typed here has to apply to the run
      // it launches, including the "skip env" path.
      await buildForm.saveIfChanged(repoId);
      if (skipConfig) {
        sessionStorage.setItem(`env-skip-${repoId}`, "1");
      } else {
        const toSave = rows
          .filter((r) => r.key.trim() && !r.useDummy && r.value.trim())
          .map((r) => ({ key: r.key.trim(), value: r.value }));
        if (toSave.length > 0) {
          await upsertRepoEnvVarsBulkFn({ data: { repoId, entries: toSave } });
        }
        sessionStorage.setItem(`env-skip-${repoId}`, "1");
      }
      // Queued, not finished — the repo page is where the run is watched.
      await triggerScan({ data: { repoId } });
      await navigate({ to: "/repo/$repoId", params: { repoId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start sandbox");
      setLaunching(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <BuildSettingsInline form={buildForm} initial={build} />

      <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-foreground">Environment variables</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Paste a <code className="font-mono">.env</code> into Key, or add rows. Use dummy for
            placeholders.
          </p>
        </div>
        <EnvironmentVariableTable
          rows={tableRows}
          onEnvPaste={ingestEnvPaste}
          onChangeKey={(id, key) =>
            setRows((prev) => prev.map((r) => (r.id === id ? { ...r, key } : r)))
          }
          onChangeValue={(id, value) =>
            setRows((prev) =>
              prev.map((r) => (r.id === id ? { ...r, value, useDummy: false, stored: false } : r)),
            )
          }
          onToggleDummy={(id) =>
            setRows((prev) => prev.map((r) => (r.id === id ? { ...r, useDummy: !r.useDummy } : r)))
          }
          onDelete={(id) => setRows((prev) => prev.filter((r) => r.id !== id))}
          onAdd={() =>
            setRows((prev) => [
              ...prev,
              {
                id: `draft-new-${crypto.randomUUID()}`,
                key: "",
                value: "",
                useDummy: false,
                stored: false,
              },
            ])
          }
        />
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Dummy values are safe placeholders for building and testing only — they are not real
          credentials. Real values you enter are encrypted at rest and never shown again after save.
          You can overwrite a stored secret later by pasting a new value for the same key.
        </p>
      </section>

      {error && (
        <p className="rounded-xl border border-foreground/25 bg-muted px-3 py-2 text-sm font-medium text-foreground">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-[5px] border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={launching}
          onClick={() => void launchSandbox(true)}
          className="rounded-[5px] border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-60"
        >
          Skip all — use dummy values
        </button>
        <button
          type="button"
          disabled={launching}
          onClick={() => void launchSandbox(false)}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-[#00c990] disabled:opacity-60"
        >
          <Play className="h-4 w-4" />
          {launching ? "Starting…" : "Start sandbox"}
        </button>
      </div>
    </div>
  );
}

function VariablesTab({
  repoId,
  initial,
}: {
  repoId: string;
  initial: Awaited<ReturnType<typeof listRepoEnvVarsFn>>;
}) {
  const [vars, setVars] = useState(initial);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function startEdit(k: string) {
    setEditingKey(k);
    setEditValue("");
    setError(null);
    setNotice(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditValue("");
  }

  async function rotateKey(k: string) {
    if (!editValue) return;
    setRotating(true);
    setError(null);
    setNotice(null);
    try {
      const row = await upsertRepoEnvVarFn({
        data: { repoId, key: k, value: editValue },
      });
      setVars((prev) => {
        const without = prev.filter((v) => v.key !== row.key);
        return [...without, row].sort((a, b) => a.key.localeCompare(b.key));
      });
      setEditingKey(null);
      setEditValue("");
      setNotice(`Updated ${row.key}. The new value is encrypted and will never be shown again.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setRotating(false);
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const row = await upsertRepoEnvVarFn({
        data: { repoId, key: key.trim(), value },
      });
      setVars((prev) => {
        const without = prev.filter((v) => v.key !== row.key);
        return [...without, row].sort((a, b) => a.key.localeCompare(b.key));
      });
      setKey("");
      setValue("");
      setNotice("Saved. Value is write-only — it will never be shown again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function saveBulkEntries(entries: { key: string; value: string }[]) {
    if (entries.length === 0) {
      setError("Nothing to save — paste lines shaped like KEY=value.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    cancelEdit();
    try {
      const rows = await upsertRepoEnvVarsBulkFn({ data: { repoId, entries } });
      setVars((prev) => {
        const savedKeys = new Set(rows.map((r) => r.key));
        const without = prev.filter((v) => !savedKeys.has(v.key));
        return [...without, ...rows].sort((a, b) => a.key.localeCompare(b.key));
      });
      setKey("");
      setValue("");
      setNotice(
        `Saved ${rows.length} variable${rows.length > 1 ? "s" : ""}. Values are write-only — they will never be shown again.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function onKeyPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!looksLikeEnvFile(text)) return;
    e.preventDefault();
    void saveBulkEntries(parseEnvBlob(text));
  }

  async function onDelete(k: string) {
    setError(null);
    try {
      await deleteRepoEnvVarFn({ data: { repoId, key: k } });
      setVars((prev) => prev.filter((v) => v.key !== k));
      if (editingKey === k) cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  const fieldClass =
    "h-10 w-full rounded-xl border border-input bg-background px-3 font-mono text-sm outline-none focus:border-data focus:ring-2 focus:ring-data/20";

  function InlineRotate({ envKey }: { envKey: string }) {
    return (
      <div className="mt-3 space-y-2 rounded-[5px] border border-border bg-muted/40 p-3">
        <label className="block text-xs font-medium text-muted-foreground">
          New value for <code className="font-mono text-foreground">{envKey}</code>
        </label>
        <input
          className={fieldClass}
          placeholder="paste new secret"
          type="password"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          autoComplete="new-password"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Escape") cancelEdit();
            if (e.key === "Enter") {
              e.preventDefault();
              void rotateKey(envKey);
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          Replaces the stored secret. The previous value cannot be recovered.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={rotating || !editValue}
            onClick={() => void rotateKey(envKey)}
            className="h-9 rounded-full bg-primary px-4 font-semibold text-primary-foreground hover:bg-[#00c990]"
          >
            {rotating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Pencil className="h-3.5 w-3.5" />
            )}
            Update
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={rotating}
            onClick={cancelEdit}
            className="h-8 rounded-[5px] px-3"
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-[5px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-[5px] border border-border bg-muted/40 px-3 py-2 text-sm">{notice}</p>
      )}

      <form
        onSubmit={onSave}
        className="rounded-[5px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
      >
        <div className="grid gap-3 sm:grid-cols-[1.2fr_1.4fr_auto] sm:items-end">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Key</label>
            <input
              className={fieldClass}
              placeholder="KEY_NAME"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onPaste={onKeyPaste}
              required={!saving}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Value</label>
            <input
              className={fieldClass}
              placeholder="value (write-only)"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required={!saving}
              autoComplete="new-password"
            />
          </div>
          <Button
            type="submit"
            disabled={saving || !key.trim() || !value}
            className="h-10 rounded-full bg-primary px-4 font-semibold text-primary-foreground hover:bg-[#00c990]"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </Button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-primary">
          Tip: paste an entire .env into Key to split and save multiple variables at once. Comments
          and blank lines are ignored.
        </p>
      </form>

      <section className="overflow-hidden rounded-[5px] border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
          <EyeOff className="h-3.5 w-3.5 shrink-0" />
          Stored values are encrypted. Edit a row to rotate its value in place.
        </div>

        {vars.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No variables yet — add one above, or paste a{" "}
            <code className="font-mono text-xs">.env</code> into Key.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border sm:hidden">
              {vars.map((v) => (
                <li key={v.id} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <code className="block truncate font-mono text-[13px] text-foreground">
                        {v.key}
                      </code>
                      {editingKey !== v.key && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <EyeOff className="h-3 w-3" /> Encrypted
                          </span>
                          <span aria-hidden>·</span>
                          <span>{new Date(v.updatedAt).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                    {editingKey !== v.key && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() => startEdit(v.key)}
                          aria-label={`Edit ${v.key}`}
                          title="Rotate value"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() => void onDelete(v.key)}
                          aria-label={`Delete ${v.key}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                  {editingKey === v.key && <InlineRotate envKey={v.key} />}
                </li>
              ))}
            </ul>

            <table className="hidden w-full text-sm sm:table">
              <thead>
                <tr className="border-b border-border bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="px-4 py-2 font-medium">Updated</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vars.map((v) => (
                  <tr
                    key={v.id}
                    className={editingKey === v.key ? "bg-primary/5" : "hover:bg-muted/40"}
                  >
                    {editingKey === v.key ? (
                      <td colSpan={4} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <code className="font-mono text-[13px] text-foreground">{v.key}</code>
                        </div>
                        <InlineRotate envKey={v.key} />
                      </td>
                    ) : (
                      <>
                        <td className="max-w-[14rem] truncate px-4 py-3 font-mono text-[13px]">
                          {v.key}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <span className="inline-flex items-center gap-1 text-xs">
                            <EyeOff className="h-3 w-3" /> Encrypted
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                          {new Date(v.updatedAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startEdit(v.key)}
                              aria-label={`Edit ${v.key}`}
                              title="Rotate value"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void onDelete(v.key)}
                              aria-label={`Delete ${v.key}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}
