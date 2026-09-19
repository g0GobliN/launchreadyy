import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { ArrowRight } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { REPO_URL } from "@/lib/product";
import { useState } from "react";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — LaunchReadyy" },
      {
        name: "description",
        content:
          "Answers about LaunchReadyy scans, sandbox verification, Production Security, fix PRs, and self-hosting.",
      },
    ],
  }),
  component: FAQPage,
});

interface FAQItem {
  q: string;
  a: string | React.ReactNode;
}

const SECTIONS: { title: string; items: FAQItem[] }[] = [
  {
    title: "How it works",
    items: [
      {
        q: "What exactly does LaunchReadyy do?",
        a: "LaunchReadyy connects to your GitHub repo, detects your stack, and produces a 0–100 production readiness score — including Production Security — with evidence on each finding. With an E2B key configured, it also runs sandboxed install/build/lint verification so the score isn’t only static analysis. For each gap you can open a pull request with template fixes or AI-generated fixes (with your own AI provider key). You can also run a passive live website security scan on domains you confirm you own.",
      },
      {
        q: "Will it push to my main branch?",
        a: "Never. LaunchReadyy always creates a new branch (e.g. launchreadyy/production-ready-2026-08-04) and opens a pull request. Nothing merges without your explicit approval on GitHub.",
      },
      {
        q: "How long does a scan take?",
        a: "Static analysis usually finishes in under a minute. When sandbox verification runs, expect a few extra minutes for install/build/lint in an ephemeral environment. Opening a PR with template fixes is typically tens of seconds; each AI fix adds roughly 30–60 seconds depending on your provider. Exact timing depends on repo size and stack.",
      },
      {
        q: "What does the score mean exactly?",
        a: "The score measures how much of a standard production foundation is in place — CI, tests, env docs, deployment config, Production Security, monitoring, and related checks. It starts at 100 and subtracts by severity. Findings carry confidence; low-confidence items don’t become launch blockers. A failed sandbox verify can force a Not ready verdict; a run still in progress can show Conditional. A high score means the foundation looks solid — not a pentest, compliance cert, or launch guarantee.",
      },
      {
        q: "Does it read my actual source code or just config files?",
        a: "Both, depending on the step. Template detection uses the file tree and manifests (package.json, go.mod, Gemfile, etc.). The code auditor and AI fixes read representative source files (up to ~35 for AI generation). Sandbox verification clones the repo into an ephemeral environment for that run only.",
      },
      {
        q: "Can I re-scan a repo after applying fixes?",
        a: "Yes. Each scan is independent. After you merge the PR on GitHub, re-scan from the dashboard — the score and blockers update from what’s actually in the repo.",
      },
    ],
  },
  {
    title: "Sandbox verification",
    items: [
      {
        q: "What is sandbox verification?",
        a: "An ephemeral isolated environment that clones your connected repo and runs language-appropriate install, build, lint, and related commands. It is the verification stage of one repository analysis, and its results feed the production verdict. Requires an E2B API key — without one, this step is skipped and the rest still works. SANDBOX_MAX_CONCURRENT controls simultaneous runs. Unchanged commits reuse their last result.",
      },
      {
        q: "Which languages can the sandbox actually run?",
        a: "Live install/build/lint in the sandbox covers Node, Python, Go, Rust, Ruby, PHP, Java, .NET, and Elixir. Other stacks (e.g. Flutter/Swift) are still scanned and can get fix PRs; sandbox verify soft-skips when there is no install/build toolchain in the image.",
      },
      {
        q: "Is it safe to give LaunchReadyy my environment variables?",
        a: "Build-time env vars you save are encrypted at rest (AES-256-GCM). After save, values are write-only — the UI never shows them again. They are only decrypted to inject into an ephemeral sandbox for verification. Logs are redacted. Do not paste cloud deploy credentials or production secrets you are unwilling to share with E2B, the sandbox provider. Delete any key anytime from the repo Env vars page.",
      },
      {
        q: "What does LaunchReadyy do with my env vars?",
        a: "Merge order: your saved values win, then non-secret literals from .env.example, then auto-synthesized placeholders so most repos need zero setup. During verification the merged map is injected into the sandbox, commands run, then the environment is destroyed. Failed verify-before-PR can block opening a broken PR.",
      },
    ],
  },
  {
    title: "GitHub permissions",
    items: [
      {
        q: "What GitHub permissions does LaunchReadyy need?",
        a: "There's no OAuth app to authorize. You create a personal access token with repo, read:user, and workflow scopes and paste it into your own .env or config — it never leaves your machine except to talk to GitHub's API directly.",
      },
      {
        q: "Can LaunchReadyy see all my GitHub repos?",
        a: "Your token can list any repo it has access to, but LaunchReadyy only scans and writes to repos you explicitly connect from the dashboard.",
      },
      {
        q: "Can I revoke access?",
        a: "Yes — revoke or delete the token from GitHub → Settings → Developer settings → Personal access tokens at any time.",
      },
      {
        q: "Is my code ever stored anywhere?",
        a: "No durable copies of your source leave your machine. Scans read files in-memory, AI fixes send excerpts to whichever AI provider you configured, and sandbox runs clone into an ephemeral E2B environment for that run only (if you've set up E2B). Everything else — repo metadata, scores, findings — lives in your local SQLite database.",
      },
    ],
  },
  {
    title: "Fixes and pull requests",
    items: [
      {
        q: "What's the difference between template fixes and AI fixes?",
        a: "Template fixes are stack-aware configs (CI workflow, Dockerfile, .env.example, lint setup, etc.) applied deterministically, with no AI involved. AI fixes call whichever provider you configured (deepseek, anthropic, openai, gemini, or cursor) to generate project-specific content (CI, tests, README, …) — billed to you directly by that provider, not by LaunchReadyy.",
      },
      {
        q: "Which fixes are AI-powered?",
        a: "AI-powered items include CI/README/.env.example generation, test scaffolds across supported languages, Playwright/API tests, and architecture analysis. Everything else — including deterministic webhook signature verification — is template-based and needs no AI key at all.",
      },
      {
        q: "What is the code auditor and how is it different from the scanner?",
        a: "The scanner detects missing foundation pieces (no CI, no Dockerfile, no .env.example) and Production Security patterns. The auditor reads source for implementation gaps — e.g. payment webhooks without signature checks, unvalidated API routes, missing auth on sensitive endpoints, hardcoded localhost URLs. Both run on scans.",
      },
      {
        q: "What is Production Security?",
        a: "One readiness category — not a separate security product. It flags practical launch risks (committed secrets, auth/webhook gaps, weak CORS/headers, unsafe APIs, JWT/XSS/SSRF-style patterns) with evidence and confidence, plus an optional passive live website scan after you confirm domain ownership.",
      },
      {
        q: "Do I have to remember to re-scan?",
        a: "Not if you turn on background monitoring for a repo — it re-scans connected repos on a schedule while the app is running and surfaces regressions on the dashboard. Findings can change even when your code doesn't: dependencies are checked against GitHub's live vulnerability advisories on every run, so a repo you haven't touched in a month can still surface something new. You can pause monitoring per repo from the repo page.",
      },
      {
        q: "Does the live website scan hack my site?",
        a: "No. Passive HEAD/GET status and response headers only. No exploit payloads, brute force, or auth bypass. You prove ownership by publishing a token at /.well-known/launchreadyy-verify.txt; confirmation expires after 30 days.",
      },
      {
        q: "Can I pick which fixes to include in the PR?",
        a: "Yes. After a scan, check the gaps you want, then generate the PR. Deselect anything you’d rather handle yourself.",
      },
      {
        q: "What if I already have a CI workflow but it's incomplete?",
        a: "Presence and basic validity usually mark that check as passing. We don’t overwrite a working workflow just to “improve” it. Only true gaps appear as fixable items.",
      },
      {
        q: "Will fixes break my existing code?",
        a: "Many fixes only add new files. Some (security middleware wiring, webhook verification, config patches) intentionally edit existing files — always review the PR diff before merging. Prefer sandbox verification and your own CI after merge.",
      },
    ],
  },
  {
    title: "Framework support",
    items: [
      {
        q: "Which frameworks get the deepest analysis?",
        a: "Next.js, Vite/React, and Express get the deepest framework-specific rules. Other JS/TS full-stack repos still get shared checks for CI, env docs, Docker, and Production Security.",
      },
      {
        q: "Does it work with Python, Go, Ruby, or other languages?",
        a: "Yes for any recognizable application repo. Detection covers web, mobile (Expo, React Native, Flutter, Swift, Kotlin), desktop (Electron, Tauri), and backends via manifests (package.json, pubspec.yaml, go.mod, Cargo.toml, composer.json, Gemfile, etc.). Fixes and AI test scaffolds are language-aware. Sandbox execution depth depends on the current image (see Sandbox section).",
      },
      {
        q: "Does it work with monorepos?",
        a: "Basic support: root manifests and the file tree. Per-package workspace scoring and workspace-aware CI are currently limited.",
      },
      {
        q: "What about Remix, SvelteKit, or Astro?",
        a: "They receive shared Vite/JS checks today. Framework-specific deep rules are not yet available.",
      },
    ],
  },
  {
    title: "Cost and API keys",
    items: [
      {
        q: "What does LaunchReadyy Community cost?",
        a: "LaunchReadyy Community is licensed under Apache-2.0. You supply the GitHub token and any optional E2B or AI-provider keys; those providers apply their own rates and limits.",
      },
      {
        q: "Do I need an AI provider?",
        a: "No. Deterministic scanning, scoring, Production Security and template fixes all work with no AI key configured. An AI provider is only needed for generated fixes, generated tests and AI-assisted remediation.",
      },
      {
        q: "Do I need E2B?",
        a: "No. Without an E2B key, sandbox verification is shown as skipped and everything else still works. With a key, LaunchReadyy runs install, build, lint and test in an isolated sandbox for stronger evidence.",
      },
    ],
  },
  {
    title: "Launch blockers and reports",
    items: [
      {
        q: "What are launch blockers?",
        a: "A prioritized list of issues between you and a safer launch — not just a score. Each includes what was checked, why it matters in production terms, and a suggested fix, plus a verdict: Not ready, Conditional, or Ready.",
      },
      {
        q: "Can I mark a blocker as not applicable?",
        a: "Yes — Accept the risk (temporary, won’t fix, false positive, or N/A), with an optional note. Accepted items stay visible but drop out of the active blocker count.",
      },
      {
        q: "What is the architecture analysis and when should I use it?",
        a: "Flags circular deps, dead/unreachable files, unused packages, oversized files, and separation-of-concerns issues. Use when a codebase feels tangled or you’re onboarding to a new project.",
      },
      {
        q: "What is the launch report and who is it for?",
        a: "A shareable readiness summary (score, blockers, fix status) for investors, clients, or handoffs. You control the public link and can disable it anytime.",
      },
    ],
  },
  {
    title: "Troubleshooting",
    items: [
      {
        q: "My scan got stuck or failed — what do I do?",
        a: "If it’s still running after several minutes or shows an error, retry from the dashboard. Causes are often a brief GitHub API issue, a large repo, or a sandbox timeout. Run `launchreadyy doctor` to check GitHub/AI/E2B connectivity if it keeps happening.",
      },
      {
        q: "Sandbox says skipped",
        a: "Skipped usually means either no E2B_API_KEY is configured, or the stack isn’t runnable in the current sandbox image yet — the static scan still counts either way. The Sandbox page follows the current repository analysis instead of starting duplicate runs.",
      },
      {
        q: "My score seems wrong — a check is flagged but I already have that file.",
        a: "Static checks look for known paths/patterns; non-standard layouts can false-positive. Use Accept the risk with a note, and open a GitHub issue with the repo shape so detection can improve.",
      },
      {
        q: "The PR was generated but the files look wrong or are missing.",
        a: "Unusual layouts or very large files can hurt AI quality. Review the diff, tweak before merge, and open an issue if it's a repeatable pattern.",
      },
      {
        q: "I merged the PR but my score didn't change.",
        a: "Scores update only on a new scan. After merging on GitHub, Scan again from the dashboard.",
      },
      {
        q: "I connected GitHub but my repo isn't showing up.",
        a: "Check that your GITHUB_TOKEN has repo scope and hasn't expired — `launchreadyy doctor` validates it against the GitHub API directly.",
      },
    ],
  },
  {
    title: "Privacy and security",
    items: [
      {
        q: "Who can see my scan results?",
        a: "Only you — everything lives in your own local SQLite database — unless you create a shareable launch report link, which you can disable anytime.",
      },
      {
        q: "Is the connection to GitHub secure?",
        a: "Your personal access token is read server-side only from your own .env/config and is never sent to the browser.",
      },
      {
        q: "Does LaunchReadyy send my data anywhere?",
        a: "There's no LaunchReadyy server to send it to. Data leaves your machine only to the third-party providers you configure yourself — GitHub, and optionally E2B and an AI provider.",
      },
      {
        q: "Can I export or delete my data?",
        a: (
          <>
            Yes — it's your own SQLite file on disk (see Settings → Data & storage). Delete it or
            the whole <span className="font-mono text-xs">data/</span> directory and nothing
            remains. Full policy:{" "}
            <Link to="/privacy" className="text-primary hover:underline">
              Privacy
            </Link>
            .
          </>
        ),
      },
      {
        q: "How is LaunchReadyy's own security different from Production Security?",
        a: (
          <>
            The{" "}
            <Link to="/security" className="text-primary hover:underline">
              Security
            </Link>{" "}
            page covers how we protect your account. Production Security is a product category in
            your readiness score — advisory launch-risk checks with evidence, not a claim that we
            are a security vendor or that your app is certified.
          </>
        ),
      },
    ],
  },
];

