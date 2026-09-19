import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/layouts/AppLayout";
import {
  getBackgroundAccessFn,
  grantBackgroundAccessFn,
  revokeBackgroundAccessFn,
} from "@/lib/api/monitor.functions";
import {
  ShieldCheck,
  Activity,
  User,
  CheckCircle2,
  Database,
  KeyRound,
  Bot,
  Boxes,
} from "lucide-react";
import { useState } from "react";
import {
  DashboardPageHeader,
  DashboardPanel,
  dashboardSecondaryAction,
} from "@/components/app/DashboardKit";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — LaunchReadyy Community" }] }),
  loader: async () => {
    const access = await getBackgroundAccessFn().catch(() => ({ granted: false }));
    const present = (...names: string[]) => names.some((n) => Boolean(process.env[n]?.trim()));
    return {
      backgroundAccess: access.granted,
      installation: {
        github: present("GITHUB_TOKEN"),
        sandbox: present("E2B_API_KEY"),
        ai: present(
          "DEEPSEEK_API_KEY",
          "ANTHROPIC_API_KEY",
          "CLAUDE_API_KEY",
          "OPENAI_API_KEY",
          "GEMINI_API_KEY",
          "CURSOR_API_KEY",
        ),
      },
    };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { installation, backgroundAccess: initialAccess } = Route.useLoaderData();
  const [backgroundAccess, setBackgroundAccess] = useState(initialAccess);
  const [accessSaving, setAccessSaving] = useState(false);

  return (
    <AppLayout breadcrumbs={[{ label: "Settings" }]}>
      <div className="mx-auto max-w-3xl space-y-6">
        <DashboardPageHeader
          eyebrow="Installation"
          title="Settings"
          description="Configure the optional services this installation uses, and control background monitoring."
        />

        <DashboardPanel>
          <div className="flex items-center gap-2 mb-5">
            <KeyRound className="h-4 w-4 text-primary" />
            <h2 className="font-display font-semibold">Vendor credentials</h2>
          </div>
          <div className="space-y-3 text-sm">
            {[
              {
                icon: Boxes,
                label: "GitHub token (GITHUB_TOKEN)",
                ok: installation.github,
                hint: "Repo access, scans and fix PRs use this personal access token.",
              },
              {
                icon: Bot,
                label: "E2B sandbox (E2B_API_KEY)",
                ok: installation.sandbox,
                hint: "Optional — install/build/lint verification in an isolated sandbox.",
              },
              {
                icon: Bot,
                label: "AI provider key",
                ok: installation.ai,
                hint: "Optional — AI-generated fixes, tests and explanations.",
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-2.5"
              >
                <div className="flex items-start gap-3">
                  <row.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{row.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{row.hint}</div>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    row.ok ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {row.ok ? "Configured" : "Not set"}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Credentials live in the local <code>.env</code> file. Set them with{" "}
            <code>launchreadyy setup</code> or edit the file directly, then restart the app.
          </p>
        </DashboardPanel>

        <DashboardPanel>
          <div className="flex items-center gap-2 mb-5">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="font-display font-semibold">Background monitoring</h2>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Scheduled re-scans</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                While LaunchReadyy is running, connected repositories are re-checked on a schedule
                and new findings appear in the dashboard. No email is sent.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={backgroundAccess}
              disabled={accessSaving}
              onClick={async () => {
                setAccessSaving(true);
                try {
                  if (backgroundAccess) {
                    await revokeBackgroundAccessFn();
                    setBackgroundAccess(false);
                  } else {
                    const res = await grantBackgroundAccessFn();
                    setBackgroundAccess(res.granted);
                  }
                } finally {
                  setAccessSaving(false);
                }
              }}
              title={
                backgroundAccess
                  ? "Turn off background monitoring"
                  : "Turn on background monitoring"
              }
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${backgroundAccess ? "bg-primary" : "bg-muted"} ${accessSaving ? "opacity-60" : ""}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition ${backgroundAccess ? "translate-x-5" : ""}`}
              />
            </button>
          </div>
        </DashboardPanel>

        <DashboardPanel>
          <div className="flex items-center gap-2 mb-5">
            <Database className="h-4 w-4 text-primary" />
            <h2 className="font-display font-semibold">Data & storage</h2>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              All data is stored locally in <code>data/launchreadyy.db</code> (SQLite). Nothing is
              sent to LaunchReadyy servers.
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              Project environment variables are encrypted at rest (AES-256-GCM) and are never shown
              again after saving.
            </div>
          </div>
        </DashboardPanel>

        <DashboardPanel>
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="font-display font-semibold">Security</h2>
          </div>
          <div className="space-y-3 text-sm">
            {[
              "Read access to your repositories via your own GitHub token",
              "Write access for branches and pull requests only on repos you connect",
              "LaunchReadyy never pushes to your main branch",
              "Your code is analyzed in-memory — never stored",
            ].map((item) => (
              <div key={item} className="flex items-start gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                {item}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Keep LaunchReadyy bound to localhost or a private network. If you expose it publicly,
            place it behind an authentication-capable reverse proxy — the app itself has no login.
          </p>
        </DashboardPanel>
      </div>
    </AppLayout>
  );
}
