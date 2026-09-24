import { Link } from "../components/link";
import { REPO_URL } from "../lib/site";

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

export function Home() {
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
            An open-source, self-hosted production-readiness and verification tool for software
            repositories.
          </p>
          <p className="hero-detail">
            It analyzes release risks, produces evidence-backed findings, verifies selected
            behavior, and can help generate remediation changes.
          </p>
          <div className="hero-actions">
            <a className="button primary" href={REPO_URL} target="_blank" rel="noreferrer">
              View on GitHub <span>↗</span>
            </a>
            <Link className="button secondary" href="/docs#quick-start">
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
          <Link className="button primary" href="/docs#quick-start">
            Install Community <span>→</span>
          </Link>
        </div>
      </section>
    </>
  );
}
