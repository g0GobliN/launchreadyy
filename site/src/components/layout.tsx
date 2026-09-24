import { useState, type ReactNode } from "react";
import { Link } from "./link";
import { StarButton } from "./star-button";
import { EMAIL, REPO_URL, repoFile } from "../lib/site";

const NAV = [
  ["/docs", "Documentation"],
  ["/about", "About"],
  ["/security", "Security"],
] as const;

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
          <StarButton size="compact" />
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
        <div className="footer-brand-column">
          <div className="footer-brand">LaunchReadyy Community</div>
          <p>Self-hosted evidence for production readiness.</p>
        </div>
        <div className="footer-links">
          <div>
            <strong>Project</strong>
            <Link href="/docs">Documentation</Link>
            <Link href="/about">About</Link>
            <a href={REPO_URL}>Source code</a>
            <a href={repoFile("CONTRIBUTING.md")}>Contributing</a>
          </div>
          <div>
            <strong>Legal</strong>
            <Link href="/license">License</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href={repoFile("TRADEMARKS.md")}>Trademarks</a>
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
        © {new Date().getFullYear()} LaunchReadyy Community · Apache-2.0 licensed · Open source, no
        accounts, no telemetry.
      </div>
    </footer>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  );
}
