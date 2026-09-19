import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import {
  GithubIcon,
  ShieldCheck,
  Lock,
  Eye,
  ArrowRight,
  GitBranch,
  Clock,
  MousePointerClick,
  ListChecks,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/workflow")({
  head: () => ({
    meta: [
      { title: "How it works — LaunchReadyy" },
      {
        name: "description",
        content:
          "Connect GitHub, scan readiness (including Production Security), verify in a sandbox, pick fixes, review the PR, and ship. Know before you ship.",
      },
    ],
  }),
  component: WorkflowPage,
});

const STEPS = [
  {
    number: "01",
    title: "Add your GitHub token",
    time: "~30 sec",
    you: "Create a personal access token and put it in your own .env as GITHUB_TOKEN — no OAuth app, no account.",
    we: "We read it server-side only to read repos you pick and open PRs on new branches only. It never reaches the browser.",
  },
  {
    number: "02",
    title: "Pick a repo & scan",
    time: "~30 sec",
    you: "Choose a repository and hit Analyze.",
    we: "We read the file tree and configs, detect your stack, and run static checks across categories — including Production Security findings with evidence and confidence.",
  },
  {
    number: "03",
    title: "Verify in a sandbox",
    time: "~1–3 min",
    you: "Nothing — this runs automatically if E2B is configured (or you start a manual run from the repo Sandbox page).",
    we: "We clone your repo into an isolated sandbox and run language-appropriate install/build/lint when the stack is supported. Unsupported stacks soft-skip with a clear reason. A failed verify can force Not ready; skipped runs don’t block the rest of the scan.",
  },
  {
    number: "04",
    title: "Select what to fix",
    time: "~1 min",
    you: "Check the issues you want in the PR. Use fix packs for a quick bundle, or pick one-by-one.",
    we: "Nothing runs yet — you're building a fix plan. Template fixes and optional AI fixes can mix in one PR.",
  },
  {
    number: "05",
    title: "Preview & generate PR",
    time: "~1–3 min",
    you: "Review file diffs, edit the branch name if needed, then click Generate PR.",
    we: "We create a branch, commit your selected changes, and open a pull request on GitHub. AI fixes run during this step.",
  },
  {
    number: "06",
    title: "Review on GitHub & merge",
    time: "Your pace",
    you: "Open the PR link, wait for CI, review the diff, merge when happy.",
    we: "Your score updates on the next scan. Re-scan any time to track progress.",
  },
];

function WorkflowPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10 sm:py-16">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-primary">How it works</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Six steps to know before you ship
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm font-medium text-muted-foreground">
            Connect, scan readiness (including Production Security), verify in a sandbox, select
            fixes, preview — we open the PR on a new branch. You stay in control the whole way.
          </p>
        </div>

        {/* Visual flow */}
        <div className="mt-10 hidden sm:flex items-center justify-center gap-1 text-xs text-muted-foreground">
          {["Connect", "Scan", "Verify", "Select", "PR", "Merge"].map((label, i, arr) => (
            <div key={label} className="flex items-center gap-1">
              <span className="rounded-full border border-border bg-surface px-2.5 py-1 font-medium text-foreground">
                {label}
              </span>
              {i < arr.length - 1 && <ArrowRight className="h-3 w-3 shrink-0" />}
            </div>
          ))}
        </div>

        <div className="mt-10 sm:mt-14 space-y-6">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="relative rounded-2xl border border-border bg-card p-5 sm:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-bold text-primary/50">{step.number}</span>
                  <h2 className="font-display text-base font-semibold tracking-tight sm:text-lg">
                    {step.title}
                  </h2>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {step.time}
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ActionCard
                  label="You"
                  icon={<MousePointerClick className="h-4 w-4 text-primary" />}
                  text={step.you}
                />
                <ActionCard
                  label="LaunchReadyy"
                  icon={<Sparkles className="h-4 w-4 text-primary" />}
                  text={step.we}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Permissions — workflow-specific, not on Features */}
        <div className="mt-14 rounded-2xl border border-border bg-card p-5 sm:p-8">
          <h2 className="font-display text-lg font-semibold tracking-tight">GitHub token scopes</h2>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            Your personal access token needs the minimum scope for the workflow above.
          </p>
          <ul className="mt-5 space-y-2">
            <PermRow
              icon={<Eye className="h-4 w-4 text-primary" />}
              label="read:user"
              desc="Display your profile on the dashboard."
            />
            <PermRow
              icon={<Eye className="h-4 w-4 text-primary" />}
              label="repo (read)"
              desc="Scan file trees and configs on repos you connect."
            />
            <PermRow
              icon={<GitBranch className="h-4 w-4 text-success" />}
              label="repo (write)"
              desc="Create branches and open PRs — never push to main."
            />
          </ul>
          <div className="mt-5 space-y-1.5 text-sm text-muted-foreground">
            {[
              "Never push to main or existing branches",
              "No durable storage of your source — AI excerpts and ephemeral sandbox clones only while a job runs",
              "Never access repos you haven't selected",
            ].map((x) => (
              <div key={x} className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                {x}
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            Revoke access anytime: GitHub → Settings → Developer settings → Personal access tokens.
          </div>
        </div>

        {/* Post-merge checklist */}
        <div className="mt-8 rounded-2xl border border-border bg-card p-5 sm:p-8">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-semibold tracking-tight">After you merge</h2>
          </div>
          <ol className="mt-5 space-y-3">
            {[
              {
                t: "CI runs automatically",
                d: "The workflow we added triggers on your next push. Wait for green checks.",
              },
              {
                t: "Skim AI-generated tests",
                d: "If you picked AI test fixes, glance through assertions — tweak if needed.",
              },
              {
                t: "Re-scan to see your new score",
                d: "Run Analyze again from the dashboard. Watch the readiness ring go up — including Production Security and sandbox results when E2B is configured.",
              },
              {
                t: "Optional: live website scan",
                d: "Confirm a domain you own, then run a passive header/TLS/exposure check. Separate from the repo scan.",
              },
            ].map((item, i) => (
              <li
                key={item.t}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3 text-sm"
              >
                <span className="font-display text-base font-bold text-primary/40">{i + 1}</span>
                <div>
                  <div className="font-medium">{item.t}</div>
                  <div className="mt-0.5 text-muted-foreground">{item.d}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 text-sm">
          <Link
            to="/docs"
            className="inline-flex items-center gap-1.5 text-primary hover:opacity-80 transition"
          >
            Full documentation <ArrowRight className="h-4 w-4" />
          </Link>
          <span className="hidden sm:inline text-muted-foreground">·</span>
          <Link
            to="/docs"
            hash="capabilities"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition"
          >
            Product capabilities
          </Link>
          <span className="hidden sm:inline text-muted-foreground">·</span>
          <Link
            to="/security"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition"
          >
            Production Security
          </Link>
        </div>

        <div className="invert-band relative mt-10 overflow-hidden rounded-xl border border-white/15 px-6 py-10 text-center sm:mt-14 sm:px-12 sm:py-14">
          <div className="absolute inset-0 grid-bg opacity-20 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
          <div className="relative">
            <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              Start with a free scan
            </h2>
            <p className="invert-muted mx-auto mt-2 max-w-md text-sm font-medium">
              Connect GitHub, pick a repo, and see your score in under two minutes.
            </p>
            <Link
              to="/dashboard"
              className="btn-clear mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium"
            >
              <GithubIcon className="h-4 w-4" /> Connect GitHub
            </Link>
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

function ActionCard({ label, icon, text }: { label: string; icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-sm font-medium leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function PermRow({ icon, label, desc }: { icon: React.ReactNode; label: string; desc: string }) {
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3 text-sm">
      {icon}
      <div>
        <code className="font-mono font-medium">{label}</code>
        <p className="mt-0.5 text-muted-foreground">{desc}</p>
      </div>
    </li>
  );
}
