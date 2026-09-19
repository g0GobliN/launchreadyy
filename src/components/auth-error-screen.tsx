import { Link } from "@tanstack/react-router";
import { AlertTriangle, KeyRound, ShieldOff, type LucideIcon } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

type AuthErrorKind = "signin" | "denied" | "generic";

function classify(message: string): AuthErrorKind {
  if (message === "Not authenticated") return "signin";
  if (/not authorized|not found/i.test(message)) return "denied";
  return "generic";
}

const COPY: Record<AuthErrorKind, { icon: LucideIcon; heading: string; subtext: string }> = {
  signin: {
    icon: KeyRound,
    heading: "GitHub token required",
    subtext: "Set GITHUB_TOKEN in .env (or via launchreadyy config), then restart.",
  },
  denied: {
    icon: ShieldOff,
    heading: "You don't have access to this",
    subtext: "This page belongs to a different account, or doesn't exist.",
  },
  generic: {
    icon: AlertTriangle,
    heading: "Something went wrong",
    subtext: "Something broke on our end. Try refreshing or head back home.",
  },
};

/** Purpose-built fallback for the "Not authenticated" / "Not authorized for this X" errors
 * thrown by requireAuthUser()/assertRepoOwner() and friends — replaces a raw {error.message}
 * dump with a screen that actually tells the visitor what happened and what to do next. */
export function AuthErrorScreen({ error }: { error: Error }) {
  const kind = classify(error.message);
  const { icon: Icon, heading, subtext } = COPY[kind];

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto flex max-w-lg flex-col items-center px-6 pt-32 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 bg-muted/30">
          <Icon className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="mt-6 font-display text-2xl font-semibold">{heading}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtext}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {kind === "denied" && (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Back to Dashboard
            </Link>
          )}
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-5 py-2.5 text-sm font-medium hover:bg-muted"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
