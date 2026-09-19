import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { BookOpen, CircleHelp, X } from "lucide-react";
import { cn } from "@/lib/utils";

type HelpContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const HelpContext = createContext<HelpContextValue | null>(null);

export function HelpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const value = useMemo(() => ({ open, setOpen }), [open]);

  useEffect(() => {
    setOpen(false);
  }, [path]);

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

function useHelp() {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error("HelpButton must be used inside HelpProvider");
  return ctx;
}

export function useHelpOpen() {
  return useHelp().open;
}

type HelpTopic = {
  title: string;
  body: string;
  steps?: string[];
  /** Extra context cards — what the page shows / why it matters */
  sections?: Array<{ heading: string; items: string[] }>;
  tips?: string[];
};

function helpForPath(path: string): HelpTopic {
  if (path.includes("/sandbox")) {
    return {
      title: "Sandbox build",
      body: "This is the heart of LaunchReadyy. We clone your repo into an isolated VM, then run install → build → lint so you know it actually boots — not just that static analysis looked fine.",
      steps: [
        "Add secrets on Environment if install/build needs them (API keys, DATABASE_URL, etc.).",
        "Click Launch sandbox and watch the live terminal for Install, Build, and Lint.",
        "Passed → open Production verdict for a sandbox-backed score. Failed → copy the log from Build history or jump to Fix PR.",
      ],
      sections: [
        {
          heading: "What each step means",
          items: [
            "Install — dependency install (npm ci, pnpm, etc.) as detected from the repo.",
            "Build — production build command so compile errors show up here, not in prod.",
            "Lint — static checks when the project has a lint script configured.",
          ],
        },
        {
          heading: "Concurrency",
          items: [
            "Sandbox runs share one pool (SANDBOX_MAX_CONCURRENT); a spike queues rather than fails.",
            "Failed runs still consume a slot — fix env or deps before hammering Retry.",
          ],
        },
      ],
      tips: [
        "If install fails on missing env, configure Environment then relaunch.",
        "You can leave this page and come back via Build history while a job is queued.",
      ],
    };
  }
  if (path.includes("/runs")) {
    return {
      title: "Build history",
      body: "Every sandbox verification for this repo, newest first. Use it to debug a failed build or prove a green run to your team.",
      steps: [
        "Open a run to see step results (install / build / lint) and timings.",
        "Scroll to Log output and use Copy log to share the failure.",
        "Relaunch from Sandbox build after you fix env or code.",
      ],
      sections: [
        {
          heading: "Statuses",
          items: [
            "Passed — install/build/lint completed successfully.",
            "Failed — a step exited non-zero; the log shows which command broke.",
            "Skipped — sandbox couldn’t run (no E2B key, or stack unsupported); verdict may be static-only.",
            "Queued / Running — still in progress; refresh or open Sandbox build for the live view.",
          ],
        },
      ],
    };
  }
  if (path.includes("/env")) {
    return {
      title: "Environment",
      body: "Secrets and config injected into sandbox builds only. They are not committed to GitHub. Use this when the app won’t install or boot without keys.",
      steps: [
        "Add a Key and Value, then save — or paste a full .env block into the Key field to import many at once.",
        "Only include what the sandbox needs to install/build (not every production secret).",
        "Go back to Sandbox build and Launch again so the new vars are picked up.",
      ],
      tips: [
        "Placeholders are fine for values you don’t want to store; missing required vars still fail the build.",
        "Build history stays on its own page — this screen is variables only.",
      ],
    };
  }
  if (path.includes("/fix") || path.includes("/job/")) {
    return {
      title: "Fix PR",
      body: "Turn readiness findings into a real GitHub pull request. You choose which fixes, preview the diff, then we open a branch PR — never a commit to main.",
      steps: [
        "Select the fix packs that match your blockers or gaps.",
        "Generate a preview and review every file change.",
        "Confirm to create the PR — the job runs against your own configured AI provider.",
      ],
      sections: [
        {
          heading: "Flow",
          items: [
            "Choose → pick applicable fixes for this stack.",
            "Generate → AI/rules produce file patches for the repo.",
            "Verify & PR → open the pull request on a LaunchReadyy branch.",
          ],
        },
      ],
      tips: [
        "Low-risk fixes apply as plain templates; medium+ risk uses your configured AI provider.",
        "If a job fails, open it from Fixes / job history and retry or adjust selection.",
      ],
    };
  }
  if (path.includes("/blockers")) {
    return {
      title: "Blockers",
      body: "Findings we treat as launch-critical — things that can break production, leak secrets, or block users. Clear these before you call the repo shippable.",
      steps: [
        "Sort by severity and open each finding for evidence.",
        "Send fixable items to Fix PR, or accept risk only when you consciously defer.",
        "Re-run sandbox after merging fixes so the verdict updates.",
      ],
      sections: [
        {
          heading: "How blockers differ from other issues",
          items: [
            "Blockers are the highest risk_level — they weigh heavily on the readiness score.",
            "Medium/low issues still matter but usually aren’t stop-ship alone.",
          ],
        },
      ],
    };
  }
  if (path.includes("/arch")) {
    return {
      title: "Architecture",
      body: "A structural read of the codebase: languages, oversized files, and coupling smells. Complements the production verdict — it doesn’t replace a sandbox build.",
      steps: [
        "Skim the stack profile and hotspots.",
        "Use oversized / duplicate signals as refactor backlog, not hard launch gates.",
        "Pair with Production verdict for ship/no-ship decisions.",
      ],
    };
  }
  if (path.includes("/live-security")) {
    return {
      title: "Live security",
      body: "Optional probes against a deployed URL (headers, cookies, common misconfigs). Different from static/repo security checks in the verdict.",
      steps: [
        "Provide the live site URL to probe.",
        "Run the scan and review findings.",
        "Fix on the host (CDN, app config) — these often aren’t Fix PR targets.",
      ],
      tips: ["Point at staging if you don’t want to probe production."],
    };
  }
  if (path.includes("/report")) {
    return {
      title: "Launch report",
      body: "A stakeholder-friendly snapshot of readiness: score, blockers, and what was verified. Share a link instead of forwarding terminal logs.",
      steps: [
        "Generate or refresh after a sandbox + scan cycle.",
        "Copy the share link for PMs, founders, or reviewers.",
        "Keep the report in sync by re-running sandbox when the repo changes.",
      ],
    };
  }
  if (/\/repo\/[^/]+\/?$/.test(path)) {
    return {
      title: "Production verdict",
      body: "Your ship/no-ship summary for this repo: readiness score, checklist, and findings. LaunchReadyy is sandbox-first — a full verdict unlocks after a sandbox build finishes (or is skipped if no provider is available).",
      steps: [
        "If you see “Run sandbox to unlock”, go to Sandbox build (and Environment if needed), then come back.",
        "Read the score and verdict label, then open findings by category or severity.",
        "Clear blockers via Fix PR, merge, and re-run sandbox so the score reflects the new code.",
      ],
      sections: [
        {
          heading: "What you’re looking at",
          items: [
            "Readiness score (0–100) — weighted from checklist items and issue severity.",
            "Checklist — launch categories (security, ops, quality, etc.) marked pass / fail / n/a.",
            "Findings — each issue has evidence, why it matters, and whether a Fix PR can help.",
            "Sandbox badge — passed means build/lint was verified in isolation; failed/skipped means treat static-only parts carefully.",
          ],
        },
        {
          heading: "Sandbox-first flow",
          items: [
            "Repo → Environment (if required) → Sandbox build → Production verdict → Fix PR.",
            "We avoid showing a “final” score before sandbox so a green static scan can’t fake a bootable app.",
            "Re-run sandbox after big dependency or config changes; don’t rely on a stale pass.",
          ],
        },
        {
          heading: "Acting on results",
          items: [
            "Blockers → Fix PR or Blockers page for the critical list.",
            "Architecture / Live security — deeper checks; optional for the core launch path.",
            "Launch report — share the outcome without giving repo access.",
          ],
        },
      ],
      tips: [
        "Score dropped after a new scan? Diff findings or check Build history for a failed build.",
        "“Sandbox verified” on a finding means the sandbox confirmed it — higher confidence than rule-only hits.",
      ],
    };
  }
  if (path.startsWith("/dashboard")) {
    return {
      title: "Dashboard",
      body: "Home base across all connected repos: recent scores, scan activity, and suggested next steps.",
      steps: [
        "Open a recent project to jump into that repo’s sandbox/verdict flow.",
        "Use Next steps when you want a single clear action (lowest score, reports, etc.).",
      ],
      sections: [
        {
          heading: "Charts",
          items: [
            "Readiness score — trend over recent scans.",
            "Blockers / checklist — whether quality is improving.",
            "Scan activity — how often you’ve been verifying.",
          ],
        },
      ],
    };
  }
  if (
    path.startsWith("/repos") ||
    path.startsWith("/scans") ||
    path.startsWith("/jobs") ||
    path.startsWith("/reports")
  ) {
    return {
      title: "Workspace",
      body: "Cross-repo lists: repositories you connected, past scans, Fix jobs, and launch reports.",
      steps: [
        "Repositories — connect or open a repo to start sandbox → verdict.",
        "Scans / Fixes / Reports — history and follow-ups without opening each repo first.",
      ],
    };
  }
  if (path.startsWith("/settings")) {
    return {
      title: "Settings",
      body: "Vendor credentials, background monitoring, data, and security — all local to this installation.",
      sections: [
        {
          heading: "Sections",
          items: [
            "Vendor credentials — GitHub, AI provider, and E2B keys.",
            "Background monitoring — scheduled re-scans of connected repos.",
            "Data & storage — export or clear local data.",
            "Security — session and encryption secret status.",
          ],
        },
      ],
    };
  }
  return {
    title: "Quick help",
    body: "LaunchReadyy verifies any repo in a sandbox, scores production readiness, then helps you open a Fix PR — without committing to main.",
    steps: [
      "Connect a repository from Repositories or Dashboard.",
      "Run Sandbox build (configure Environment if install needs secrets).",
      "Read Production verdict, clear blockers with Fix PR, share a Launch report.",
    ],
    tips: ["Use ? for page-specific help. Full reference lives under Docs in the account menu."],
  };
}

