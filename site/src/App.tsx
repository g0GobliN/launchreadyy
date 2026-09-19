import { useEffect, useState, type ReactNode } from "react";

const REPO_URL = "https://github.com/g0GobliN/launchreadyy";
const EMAIL = "launchreadyy@gmail.com";

type Route = {
  title: string;
  description: string;
  render: () => ReactNode;
};

const NAV = [
  ["/docs", "Docs"],
  ["/about", "About"],
  ["/security", "Security"],
] as const;

function usePath() {
  const [path, setPath] = useState(window.location.pathname.replace(/\/+$/, "") || "/");

  useEffect(() => {
    const navigate = () => setPath(window.location.pathname.replace(/\/+$/, "") || "/");
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);

  return path;
}

function Link({
  href,
  children,
  className = "",
  onNavigate,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  onNavigate?: () => void;
}) {
  const internal = href.startsWith("/");
  return (
    <a
      href={href}
      className={className}
      onClick={
        internal
          ? (event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNavigate?.();
              window.history.pushState({}, "", href);
              window.dispatchEvent(new PopStateEvent("popstate"));
              window.scrollTo({ top: 0, behavior: "instant" });
            }
          : undefined
      }
    >
      {children}
    </a>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand" onNavigate={() => setOpen(false)}>
          <img src="/logo/mark-tight.png" alt="" />
          <span>LaunchReadyy</span>
        </Link>
        <button
          className="menu-button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Toggle navigation"
        >
          <span />
          <span />
        </button>
        <nav className={open ? "nav open" : "nav"} aria-label="Main navigation">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="nav-link" onNavigate={() => setOpen(false)}>
              {label}
            </Link>
          ))}
          <a className="github-link" href={REPO_URL} target="_blank" rel="noreferrer">
            View on GitHub <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer>
      <div className="footer-grid">
        <div>
          <div className="footer-brand">LaunchReadyy Community</div>
          <p>Self-hosted evidence for production readiness.</p>
        </div>
        <div className="footer-links">
          <div>
            <strong>Project</strong>
            <Link href="/docs">Documentation</Link>
            <Link href="/about">About</Link>
            <a href={REPO_URL}>GitHub</a>
          </div>
          <div>
            <strong>Legal</strong>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/license">License</Link>
          </div>
          <div>
            <strong>Contact</strong>
            <Link href="/security">Security</Link>
            <Link href="/contact">Contact</Link>
            <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        © {new Date().getFullYear()} LaunchReadyy Community. No hosted accounts. No telemetry.
      </div>
    </footer>
  );
}

function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  );
}

const checks = [
  [
    "01",
    "Repository evidence",
    "Findings point back to concrete files, configuration, and observed behavior.",
  ],
  [
    "02",
    "Readiness analysis",
    "Checks architecture, tests, deployment, operations, and practical security foundations.",
  ],
  [
    "03",
    "Isolated verification",
    "Optionally runs install, build, lint, and test workflows away from your machine.",
  ],
  [
    "04",
    "Reviewable remediation",
    "Can prepare focused changes as a pull request for you to inspect and merge.",
  ],
];

