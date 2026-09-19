import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { FIX_PACKS } from "@/lib/fix-packs";
import { REPO_URL } from "@/lib/product";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  CreditCard,
  FileText,
  GithubIcon,
  Heart,
  Search,
  Shield,
  Sparkles,
  TestTube2,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentation — LaunchReadyy" },
      {
        name: "description",
        content:
          "Complete LaunchReadyy documentation — getting started, guides, platform support, launch blockers, troubleshooting, reference, and acknowledgements.",
      },
    ],
  }),
  component: DocsPage,
});

const SCAN_CATEGORIES = [
  { label: "CI/CD", desc: "GitHub Actions, build pipelines, deploy hooks" },
  { label: "Testing", desc: "Vitest, Jest, Playwright, pytest, go test, RSpec, JUnit" },
  { label: "Code quality", desc: "ESLint, Prettier, ruff, golangci-lint, rubocop" },
  {
    label: "Production Security",
    desc: "Secrets, .env hygiene, auth/webhooks, CORS/headers/rate-limit, unsafe APIs, JWT/XSS/SSRF — with evidence + confidence",
  },
  { label: "Deployment", desc: "Dockerfile, platform deploy configs" },
  { label: "Monitoring", desc: "Sentry, structured logging, health checks" },
];

const TEMPLATE_FIXES = [
  "GitHub Actions CI workflow (all languages)",
  "ESLint, Prettier, ruff, rubocop, golangci-lint",
  "Express security (Helmet + rate limit + CORS)",
  "Dependency audit CI workflow",
  "Winston logging setup",
  "Dockerfile (language-aware)",
  ".env.example",
  "Vitest / pytest / RSpec / phpunit config",
];

const AI_FIXES = [
  "AI-tailored CI workflow",
  "README generation",
  ".env.example scan",
  "Vitest / pytest / go test / RSpec / JUnit / cargo / xUnit / ExUnit",
  "Playwright E2E · Flutter / Swift / Kotlin tests",
  "API route tests",
  "Architecture analysis",
];

const AUDITOR_FIXES = [
  { label: "Stripe webhook signature verification", note: "Deterministic source check" },
  { label: "Undocumented env vars in source", note: "Scans usage vs .env.example" },
  { label: "Missing API input validation", note: "Unvalidated route handlers" },
  { label: "Auth routes without middleware", note: "Unprotected sensitive endpoints" },
  { label: "Prisma migration safety", note: "Destructive schema changes" },
  { label: "Hardcoded localhost in API calls", note: "Dev URLs in production code" },
];

const PRODUCT_TOOLS = [
  {
    title: "Readiness scanner",
    badge: "Included",
    desc: "0–100 score from file tree + config analysis",
  },
  {
    title: "Code auditor",
    badge: "Included",
    desc: "Source-level security and reliability patterns",
  },
  { title: "Template fixes", badge: "Included", desc: "Stack-aware configs; linters free" },
  {
    title: "AI-generated fixes",
    badge: "API key",
    desc: "Tailored CI, tests, and README using your configured AI provider",
  },
  { title: "Automated PRs", badge: "Included", desc: "New branch + PR — never touches main" },
  {
    title: "Launch blockers",
    badge: "Included",
    desc: "Verdict, evidence, prioritized action plan",
  },
  {
    title: "Sandbox verification",
    badge: "Included",
    desc: "Ephemeral install/build/lint/test before you merge",
  },
  {
    title: "Architecture analysis",
    badge: "Included",
    desc: "Import-graph audit for JS/TS repos",
  },
  { title: "Launch report", badge: "Included", desc: "Shareable readiness summary link" },
  { title: "Job history", badge: "Included", desc: "Scan and PR audit trail" },
  { title: "Multi-repo view", badge: "Included", desc: "Every connected repo in one view" },
];

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "getting-started", label: "Getting started" },
  { id: "capabilities", label: "Capabilities" },
  { id: "guides", label: "Guides" },
  { id: "use-cases", label: "Use cases" },
  { id: "best-practices", label: "Best practices" },
  { id: "launch-blockers", label: "Launch blockers" },
  { id: "platforms", label: "Platform guides" },
  { id: "architecture", label: "Architecture" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "privacy-data", label: "Data & privacy" },
  { id: "reference", label: "Reference" },
  { id: "glossary", label: "Glossary" },
  { id: "acknowledgements", label: "Acknowledgements" },
] as const;

type SectionId = (typeof NAV)[number]["id"];

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: SectionId;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-2xl font-bold tracking-tight">{title}</h2>
      {lead && (
        <p className="mt-3 text-sm font-medium leading-relaxed text-muted-foreground">{lead}</p>
      )}
      <div
        className={`space-y-5 text-sm font-medium leading-relaxed text-muted-foreground ${lead ? "mt-5" : "mt-5"}`}
      >
        {children}
      </div>
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-foreground pt-2">{children}</h3>;
}