export function HelpButton() {
  const { open, setOpen } = useHelp();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className="grid h-8 w-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground data-[open=true]:bg-muted data-[open=true]:text-foreground"
      aria-label="Help"
      aria-expanded={open}
      data-open={open}
    >
      <CircleHelp className="h-4 w-4" />
    </button>
  );
}

/** Renders over the main content area only — sidebar and top chrome stay put. */
export function HelpPanel() {
  const { open, setOpen } = useHelp();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const topic = helpForPath(path);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      {/* pl-14 clears the floating hamburger (z-50) that otherwise sits on top of
          this header below lg and hides the title. */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card pl-14 pr-4 lg:pl-4">
        <div className="flex items-center gap-2">
          <CircleHelp className="h-4 w-4 text-data" />
          <h2 className="text-sm font-semibold text-foreground">Help</h2>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="grid h-8 w-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close help"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-xl space-y-6 pb-8">
          <div>
            <h3 className="font-display text-lg font-semibold text-foreground">{topic.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{topic.body}</p>
          </div>

          {topic.steps && topic.steps.length > 0 && (
            <div>
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                How to use this page
              </p>
              <ol className="space-y-2.5">
                {topic.steps.map((step, i) => (
                  <li key={step} className="flex gap-3 text-sm text-foreground">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-data">
                      {i + 1}
                    </span>
                    <span className="pt-0.5 leading-relaxed text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {topic.sections?.map((section) => (
            <div key={section.heading}>
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.heading}
              </p>
              <ul className="space-y-2 rounded-[5px] border border-border bg-surface/60 p-3">
                {section.items.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2 text-sm leading-relaxed text-muted-foreground"
                  >
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {topic.tips && topic.tips.length > 0 && (
            <div className="rounded-xl border border-border bg-muted/60 px-3 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                Tips
              </p>
              <ul className="space-y-1.5">
                {topic.tips.map((tip) => (
                  <li key={tip} className="text-sm leading-relaxed text-muted-foreground">
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-[5px] border border-border bg-surface p-4">
            <p className="text-sm font-medium text-foreground">Need the full guide?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Docs is a separate page with deep reference. This panel is quick context for where you
              are now.
            </p>
            <Link
              to="/docs"
              onClick={() => setOpen(false)}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-[#00c990]"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Open docs
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Main content slot: page scrolls here; when help is open, page is locked and
 * only the help panel scrolls (prevents verdict leaking under the panel).
 */
export function HelpMain({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const open = useHelpOpen();
  return (
    <main className={cn("relative min-h-0 flex-1 overflow-hidden", className)}>
      <div
        data-app-scroll
        className={cn(
          "h-full min-h-0",
          open ? "invisible pointer-events-none overflow-hidden" : "overflow-y-auto",
          contentClassName,
        )}
        aria-hidden={open}
      >
        {children}
      </div>
      <HelpPanel />
    </main>
  );
}