function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-glow" />
        <div className="hero-copy">
          <div className="eyebrow">
            <span /> LaunchReadyy Community
          </div>
          <h1>
            Know before
            <br />
            you <em>ship.</em>
          </h1>
          <p className="hero-lead">
            A source-available, self-hosted production-readiness and verification tool for software
            repositories.
          </p>
          <p className="hero-detail">
            It analyzes release risks, produces evidence-backed findings, verifies selected
            behavior, and can help generate remediation changes.
          </p>
          <div className="hero-actions">
            <a className="button primary" href={REPO_URL}>
              View on GitHub <span>↗</span>
            </a>
            <Link className="button secondary" href="/docs#get-started">
              Get Started <span>→</span>
            </Link>
            <Link className="text-link" href="/docs">
              Read the Docs
            </Link>
          </div>
        </div>
        <div className="hero-visual" aria-label="LaunchReadyy readiness report preview">
          <div className="visual-bar">
            <span />
            <span />
            <span />
            <small>readiness / latest scan</small>
          </div>
          <img
            src="/screenshots/readiness.webp"
            alt="LaunchReadyy readiness score and evidence-backed findings"
          />
        </div>
      </section>

      <section className="signal-strip">
        <span>STATIC ANALYSIS</span>
        <i /> <span>SANDBOX VERIFICATION</span>
        <i /> <span>EVIDENCE-BACKED FINDINGS</span>
        <i /> <span>FIX PULL REQUESTS</span>
      </section>

      <section className="section two-column">
        <div className="section-heading">
          <div className="kicker">What it does</div>
          <h2>Release decisions backed by evidence.</h2>
        </div>
        <p className="section-intro">
          LaunchReadyy brings scattered production checks into one self-hosted workflow. The result
          is a prioritized view of what is ready, what is risky, and what can be fixed next.
        </p>
      </section>
      <section className="check-grid">
        {checks.map(([number, title, body]) => (
          <article key={number}>
            <span>{number}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <section className="section proof-section">
        <div className="proof-copy">
          <div className="kicker">Review the change</div>
          <h2>Nothing ships itself.</h2>
          <p>
            Remediation stays reviewable. LaunchReadyy can prepare a focused branch and pull
            request; you keep control of the diff, CI, and merge.
          </p>
          <Link href="/docs" className="arrow-link">
            Explore the workflow <span>→</span>
          </Link>
        </div>
        <div className="proof-image">
          <img
            src="/screenshots/remediation.webp"
            alt="LaunchReadyy remediation pull request workflow"
          />
        </div>
      </section>

      <section className="section self-hosted">
        <div>
          <div className="kicker">Self-hosted by design</div>
          <h2>
            Your repositories.
            <br />
            Your credentials.
            <br />
            Your infrastructure.
          </h2>
        </div>
        <div>
          <p>
            The Community application runs locally or on infrastructure you control. Its Node
            server, worker, scheduler, credentials, and SQLite data remain with the operator—not on
            this public website.
          </p>
          <Link className="button primary" href="/docs#get-started">
            Install Community <span>→</span>
          </Link>
        </div>
      </section>
    </>
  );
}

function Page({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="page-shell">
      <div className="page-hero">
        <div className="kicker">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{intro}</p>
      </div>
      <div className="prose">{children}</div>
    </div>
  );
}

function Docs() {
  return (
    <Page
      eyebrow="Documentation"
      title="Run LaunchReadyy Community."
      intro="The public website is informational. Install the Community application from the repository to scan and verify software on infrastructure you control."
    >
      <section id="get-started">
        <h2>Get started</h2>
        <p>These commands follow the repository README:</p>
        <pre>
          <code>{`git clone https://github.com/g0GobliN/launchreadyy.git
cd launchreadyy
npm install
npm run build
npx launchreadyy setup
npx launchreadyy start`}</code>
        </pre>
        <p>
          Open the local address printed after the server starts. The interactive setup writes your
          local configuration. Run <code>npx launchreadyy doctor</code> to validate the installation
          and configured providers.
        </p>
      </section>
      <section>
        <h2>Requirements</h2>
        <ul>
          <li>Node.js 20.19 or a supported newer Node.js release</li>
          <li>Git</li>
          <li>Rust and wasm-pack for the repository indexer build</li>
          <li>Your own GitHub personal access token for repository operations</li>
        </ul>
      </section>
      <section>
        <h2>How it is deployed</h2>
        <p>
          The production Community build is one self-hosted Node.js process containing the web
          server, server functions, background worker, and scheduler. Persistent data is stored in a
          local SQLite database.
        </p>
        <p>
          For configuration, deployment hardening, operations, and API details, use the{" "}
          <a href={`${REPO_URL}/tree/main/docs`}>complete repository documentation</a>.
        </p>
      </section>
      <section>
        <h2>Optional capabilities</h2>
        <p>
          Sandbox verification and AI-assisted changes use providers configured by the operator.
          Without them, deterministic scanning, scoring, and template fixes continue to work.
        </p>
      </section>
    </Page>
  );
}

function About() {
  return (
    <Page
      eyebrow="About"
      title="Evidence for the release decision."
      intro="LaunchReadyy Community helps repository owners understand production risk before a release, without moving the application itself into a hosted service."
    >
      <section>
        <h2>Why it exists</h2>
        <p>
          Production readiness is usually spread across code review, CI logs, configuration,
          security checks, and tribal knowledge. LaunchReadyy collects those signals, attaches
          evidence, and turns them into a practical set of next actions.
        </p>
      </section>
      <section>
        <h2>Community architecture</h2>
        <p>
          The product is self-hosted and single-operator. You run the Node application, connect
          repositories with your own credentials, and keep persistent data in your local database.
          This website is a separate static project and does not run scans.
        </p>
      </section>
      <section>
        <h2>Project</h2>
        <p>
          Development, issues, source, and contribution guidance live in the{" "}
          <a href={REPO_URL}>official GitHub repository</a>. General questions can be sent to{" "}
          <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
        </p>
      </section>
    </Page>
  );
}

function Privacy() {
  return (
    <Page
      eyebrow="Privacy"
      title="The operator controls the data."
      intro="LaunchReadyy Community is self-hosted. There is no LaunchReadyy-hosted account service that receives repository data from Community installations."
    >
      <section>
        <h2>Community data</h2>
        <p>
          Repository metadata, scan results, findings, job history, and saved configuration remain
          in the operator's local SQLite database. Credentials are read by the Community server and
          are not meant to be sent to browser clients.
        </p>
      </section>
      <section>
        <h2>Configured providers</h2>
        <p>
          Community contacts GitHub for repository operations. If an operator enables isolated
          verification or AI-assisted features, relevant data may be sent directly to the providers
          they configure under those providers' terms.
        </p>
      </section>
      <section>
        <h2>This public website</h2>
        <p>
          This site is static. It has no account system, database, sessions, background jobs, or
          application telemetry. Standard hosting and network logs may still be processed by the
          hosting platform.
        </p>
      </section>
      <section>
        <h2>Questions</h2>
        <p>
          Each operator controls their own instance and its data. For questions about the official
          project, contact <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
        </p>
      </section>
    </Page>
  );
}

function Terms() {
  return (
    <Page
      eyebrow="Terms"
      title="Use Community on infrastructure you control."
      intro="LaunchReadyy Community is software you install and operate. The official project does not provide hosted accounts or a managed scanning service."
    >
      <section>
        <h2>Software terms</h2>
        <p>
          The software is provided under the licensing terms in the repository. Your use,
          modification, and distribution of the project are governed by those files.
        </p>
      </section>
      <section>
        <h2>Your responsibility</h2>
        <p>
          You are responsible for securing your instance, credentials, database, network access,
          provider accounts, and the repositories you connect. Review generated findings and changes
          before relying on or merging them.
        </p>
      </section>
      <section>
        <h2>No certification</h2>
        <p>
          Readiness results are engineering guidance, not a guarantee, penetration test, legal
          review, compliance certification, or assurance that software is safe to release.
        </p>
      </section>
      <section>
        <h2>Third parties</h2>
        <p>
          GitHub and any optional verification or AI providers you configure operate under their own
          terms, limits, and privacy practices.
        </p>
      </section>
    </Page>
  );
}

function Security() {
  return (
    <Page
      eyebrow="Security"
      title="Report vulnerabilities privately."
      intro="Security issues in LaunchReadyy Community should be reported through the repository's private GitHub security advisory flow."
    >
      <section>
        <h2>Reporting</h2>
        <p>
          Open the repository's{" "}
          <a href={`${REPO_URL}/security/advisories/new`}>private vulnerability report</a>. Include
          the impact, reproduction steps or proof of concept, and the commit you tested.
        </p>
      </section>
      <section>
        <h2>Security boundary</h2>
        <p>
          Community is self-hosted. Important issues include sandbox escape, server-side request
          forgery, secret disclosure, injection through repository-controlled input, or a fix
          workflow producing changes other than the reviewed diff.
        </p>
      </section>
      <section>
        <h2>Deployment hardening</h2>
        <p>
          Keep the application private by default, protect local configuration and the data
          directory, and place an authenticating reverse proxy or VPN in front of any
          network-accessible instance. See the{" "}
          <a href={`${REPO_URL}/blob/main/SECURITY.md`}>complete security policy</a>.
        </p>
      </section>
    </Page>
  );
}

function License() {
  return (
    <Page
      eyebrow="License"
      title="Repository licensing applies."
      intro="LaunchReadyy Community is currently distributed under the Apache License 2.0, with separate trademark guidance for the project name and logos."
    >
      <section>
        <h2>Software license</h2>
        <p>
          The repository's <a href={`${REPO_URL}/blob/main/LICENSE`}>LICENSE</a> file is the source
          of truth. It includes the permissions, conditions, patent terms, warranty disclaimer, and
          limitation of liability that apply to the software.
        </p>
      </section>
      <section>
        <h2>Trademarks</h2>
        <p>
          The software license does not grant permission to present an unofficial fork, modified
          version, product, or service as the official LaunchReadyy project. Read the{" "}
          <a href={`${REPO_URL}/blob/main/TRADEMARKS.md`}>trademark guidance</a> before distributing
          a fork.
        </p>
      </section>
    </Page>
  );
}

function Contact() {
  return (
    <Page
      eyebrow="Contact"
      title="Talk to the project."
      intro="Use email for general questions and private GitHub advisories for security reports."
    >
      <section className="contact-card">
        <h2>General questions</h2>
        <a className="contact-link" href={`mailto:${EMAIL}`}>
          {EMAIL} <span>↗</span>
        </a>
        <p>Questions about the project, self-hosting, or trademark use.</p>
      </section>
      <section className="contact-card">
        <h2>Issues and contributions</h2>
        <a className="contact-link" href={`${REPO_URL}/issues`}>
          GitHub issues <span>↗</span>
        </a>
        <p>Bug reports, feature discussions, and public project work.</p>
      </section>
    </Page>
  );
}

function NotFound() {
  return (
    <div className="not-found">
      <div className="score-ring">
        <span>404</span>
      </div>
      <div className="kicker">Route check failed</div>
      <h1>This page never shipped.</h1>
      <p>The path does not exist on the LaunchReadyy public site.</p>
      <Link href="/" className="button primary">
        Return home <span>→</span>
      </Link>
    </div>
  );
}

const ROUTES: Record<string, Route> = {
  "/": {
    title: "LaunchReadyy Community — Know before you ship",
    description: "Self-hosted production-readiness and verification for software repositories.",
    render: Home,
  },
  "/docs": {
    title: "Documentation — LaunchReadyy",
    description: "Install and run LaunchReadyy Community on infrastructure you control.",
    render: Docs,
  },
  "/about": {
    title: "About — LaunchReadyy",
    description: "About LaunchReadyy Community and its self-hosted architecture.",
    render: About,
  },
  "/privacy": {
    title: "Privacy — LaunchReadyy",
    description: "How data is handled by self-hosted LaunchReadyy Community installations.",
    render: Privacy,
  },
  "/terms": {
    title: "Terms — LaunchReadyy",
    description: "Terms for the LaunchReadyy Community project.",
    render: Terms,
  },
  "/security": {
    title: "Security — LaunchReadyy",
    description: "Report security vulnerabilities in LaunchReadyy Community.",
    render: Security,
  },
  "/license": {
    title: "License — LaunchReadyy",
    description: "LaunchReadyy Community licensing and trademark information.",
    render: License,
  },
  "/contact": {
    title: "Contact — LaunchReadyy",
    description: "Contact the LaunchReadyy Community project.",
    render: Contact,
  },
};

export function App() {
  const path = usePath();
  const route = ROUTES[path];
  useEffect(() => {
    document.title = route?.title ?? "Page not found — LaunchReadyy";
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", route?.description ?? "This LaunchReadyy page could not be found.");
  }, [route]);
  return <Layout>{route ? route.render() : <NotFound />}</Layout>;
}