function GuideCard({
  icon,
  title,
  summary,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-sm font-medium text-muted-foreground">{summary}</p>
          <div className="mt-4 space-y-3 text-sm font-medium text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  );
}

function RefTable({ rows }: { rows: { term: string; detail: string }[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[480px] text-sm">
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.term} className={i % 2 === 0 ? "bg-card" : "bg-surface/50"}>
              <td className="w-36 shrink-0 px-4 py-3 font-medium text-foreground align-top sm:w-48">
                {row.term}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{row.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function PlatformGuide({
  stack,
  detects,
  checks,
  fixes,
  notes,
}: {
  stack: string;
  detects: string;
  checks: string[];
  fixes: string[];
  notes?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <p className="font-display text-lg font-semibold text-foreground">{stack}</p>
      <p className="mt-2 text-sm">
        <span className="font-medium text-foreground">Detection: </span>
        {detects}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            What we check
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {checks.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <Search className="mt-0.5 h-3 w-3 shrink-0" />
                {c}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Typical fixes
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {fixes.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Zap className="mt-0.5 h-3 w-3 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {notes && (
        <p className="mt-4 rounded-lg border border-border/60 bg-surface/50 px-3 py-2 text-xs">
          {notes}
        </p>
      )}
    </div>
  );
}

function DocsPage() {
  const [active, setActive] = useState<SectionId>("overview");

  useEffect(() => {
    const sections = NAV.map((n) => document.getElementById(n.id)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActive(visible.target.id as SectionId);
      },
      { rootMargin: "-15% 0px -65% 0px", threshold: [0, 0.15, 0.35] },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="border-b border-border/60 py-10 sm:py-14">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-primary">Documentation</p>
              <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">
                Complete guide to LaunchReadyy
              </h1>
              <p className="mt-3 max-w-2xl font-medium text-muted-foreground">
                Everything from your first scan to repository handoffs — scoring, fixes, pull
                requests, launch blockers, platform support, and troubleshooting.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/workflow"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-muted transition"
              >
                <Workflow className="h-3.5 w-3.5" />
                How it works
              </Link>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition"
              >
                Get it on GitHub <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-10 py-10 lg:grid-cols-[240px_1fr] lg:gap-14 lg:py-14">
          <aside className="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
            <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
              {NAV.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={() => setActive(item.id)}
                  className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active === item.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="mt-6 hidden rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground lg:block">
              <p className="font-medium text-foreground">Also see</p>
              <div className="mt-2 space-y-1.5">
                <Link to="/workflow" className="block text-primary hover:underline">
                  How it works
                </Link>
                <Link to="/faq" className="block text-primary hover:underline">
                  FAQ
                </Link>
                <Link to="/contact" className="block text-primary hover:underline">
                  Contact
                </Link>
              </div>
            </div>
          </aside>

          <div className="min-w-0 space-y-20 sm:space-y-24">
            {/* ── OVERVIEW ── */}
            <Section
              id="overview"
              title="Overview"
              lead="LaunchReadyy is a production-readiness platform for software repositories. It connects to GitHub, analyzes your codebase and configuration, scores how close you are to a safe launch, and generates fixes as pull requests on new branches."
            >
              <p>
                Whether you ship a Next.js app, a Flutter mobile app, a Go API, or an Electron
                desktop tool, LaunchReadyy detects your stack from manifests and file patterns —
                then applies the right checks and fix templates for that language and framework. You
                stay in control: preview every diff, choose exactly what goes into the PR, and merge
                on GitHub when you're ready.
              </p>

              <SubHeading>Where to find what</SubHeading>
              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  to="/workflow"
                  className="group rounded-xl border border-border bg-card p-4 transition hover:border-primary/30 hover:bg-primary/5"
                >
                  <Workflow className="h-4 w-4 text-primary" />
                  <p className="mt-2 font-medium text-foreground group-hover:text-primary">
                    How it works
                  </p>
                  <p className="mt-1 text-xs leading-relaxed">
                    Visual 5-step journey — connect, scan, select, PR, merge.
                  </p>
                </Link>
                <a
                  href="#capabilities"
                  className="rounded-xl border border-primary/30 bg-primary/5 p-4"
                >
                  <BookOpen className="h-4 w-4 text-primary" />
                  <p className="mt-2 font-medium text-foreground">Capabilities</p>
                  <p className="mt-1 text-xs leading-relaxed">Tools and fix types.</p>
                </a>
              </div>

              <p className="text-sm">
                Workflows by audience:{" "}
                <a href="#use-cases" className="text-primary hover:underline">
                  Use cases
                </a>
                . Data handling:{" "}
                <a href="#privacy-data" className="text-primary hover:underline">
                  Data & privacy
                </a>
                .
              </p>
            </Section>

            {/* ── GETTING STARTED ── */}
            <Section
              id="getting-started"
              title="Getting started"
              lead="Quick checklist beyond the visual walkthrough — see How it works for the full step-by-step."
            >
              <div className="rounded-xl border border-border bg-card p-5">
                <p className="font-medium text-foreground">Start with the 5-step journey</p>
                <p className="mt-2 text-sm">
                  The{" "}
                  <Link to="/workflow" className="text-primary hover:underline">
                    How it works
                  </Link>{" "}
                  page walks through connect → scan → select → PR → merge with timing estimates and
                  a you vs LaunchReadyy breakdown. Read that first if you're new.
                </p>
                <Link
                  to="/workflow"
                  className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:opacity-80"
                >
                  Open How it works <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <SubHeading>Checklist (details not on How it works)</SubHeading>
              <BulletList
                items={[
                  "Review findings — use Accept the risk where a check doesn't apply",
                  "Preview every file diff before Generate PR",
                  "Re-scan after merging to update your score",
                ]}
              />
            </Section>

            {/* ── CAPABILITIES ── */}
            <Section
              id="capabilities"
              title="Capabilities"
              lead="Every tool in LaunchReadyy — what it does and what it does."
            >
              <div className="grid gap-2 sm:grid-cols-2">
                {PRODUCT_TOOLS.map((tool) => (
                  <div
                    key={tool.title}
                    className="flex items-start justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-foreground">{tool.title}</p>
                      <p className="mt-0.5 text-xs">{tool.desc}</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {tool.badge}
                    </span>
                  </div>
                ))}
              </div>

              <SubHeading>Sandbox verification</SubHeading>
              <p>
                Ephemeral install/build/lint for supported stacks (Node, Python, Go, Rust today).
                Other ecosystems soft-skip with a clear reason — static scoring still runs. Manual
                runs: repo → Sandbox.
              </p>

              <SubHeading>What the scanner checks</SubHeading>
              <div className="grid gap-2 sm:grid-cols-2">
                {SCAN_CATEGORIES.map((c) => (
                  <div
                    key={c.label}
                    className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm"
                  >
                    <p className="font-medium text-foreground">{c.label}</p>
                    <p className="mt-0.5 text-xs">{c.desc}</p>
                  </div>
                ))}
              </div>

              <SubHeading>Template fixes</SubHeading>
              <p>Pre-written, stack-aware configs generated from your stack.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {TEMPLATE_FIXES.map((label) => (
                  <div
                    key={label}
                    className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                    {label}
                  </div>
                ))}
              </div>

              <SubHeading>AI-generated fixes</SubHeading>
              <p>Reads up to 35 source files — tailored output, not generic boilerplate per fix.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {AI_FIXES.map((label) => (
                  <div
                    key={label}
                    className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
                  >
                    <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
                    {label}
                  </div>
                ))}
              </div>

              <SubHeading>Code auditor</SubHeading>
              <p>Deterministic patches from source analysis — runs on every scan.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {AUDITOR_FIXES.map((x) => (
                  <div
                    key={x.label}
                    className="rounded-md border border-border bg-card px-3 py-2.5 text-sm"
                  >
                    <p className="font-medium text-foreground">{x.label}</p>
                    <p className="mt-0.5 text-xs">{x.note}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* ── GUIDES ── */}
            <Section
              id="guides"
              title="Guides"
              lead="Scoring and fix packs — for tool lists see Capabilities and Reference."
            >
              <div className="space-y-4">
                <GuideCard
                  icon={<BarChart3 className="h-4 w-4" />}
                  title="Understanding your readiness score"
                  summary="How the 0–100 score is calculated and how to interpret it."
                >
                  <p>
                    The score starts at 100 and subtracts points for each gap based on severity.
                    Severity definitions:{" "}
                    <a href="#reference" className="text-primary hover:underline">
                      Reference
                    </a>
                    .
                  </p>
                  <p>
                    <strong className="text-foreground">Score bands:</strong>
                  </p>
                  <BulletList
                    items={[
                      "90–100 — Strong foundation; remaining gaps are polish or optional",
                      "80–89 — Solid; address high-severity items before a major launch",
                      "60–79 — Gaps in core areas; use fix packs for a quick baseline",
                      "Below 60 — Missing multiple launch foundations; prioritize CI, env docs, and tests",
                    ]}
                  />
                  <p>Checklist coverage only — not business viability or logic correctness.</p>
                </GuideCard>

                <GuideCard
                  icon={<Boxes className="h-4 w-4" />}
                  title="Using fix packs"
                  summary="Pre-built bundles for common launch scenarios."
                >
                  <p>
                    Fix packs group related fixes so you don't have to pick items one by one. Each
                    pack shows an estimated effort and risk level before you apply it. Selecting a
                    pack pre-checks included fixes — you can still add or remove individual items.
                  </p>
                  <p>
                    <strong className="text-foreground">Available packs:</strong>
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[520px] text-xs">
                      <thead>
                        <tr className="border-b border-border bg-surface/50 text-left">
                          <th className="px-3 py-2 font-semibold text-foreground">Pack</th>
                          <th className="px-3 py-2 font-semibold text-foreground">Includes</th>
                          <th className="px-3 py-2 font-semibold text-foreground">
                            Relative effort
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {FIX_PACKS.map((pack) => (
                          <tr key={pack.id} className="border-b border-border/50 last:border-0">
                            <td className="px-3 py-2 font-medium text-foreground">{pack.name}</td>
                            <td className="px-3 py-2">{pack.description}</td>
                            <td className="px-3 py-2">{pack.effort}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p>
                    Packs adapt to your language — a Python repo gets ruff instead of ESLint,
                    Flutter gets dart-test-ai instead of Playwright. Some packs include manual
                    checklist items (e.g. Stripe webhook secret rotation) that require your action
                    after merge.
                  </p>
                </GuideCard>
              </div>
            </Section>

            {/* ── USE CASES ── */}
            <Section
              id="use-cases"
              title="Use cases"
              lead="How different teams typically use LaunchReadyy — pick the path closest to yours."
            >
              <div className="space-y-4">
                <GuideCard
                  icon={<Sparkles className="h-4 w-4" />}
                  title="Indie developer — first production deploy"
                  summary="You built the product; now you need CI, env docs, and Stripe basics before charging."
                >
                  <p>
                    <strong className="text-foreground">Typical starting score:</strong> 40–65.
                    Missing CI, README setup, .env.example, and monitoring are common.
                  </p>
                  <p>
                    <strong className="text-foreground">Recommended path:</strong>
                  </p>
                  <BulletList
                    items={[
                      "Scan → review launch verdict and top 3 blockers",
                      "Apply Env Safety Pack or Production Launch Pack for a single PR baseline",
                      "Merge, re-scan, then add the Testing Pack if tests are missing",
                      "Share launch report with a co-founder or advisor before going live",
                    ]}
                  />
                  <p>
                    Fix order:{" "}
                    <a href="#best-practices" className="text-primary hover:underline">
                      Best practices
                    </a>
                    .
                  </p>
                </GuideCard>

                <GuideCard
                  icon={<Users className="h-4 w-4" />}
                  title="Handoff summary"
                  summary="Deliver a repo with proof it's production-ready, not just feature-complete."
                >
                  <p>
                    Connect the client's repo, run a scan, and generate a{" "}
                    <strong className="text-foreground">launch report</strong> link for the handoff
                    deck. Apply fixes on a branch; client reviews the PR on GitHub.
                  </p>
                  <BulletList
                    items={[
                      "Document accepted risks for scope the client explicitly declined",
                      "Use job history to show what was run and when",
                      "Re-scan after client merge — send updated report as sign-off evidence",
                      "Multi-repo overview across everything this installation monitors",
                    ]}
                  />
                </GuideCard>

                <GuideCard
                  icon={<GithubIcon className="h-4 w-4" />}
                  title="Open-source maintainer — contributor onboarding"
                  summary="Make it easy for new contributors to run tests and CI locally."
                >
                  <p>
                    Focus on README + Setup Pack, CI/CD Pack, and free linter templates. OSS repos
                    benefit most from clear install instructions and a green CI badge on PRs.
                  </p>
                  <BulletList
                    items={[
                      "README-ai documents your actual npm/poetry/go scripts",
                      "CI workflow runs lint + test on every pull request",
                      ".env.example lists every variable contributors need",
                    ]}
                  />
                </GuideCard>

                <GuideCard
                  icon={<CreditCard className="h-4 w-4" />}
                  title="Stripe-integrated app — payment safety"
                  summary="Before accepting real payments, close infra gaps around webhooks and env config."
                >
                  <p>
                    Apply <strong className="text-foreground">Stripe Infra Pack</strong>. Auditor
                    flags webhook gaps — see{" "}
                    <a href="#launch-blockers" className="text-primary hover:underline">
                      Launch blockers
                    </a>{" "}
                    examples.
                  </p>
                  <BulletList
                    items={[
                      "Confirm .env.example lists STRIPE_* keys without real values",
                      "Add smoke tests for checkout if budget allows",
                      "Rotate webhook secret in Stripe dashboard if PR checklist says so",
                    ]}
                  />
                </GuideCard>

                <GuideCard
                  icon={<BrainCircuit className="h-4 w-4" />}
                  title="Inherited codebase — technical due diligence"
                  summary="You joined or acquired a project and need a fast structural read."
                >
                  <p>
                    Run a standard scan for launch blockers, then architecture analysis ( JS/TS
                    repos) for circular deps, dead files, and unused packages.
                  </p>
                  <BulletList
                    items={[
                      "Use Accept the risk with notes to document known legacy debt",
                      "Export launch report for stakeholders who won't read GitHub",
                      "Prioritize auditor findings on auth and payment paths first",
                    ]}
                  />
                </GuideCard>
              </div>
            </Section>

            {/* ── BEST PRACTICES ── */}
            <Section
              id="best-practices"
              title="Best practices"
              lead="Recommendations from teams who've shipped with LaunchReadyy — no special setup required."
            >
              <SubHeading>Before your first scan</SubHeading>
              <BulletList
                items={[
                  "Ensure package.json (or go.mod, Gemfile, etc.) is at the repo root with dependencies declared",
                  "Push your latest work to GitHub — scans read the default branch you connect",
                  "If the repo is private, make sure your GITHUB_TOKEN has repo access",
                  "Skim your README — you'll compare it to what AI generates later",
                ]}
              />

              <SubHeading>Choosing fixes wisely</SubHeading>
              <p>Start cheap, add depth incrementally:</p>
              <ol className="list-decimal space-y-2 pl-5 marker:font-semibold marker:text-primary">
                <li>
                  <span className="font-medium text-foreground">Free linters</span> — zero risk,
                  instant PR value
                </li>
                <li>
                  <span className="font-medium text-foreground">CI + README</span> — unblocks
                  contributors and deploy confidence
                </li>
                <li>
                  <span className="font-medium text-foreground">Env docs + monitoring</span> —
                  prevents production config surprises
                </li>
                <li>
                  <span className="font-medium text-foreground">Tests (unit then E2E)</span> —
                  highest effort; preview diffs carefully
                </li>
                <li>
                  <span className="font-medium text-foreground">Auditor security fixes</span> —
                  prioritize payment and auth routes
                </li>
              </ol>

              <SubHeading>Reviewing a generated PR</SubHeading>
              <p>Every PR deserves the same review you'd give a human contributor:</p>
              <BulletList
                items={[
                  "Read the PR description — lists files added and any manual follow-up steps",
                  "Skim CI workflow — confirm build and test commands match your scripts",
                  "Check .env.example — no real secrets, all vars your app reads are listed",
                  "Run the branch locally if the change touches runtime config",
                  "For AI tests — verify imports resolve and assertions match real routes",
                  "Don't merge if something looks wrong — tweak on the branch or deselect and regenerate",
                ]}
              />

              <SubHeading>After merge checklist</SubHeading>
              <div className="rounded-xl border border-border bg-card p-5">
                <ol className="space-y-3">
                  {[
                    {
                      t: "Wait for CI on main",
                      d: "First push after merge should trigger the new workflow. Fix any red checks before announcing launch.",
                    },
                    {
                      t: "Set production env vars",
                      d: "Copy from .env.example to your host (Vercel, Railway, Fly, etc.). Never commit real secrets.",
                    },
                    {
                      t: "Re-scan in LaunchReadyy",
                      d: "Confirms blockers cleared and updates your score. Screenshot or export report for records.",
                    },
                    {
                      t: "Schedule a follow-up scan",
                      d: "Monthly re-scans catch drift — new deps without tests, removed monitoring, etc.",
                    },
                  ].map((item, i) => (
                    <li key={item.t} className="flex items-start gap-3 text-sm">
                      <span className="font-display text-lg font-bold text-primary/40">
                        {i + 1}
                      </span>
                      <div>
                        <p className="font-medium text-foreground">{item.t}</p>
                        <p className="mt-0.5">{item.d}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <SubHeading>What LaunchReadyy does not replace</SubHeading>
              <BulletList
                items={[
                  "Manual QA of your actual product flows and edge cases",
                  "Penetration testing or formal security audits",
                  "Legal review (privacy policy, terms, GDPR compliance)",
                  "Load testing and capacity planning",
                  "Business logic correctness — tests scaffold structure, not your domain rules",
                  "Production incident response — monitoring helps, but you still need runbooks",
                ]}
              />
            </Section>

            {/* ── LAUNCH BLOCKERS ── */}
            <Section
              id="launch-blockers"
              title="Launch blockers"
              lead="The prioritized action plan between your repo and a safe production launch."
            >
              <p>
                After every scan, LaunchReadyy surfaces a launch verdict and a blocker list — not
                just a score. Each blocker tells you what was actually checked (file names, config
                keys, code patterns), why it matters in real production terms, and how to fix it.
              </p>

              <SubHeading>Launch verdicts</SubHeading>
              <RefTable
                rows={[
                  {
                    term: "Not ready",
                    detail:
                      "One or more critical blockers remain — missing CI, no tests on payment routes, webhook verification gaps, or similar. Address these before shipping to production.",
                  },
                  {
                    term: "Conditional",
                    detail:
                      "No critical blockers, but high-severity gaps remain — env documentation, monitoring, API validation. Safe to ship with documented acceptance of remaining risk.",
                  },
                  {
                    term: "Ready",
                    detail:
                      "Core launch foundation is in place. Remaining items are polish or optional improvements.",
                  },
                ]}
              />

              <SubHeading>Decision engine</SubHeading>
              <p>
                Beyond severity sorting, the decision engine recommends{" "}
                <strong className="text-foreground">"Fix these 3 first"</strong> based on your
                launch target and timeline — prioritizing items that unblock the most downstream
                work. A missing CI workflow often ranks above a missing Prettier config even if both
                are flagged.
              </p>

              <SubHeading>Accept the risk</SubHeading>
              <p>
                Not every finding applies to every project. Use{" "}
                <strong className="text-foreground">Accept the risk</strong> to mark a finding as:
              </p>
              <BulletList
                items={[
                  "Temporary — you'll fix it post-launch",
                  "Won't fix — intentional decision",
                  "False positive — detection doesn't match your setup",
                  "Not applicable — check doesn't apply to your stack or architecture",
                ]}
              />
              <p>
                Add an optional note for context (useful for repository handoffs). Accepted findings
                remain visible in history but are excluded from your active blocker count and launch
                verdict calculation.
              </p>

              <SubHeading>From blockers to PR</SubHeading>
              <p>
                Each blocker with an available fix links directly to the fix selection screen. You
                can fix blockers individually or batch them via fix packs. After merging, re-scan to
                confirm blockers are resolved and your verdict improves.
              </p>

              <SubHeading>Example scenarios (illustrative)</SubHeading>
              <div className="space-y-3">
                {[
                  {
                    title: "Missing GitHub Actions workflow",
                    why: "Without CI, broken code can reach main unnoticed — especially risky before a launch deadline.",
                    fix: "CI/CD Pack or ci-ai fix. Re-scan after merge to clear the blocker.",
                  },
                  {
                    title: "No .env.example",
                    why: "Deploys fail silently when production is missing DATABASE_URL or API keys the app expects.",
                    fix: "env-example template (Node) or env-example-ai (reads your source for var names).",
                  },
                  {
                    title: "Stripe webhook without signature check",
                    why: "Attackers could send fake payment events — orders marked paid without proof of payment.",
                    fix: "Auditor fix (free). Verify constructEvent or equivalent in the PR diff.",
                  },
                  {
                    title: "No error monitoring",
                    why: "Users hit errors you never see. First production week becomes blind debugging.",
                    fix: "Monitoring template — Sentry or structured logging setup matched to your stack.",
                  },
                ].map((ex) => (
                  <div key={ex.title} className="rounded-lg border border-border bg-card px-4 py-3">
                    <p className="font-medium text-foreground">{ex.title}</p>
                    <p className="mt-1 text-xs">
                      <span className="text-foreground">Why it matters: </span>
                      {ex.why}
                    </p>
                    <p className="mt-1 text-xs">
                      <span className="text-foreground">Typical fix: </span>
                      {ex.fix}
                    </p>
                  </div>
                ))}
              </div>
            </Section>

            {/* ── PLATFORMS ── */}
            <Section
              id="platforms"
              title="Platform guides"
              lead="Stack-specific detection, checks, and typical fixes for every supported platform."
            >
              <p>
                Per-framework detection and operational notes below. Stack support matrix is in{" "}
                <a href="#capabilities" className="text-primary hover:underline">
                  Capabilities
                </a>
                .
              </p>

              <div className="space-y-4">
                <PlatformGuide
                  stack="Next.js"
                  detects="next in package.json dependencies, app/ or pages/ directory"
                  checks={[
                    "GitHub Actions CI with next build",
                    "Vitest or Jest test runner",
                    "Playwright E2E for public routes",
                    "Error boundary component",
                    "Environment variable documentation",
                    "Sentry or error monitoring",
                  ]}
                  fixes={[
                    "AI-tailored CI workflow",
                    "Vitest scaffold with your components",
                    "Playwright smoke tests",
                    "next.config security headers",
                    "README with deploy instructions",
                  ]}
                  notes="Full framework-specific rules — deepest analysis tier for JS web apps."
                />

                <PlatformGuide
                  stack="Vite / React / Remix / SvelteKit / Astro"
                  detects="vite in devDependencies, or framework-specific config files"
                  checks={[
                    "CI with vite build",
                    "Vitest unit tests",
                    "Playwright E2E",
                    "ESLint + Prettier",
                    "Dockerfile for static or SSR deploy",
                  ]}
                  fixes={[
                    "CI workflow referencing your build script",
                    "Vitest + Testing Library scaffold",
                    "Playwright config for your routes",
                    "AI README with setup steps",
                  ]}
                  notes="Remix, SvelteKit, and Astro receive shared Vite/JS checks. Framework-specific deep rules are not yet available."
                />

                <PlatformGuide
                  stack="Express / Bun / NestJS"
                  detects="express, @nestjs/core, or hono in dependencies"
                  checks={[
                    "Helmet security headers",
                    "Rate limiting middleware",
                    "Winston or structured logging",
                    "API route tests",
                    "Dockerfile",
                    ".env.example completeness",
                  ]}
                  fixes={[
                    "Helmet + express-rate-limit setup",
                    "API test scaffold",
                    "Dockerfile with multi-stage build",
                    "Auditor: auth middleware on sensitive routes",
                  ]}
                />

                <PlatformGuide
                  stack="Expo / React Native"
                  detects="expo in dependencies, app.json or app.config.js"
                  checks={[
                    "EAS Build configuration",
                    "Jest test setup",
                    "CI for lint and test",
                    "Environment config for API URLs",
                  ]}
                  fixes={[
                    "GitHub Actions with expo commands",
                    "Jest config for RN components",
                    "app.config env documentation",
                  ]}
                  notes="Playwright applies to web/dev targets; native E2E is flagged as manual follow-up."
                />

                <PlatformGuide
                  stack="Electron / Tauri"
                  detects="electron or @tauri-apps/api in dependencies"
                  checks={[
                    "Desktop packager CI",
                    "Security baseline (context isolation, CSP)",
                    "Auto-update configuration hints",
                    "Test runner presence",
                  ]}
                  fixes={[
                    "CI workflow for desktop builds",
                    "Security hardening templates",
                    "Dockerfile if shipping server component",
                  ]}
                />

                <PlatformGuide
                  stack="Flutter / Dart"
                  detects="pubspec.yaml with flutter SDK"
                  checks={[
                    "flutter analyze in CI",
                    "flutter test runner",
                    "pubspec.yaml validation",
                    "Platform-specific build configs",
                  ]}
                  fixes={[
                    "GitHub Actions with flutter commands",
                    "dart-test-ai unit test scaffold",
                    "README with flutter run instructions",
                  ]}
                />

                <PlatformGuide
                  stack="Swift / iOS · Kotlin / Android"
                  detects="Package.swift, .xcodeproj, build.gradle, or AndroidManifest.xml"
                  checks={[
                    "XCTest or Gradle test CI",
                    "Platform lint (SwiftLint, ktlint)",
                    "Release signing documentation",
                    "CI for simulator/device builds",
                  ]}
                  fixes={[
                    "macOS CI for Swift projects",
                    "swift-test-ai or kotlin-test-ai scaffolds",
                    "README setup for Xcode/Android Studio",
                  ]}
                />

                <PlatformGuide
                  stack="Go · Python · Ruby · PHP · Java · Rust · C# · Elixir"
                  detects="go.mod, pyproject.toml/requirements.txt, Gemfile, composer.json, pom.xml, Cargo.toml, .csproj, mix.exs"
                  checks={[
                    "Language-native CI (go test, pytest, rspec, etc.)",
                    "Linter config (golangci-lint, ruff, rubocop, etc.)",
                    "Dockerfile",
                    "README with install and run commands",
                    ".env.example",
                  ]}
                  fixes={[
                    "AI CI workflow with your actual test commands",
                    "Language-specific test scaffold (pytest-ai, go-test-ai, etc.)",
                    "README-ai with your repo name and scripts",
                    "Dockerfile for your runtime",
                  ]}
                  notes="Backend-only repos (no HTML) get api-tests instead of Playwright E2E."
                />
              </div>

              <SubHeading>Monorepos</SubHeading>
              <p>
                Basic monorepo support reads the root package.json and file tree. Per-package
                workspace awareness is limited — checks run at the repo root level. Full monorepo
                support (per-package scoring, workspace-aware CI) is planned.
              </p>

              <SubHeading>General tips by deploy target</SubHeading>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    target: "Vercel / Netlify",
                    tip: "Ensure CI runs build + test; README should document framework-specific env vars (NEXT_PUBLIC_*, VITE_*).",
                  },
                  {
                    target: "Railway / Render / Fly",
                    tip: "Dockerfile + health check endpoint help; .env.example should list PORT and database URLs.",
                  },
                  {
                    target: "AWS / GCP / Azure",
                    tip: "CI should produce artifacts; logging and monitoring fixes matter more at scale.",
                  },
                  {
                    target: "Mobile app stores",
                    tip: "CI for analyze/test; README for signing and release build steps — often manual follow-up.",
                  },
                ].map((item) => (
                  <div
                    key={item.target}
                    className="rounded-lg border border-border bg-card px-4 py-3 text-sm"
                  >
                    <p className="font-medium text-foreground">{item.target}</p>
                    <p className="mt-1 text-xs">{item.tip}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* ── ARCHITECTURE ── */}
            <Section
              id="architecture"
              title="Architecture analysis"
              lead="Structural audit for JS/TS repos."
            >
              <p>
                Import-graph analysis on <code className="text-xs">.ts/.js/.tsx/.jsx</code> files.
                Detects circular dependencies, dead files, unused packages, oversized modules, and
                layer violations. See{" "}
                <a href="#capabilities" className="text-primary hover:underline">
                  Capabilities
                </a>{" "}
              </p>

              <SubHeading>When to use it</SubHeading>
              <BulletList
                items={[
                  "Onboarding onto an unfamiliar codebase",
                  "Before a major refactor",
                  "Pre-acquisition due diligence (pair with a launch report)",
                  "High score but the codebase feels tangled",
                ]}
              />

              <p className="text-sm">
                Go, Python, Ruby, Flutter, and other languages use the standard scanner and
                language-specific fixes — import-graph analysis is JS/TS only.
              </p>
            </Section>

            {/* ── TROUBLESHOOTING ── */}
            <Section
              id="troubleshooting"
              title="Troubleshooting"
              lead="Errors and edge cases. General questions: FAQ."
            >
              <div className="space-y-4">
                {[
                  {
                    q: "Scan stuck or failed",
                    a: "Re-scan from the dashboard. Most failures are temporary GitHub API hiccups or very large repos. If still failing after 2 minutes, disconnect and reconnect GitHub from Settings.",
                  },
                  {
                    q: "Score seems wrong — I already have that file",
                    a: "Scans read file tree and configs, not runtime behavior. Non-standard paths (CI in .github/workflows/custom/) may not match detection rules. Use Accept the risk → False positive, and open a GitHub issue with your repo shape so we can improve detection.",
                  },
                  {
                    q: "PR files look wrong or incomplete",
                    a: "AI fixes depend on reading representative source files. Unusual project structure or very large files can affect output. Review the PR diff before merging, tweak as needed, and open a GitHub issue. AI fixes only add files — they never modify existing source.",
                  },
                  {
                    q: "Merged PR but score didn't change",
                    a: "Scores update only on re-scan. After merging on GitHub, return to the dashboard and click Analyze again.",
                  },
                  {
                    q: "Repo not showing after connecting GitHub",
                    a: "Make sure your GITHUB_TOKEN has the `repo` scope. Update it with `launchreadyy config`.",
                  },
                  {
                    q: "A fix job failed mid-run",
                    a: "Jobs not yet started won't run. Re-run the fix from the repo page after restarting LaunchReadyy.",
                  },
                  {
                    q: "Existing CI workflow flagged as missing",
                    a: "If you have a workflow in a non-standard location or using a non-GitHub CI (CircleCI, Jenkins), the scanner may not detect it. Mark as not applicable or add a GitHub Actions workflow alongside your existing CI.",
                  },
                  {
                    q: "AI fix references wrong framework",
                    a: "Check root package.json and declared dependencies, then re-scan. Open a GitHub issue for persistent mismatches.",
                  },
                ].map((item) => (
                  <div key={item.q} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      <div>
                        <p className="font-medium text-foreground">{item.q}</p>
                        <p className="mt-2 text-sm">{item.a}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 text-center">
                <p className="font-medium text-foreground">Still stuck?</p>
                <p className="mt-2 text-sm">
                  <Link to="/faq" className="text-primary hover:underline">
                    FAQ
                  </Link>{" "}
                  covers general and account questions. For errors, include repo name and what you
                  expected.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <a
                    href={`${REPO_URL}/issues`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
                  >
                    Open an issue <ArrowRight className="h-4 w-4" />
                  </a>
                  <Link
                    to="/contact"
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-muted transition"
                  >
                    Contact us
                  </Link>
                </div>
              </div>
            </Section>

            {/* ── DATA & PRIVACY ── */}
            <Section
              id="privacy-data"
              title="Data & privacy"
              lead="What LaunchReadyy reads, what it stores, and what leaves your browser — in plain language."
            >
              <SubHeading>During a scan</SubHeading>
              <p>
                We read your repository file tree and file contents through the GitHub API —
                configs, manifests, and representative source files for the auditor. This happens
                in-memory to produce your score and findings.{" "}
                <strong className="text-foreground">
                  Your source code is not saved to our database.
                </strong>
              </p>

              <SubHeading>During fix generation (AI fixes only)</SubHeading>
              <p>
                Relevant file excerpts are sent to our AI provider to generate tailored output (CI
                config, tests, README). Those excerpts are used for the request and{" "}
                <strong className="text-foreground">not retained by us</strong> after the job
                completes. We do not use your code to train models.
              </p>

              <SubHeading>What we store</SubHeading>
              <RefTable
                rows={[
                  {
                    term: "Account",
                    detail: "GitHub login, avatar and repository metadata from your token.",
                  },
                  {
                    term: "Scan results",
                    detail: "Score, findings list, categories, launch verdict — not file contents.",
                  },
                  {
                    term: "Job metadata",
                    detail: "Timestamps, effort estimates, PR URLs, job status.",
                  },
                  {
                    term: "OAuth token",
                    detail: "Encrypted GitHub token to read repos and open PRs you request.",
                  },
                ]}
              />

              <SubHeading>What we never do</SubHeading>
              <BulletList
                items={[
                  "Sell or share your data with advertisers",
                  "Index repos you haven't connected",
                  "Push to main or merge without your action on GitHub",
                  "Keep durable copies of your source after a job ends (AI excerpts and ephemeral sandbox clones only while a job runs)",
                  "Use tracking pixels or third-party ad networks",
                ]}
              />

              <p>
                Full legal detail:{" "}
                <Link to="/privacy" className="text-primary hover:underline">
                  Privacy Policy
                </Link>
                ,{" "}
                <Link to="/security" className="text-primary hover:underline">
                  Security
                </Link>
                ,{" "}
                <Link to="/terms" className="text-primary hover:underline">
                  Terms of Service
                </Link>
                .
              </p>
            </Section>

            {/* ── REFERENCE ── */}
            <Section id="reference" title="Reference" lead="Tables, limits, and quick lookups.">
              <SubHeading>Community features</SubHeading>
              <RefTable
                rows={[
                  {
                    term: "Repository analysis",
                    detail:
                      "Scan, sandbox verify, blockers, template fixes, auditor, automated PRs, full Production Security",
                  },
                  {
                    term: "Repository support",
                    detail:
                      "Private repos, unlimited repos, job history, full Production Security scan, AI security explanations",
                  },
                  {
                    term: "Also included",
                    detail:
                      "Live website security scan, security score history, architecture analysis, shareable launch reports",
                  },
                ]}
              />

              <SubHeading>Severity levels</SubHeading>
              <RefTable
                rows={[
                  {
                    term: "Critical",
                    detail:
                      "Blocks safe production deploy — missing CI, no tests on payment routes, exposed secret patterns, missing webhook verification.",
                  },
                  {
                    term: "High",
                    detail:
                      "Significant launch risk — missing env docs, no error monitoring, weak API validation, missing rate limiting.",
                  },
                  {
                    term: "Medium",
                    detail:
                      "Best-practice gaps — lint config, Dockerfile improvements, logging setup, README sections.",
                  },
                  {
                    term: "Low",
                    detail: "Polish — Prettier config, minor README tweaks, style tooling.",
                  },
                ]}
              />

              <SubHeading>Scan categories</SubHeading>
              <p className="text-sm">
                CI/CD, Testing, Code quality, Production Security, Deployment, Monitoring,
                Documentation — see{" "}
                <a href="#capabilities" className="text-primary hover:underline">
                  Capabilities
                </a>{" "}
                for per-category detail. Security findings always include evidence and a confidence
                level; a passive live website scan is also available.
              </p>

              <SubHeading>AI fix effort weights</SubHeading>
              <RefTable
                rows={[
                  { term: "env-example-ai", detail: "Light — scans source for env var usage" },
                  { term: "ci-ai", detail: "Medium — tailored CI workflow" },
                  { term: "readme-ai", detail: "Medium — setup docs from your scripts" },
                  {
                    term: "vitest-ai / pytest-ai / etc.",
                    detail: "Heavy — language test scaffold",
                  },
                  { term: "playwright-ai", detail: "Heavy — E2E smoke tests for web routes" },
                  { term: "architecture", detail: "Heavy — import-graph structural audit" },
                  { term: "auditor fixes", detail: "Light–heavy — deterministic source patches" },
                ]}
              />

              <SubHeading>Template fixes (always free)</SubHeading>
              <p>
                Prettier, Rubocop, ruff, golangci-lint, phpcs, checkstyle, credo — linting tool
                configs only.
              </p>

              <SubHeading>OAuth scopes</SubHeading>
              <RefTable
                rows={[
                  {
                    term: "repo",
                    detail:
                      "Read file contents, create branches, open pull requests on connected repos.",
                  },
                  {
                    term: "read:user",
                    detail: "Display GitHub avatar and username in dashboard.",
                  },
                ]}
              />

              <SubHeading>Related pages</SubHeading>
              <div className="flex flex-wrap gap-2">
                {[
                  { to: "/faq", label: "FAQ" },
                  { to: "/workflow", label: "How it works" },
                  { to: "/security", label: "Security" },
                  { to: "/privacy", label: "Privacy" },
                  { to: "/terms", label: "Terms" },
                ].map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </Section>

            {/* ── GLOSSARY ── */}
            <Section
              id="glossary"
              title="Glossary"
              lead="Short definitions — details live in the sections linked below."
            >
              <RefTable
                rows={[
                  {
                    term: "Readiness score",
                    detail: "0–100 checklist coverage. See Guides → score bands.",
                  },
                  {
                    term: "Launch verdict",
                    detail: "Not ready / Conditional / Ready. See Launch blockers.",
                  },
                  {
                    term: "Blocker",
                    detail: "Prioritized gap with evidence and fix options.",
                  },
                  {
                    term: "Template / AI / Auditor fix",
                    detail: "Three fix types. See Capabilities.",
                  },
                  {
                    term: "Fix pack",
                    detail: "Bundled fixes for a scenario. See Guides → fix packs.",
                  },
                  {
                    term: "Fix effort",
                    detail: "Relative AI-effort estimate shown before you apply a fix or pack.",
                  },
                  {
                    term: "Sandbox verify",
                    detail: "Ephemeral install/build/lint run. See Capabilities.",
                  },
                  {
                    term: "Accept the risk",
                    detail: "Acknowledge a finding without fixing. See Launch blockers.",
                  },
                  {
                    term: "Preflight",
                    detail: "Validation before PR generation.",
                  },
                ]}
              />
            </Section>

            {/* ── ACKNOWLEDGEMENTS ── */}
            <Section
              id="acknowledgements"
              title="Acknowledgements"
              lead="LaunchReadyy is built on open standards, open-source tools, and infrastructure we depend on daily."
            >
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
                  <div className="flex items-center gap-2 text-foreground">
                    <Heart className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold">Open source</h3>
                  </div>
                  <ul className="mt-4 space-y-3 text-sm">
                    {[
                      {
                        name: "React",
                        desc: "UI framework powering the LaunchReadyy dashboard and this documentation site.",
                      },
                      {
                        name: "TanStack Router & Query",
                        desc: "File-based routing, type-safe navigation, and server-state management.",
                      },
                      {
                        name: "Tailwind CSS",
                        desc: "Utility-first styling system used across all marketing and app surfaces.",
                      },
                      {
                        name: "Lucide",
                        desc: "Consistent icon set throughout the product UI.",
                      },
                      {
                        name: "Vitest & Playwright",
                        desc: "Testing frameworks we generate and recommend for Node and web repositories.",
                      },
                      {
                        name: "Hono",
                        desc: "Lightweight edge server runtime.",
                      },
                      {
                        name: "shadcn/ui",
                        desc: "Accessible component primitives for dialogs, tables, and form controls.",
                      },
                    ].map((item) => (
                      <li key={item.name} className="flex items-start gap-2">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span>
                          <strong className="text-foreground">{item.name}</strong> — {item.desc}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
                  <div className="flex items-center gap-2 text-foreground">
                    <Shield className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold">Infrastructure & services</h3>
                  </div>
                  <ul className="mt-4 space-y-3 text-sm">
                    {[
                      {
                        name: "GitHub",
                        desc: "Repository access via your own personal access token, plus branch and pull request APIs — the backbone of every fix delivery.",
                      },
                      {
                        name: "SQLite",
                        desc: "Local database on disk (data/launchreadyy.db). No hosted database, no external account.",
                      },
                      {
                        name: "E2B (optional)",
                        desc: "Ephemeral sandbox environments for install/build/lint verification, if you supply an API key.",
                      },
                      {
                        name: "AI providers (optional)",
                        desc: "Whichever provider you configure — deepseek, anthropic, openai, gemini, or cursor — for generating tailored CI configs, test scaffolds, and documentation. Source excerpts are transmitted only during fix generation and not retained.",
                      },
                    ].map((item) => (
                      <li key={item.name} className="flex items-start gap-2">
                        <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span>
                          <strong className="text-foreground">{item.name}</strong> — {item.desc}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
                  <div className="flex items-center gap-2 text-foreground">
                    <TestTube2 className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold">Standards & practices</h3>
                  </div>
                  <p className="mt-3 text-sm">
                    LaunchReadyy's readiness checklist draws from widely adopted production
                    practices: GitHub Actions for CI, 12-factor app configuration, OWASP-adjacent
                    security hygiene (Helmet, rate limiting, env documentation), structured logging,
                    error monitoring with Sentry, and language-native test runners. We align
                    generated output with official framework documentation where possible.
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
                  <div className="flex items-center gap-2 text-foreground">
                    <Activity className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold">Community & contributors</h3>
                  </div>
                  <p className="mt-3 text-sm">
                    Thank you to every user who submitted feedback, reported detection edge cases,
                    and helped shape fix packs and scanner rules. LaunchReadyy improves because
                    developers tell us what their repositories actually need.
                  </p>
                  <p className="mt-3 text-sm">
                    Special thanks to the open-source maintainers whose tools appear in the fixes we
                    generate — the Vitest, Playwright, ESLint, pytest, and golangci-lint communities
                    make production-ready defaults accessible to everyone.
                  </p>
                </div>

                <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-center">
                  <p className="font-display text-lg font-semibold text-foreground">
                    Built for indie founders and small teams
                  </p>
                  <p className="mt-3 text-sm max-w-lg mx-auto">
                    LaunchReadyy exists to close the gap between "it works on my machine" and "it's
                    ready to ship." Production setup shouldn't be the thing that stops you from
                    launching. Thank you for trusting us with your repositories.
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
                    <a
                      href="mailto:launchreadyy@gmail.com"
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-muted transition"
                    >
                      launchreadyy@gmail.com
                    </a>
                  </div>
                </div>
              </div>
            </Section>
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
