import { Link } from "@tanstack/react-router";
import { BrandWordmark } from "@/components/brand-wordmark";
import { PRODUCT_TAGLINE } from "@/lib/product";

const REPO_URL = "https://github.com/g0GobliN/launchreadyy";

/** Community footer with project, documentation, and licensing links. */
export function SiteFooter() {
  const lnk = "block hover:text-foreground transition";

  return (
    <footer className="border-t border-border/60 bg-card/40 pt-8 pb-6">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="text-xs text-muted-foreground">
            <BrandWordmark size="nav" className="font-display text-sm font-semibold" />
            <p className="mt-1.5 max-w-sm leading-relaxed">{PRODUCT_TAGLINE}</p>
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-4 text-xs text-muted-foreground">
            <div>
              <div className="font-semibold text-foreground mb-1">Project</div>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={lnk}>
                GitHub
              </a>
              <Link to="/docs" className={lnk}>
                Documentation
              </Link>
              <Link to="/changelog" className={lnk}>
                Changelog
              </Link>
            </div>
            <div>
              <div className="font-semibold text-foreground mb-1">Legal</div>
              <Link to="/license" className={lnk}>
                License
              </Link>
              <Link to="/security" className={lnk}>
                Security
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-border/50 pt-5 text-xs text-muted-foreground">
          <span>
            © {new Date().getFullYear()} LaunchReadyy Community. Self-hosted. Bring your own
            credentials — no accounts, no telemetry.
          </span>
        </div>
      </div>
    </footer>
  );
}
