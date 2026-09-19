import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ShieldCheck, Lock, Eye, AlertTriangle, ScanSearch, Globe } from "lucide-react";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security — LaunchReadyy" },
      {
        name: "description",
        content:
          "How LaunchReadyy keeps your data on your own machine — and what Production Security checks cover. Know before you ship.",
      },
    ],
  }),
  component: SecurityPage,
});

const POINTS = [
  {
    icon: <Lock className="h-4 w-4" />,
    title: "Encrypted at rest, on your own disk",
    body: "Data lives in a local SQLite file you control. Saved environment variables are encrypted at rest (AES-256-GCM) with a secret you generate; we never log raw secret values from findings.",
  },
  {
    icon: <Eye className="h-4 w-4" />,
    title: "Scoped GitHub access",
    body: "LaunchReadyy reads repos you connect and opens PRs on new branches only — never pushes to main. Your own personal access token, revocable from GitHub settings anytime.",
  },
  {
    icon: <ScanSearch className="h-4 w-4" />,
    title: "Production Security (product category)",
    body: "Repo scans surface secrets, env hygiene, unsafe APIs, middleware gaps, and pattern risks with evidence and confidence — advisory signals, not a pentest or compliance cert.",
  },
  {
    icon: <Globe className="h-4 w-4" />,
    title: "Live website scans",
    body: "Passive HTTP/HTTPS checks only after you prove domain ownership via a well-known verification file. Status codes and headers only — not secret file bodies, and never exploits.",
  },
  {
    icon: <ShieldCheck className="h-4 w-4" />,
    title: "No phone-home telemetry",
    body: "There's no LaunchReadyy server for data to reach. The only outbound traffic goes to the third-party providers you configure yourself — GitHub, and optionally E2B and an AI provider.",
  },
];

function SecurityPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 lg:gap-16 lg:items-start">
          <div className="lg:col-span-2 lg:sticky lg:top-24">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Trust &amp; product
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold leading-tight">
              Know before you ship
            </h1>
            <p className="text-muted-foreground mt-4 leading-relaxed text-sm">
              How LaunchReadyy keeps your data on your own machine — and what our Production
              Security category covers. Not a security company pitch; a readiness checklist with
              evidence.
            </p>
            <p className="text-muted-foreground mt-3 leading-relaxed text-sm">
              Details:{" "}
              <Link to="/privacy" className="text-primary hover:underline">
                Privacy
              </Link>
              {" · "}
              <Link to="/terms" className="text-primary hover:underline">
                Terms
              </Link>
              {" · "}
              <Link to="/docs" hash="capabilities" className="text-primary hover:underline">
                Docs
              </Link>
            </p>
            <div className="mt-8 pt-8 border-t border-border/60">
              <p className="text-sm font-medium mb-2">Found a vulnerability in LaunchReadyy?</p>
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                Please disclose responsibly. Email us directly — we respond within 48 hours.
              </p>
              <a
                href="mailto:launchreadyy@gmail.com?subject=Security Vulnerability Report"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Report a vulnerability
              </a>
              <p className="mt-2 text-xs text-muted-foreground">launchreadyy@gmail.com</p>
            </div>
          </div>

          <div className="lg:col-span-3 space-y-px">
            {POINTS.map((p, i) => (
              <div
                key={i}
                className="group flex gap-4 rounded-2xl border border-border bg-card p-6 hover:bg-muted/30 transition-colors"
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary mt-0.5">
                  {p.icon}
                </div>
                <div>
                  <p className="font-semibold text-sm mb-1.5">{p.title}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