function AccordionItem({ q, a }: FAQItem) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-4 py-4 text-left"
      >
        <span className="font-medium text-sm">{q}</span>
        <span
          className={`mt-0.5 shrink-0 text-lg leading-none text-muted-foreground transition-transform duration-200 ${open ? "rotate-45" : ""}`}
        >
          +
        </span>
      </button>
      {open && <div className="pb-4 text-sm text-muted-foreground leading-relaxed">{a}</div>}
    </div>
  );
}

function FAQPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10 sm:py-14">
        <div className="mb-12 text-center">
          <p className="text-xs uppercase tracking-widest text-primary">FAQ</p>
          <h1 className="mt-3 font-display text-4xl font-bold">Questions, answered</h1>
          <p className="mt-3 text-muted-foreground">
            Scans, sandbox verification, fix PRs, and self-hosting — updated for the current
            product.
          </p>
        </div>

        <div className="space-y-10">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
                {section.title}
              </h2>
              <div className="rounded-xl border border-border bg-card px-5">
                {section.items.map((item) => (
                  <AccordionItem key={item.q} {...item} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-8 text-center">
          <p className="font-display font-semibold text-lg">Still have a question?</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Open an issue on GitHub — questions, bugs and feature requests all go there.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <a
              href={`${REPO_URL}/issues`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
            >
              Open an issue <ArrowRight className="h-4 w-4" />
            </a>
            <Link
              to="/docs"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-muted transition"
            >
              Read the docs <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
