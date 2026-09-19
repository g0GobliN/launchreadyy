import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getSessionUserFn } from "@/lib/api/session.functions";
import { Settings, Menu, X, LayoutGrid, BookOpen, Github, Compass, Activity } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandWordmark } from "@/components/brand-wordmark";
import { useState, useEffect } from "react";

interface SiteHeaderProps {
  user?: { login: string; avatarUrl: string } | null;
  /** Cursor-like minimal marketing chrome (home). */
  variant?: "default" | "editorial";
}

export function SiteHeader({ user: userProp, variant = "default" }: SiteHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: sessionUser } = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUserFn(),
    staleTime: Infinity,
  });
  const user = userProp ?? sessionUser;
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Marketing pages (/docs, /faq, …) always keep the public nav — even when signed in.
  // App chrome only when authenticated on an in-app path (avoids "Loading…" / empty mobile menu for guests).
  const isApp =
    !!user &&
    (path.startsWith("/dashboard") ||
      path.startsWith("/repo") ||
      path.startsWith("/pr") ||
      path.startsWith("/settings") ||
      path.startsWith("/jobs"));

  const closeMobileMenu = () => setMobileMenuOpen(false);

  // Close drawer on route change
  useEffect(() => {
    closeMobileMenu();
  }, [path]);

  // Prevent body scroll when drawer open
  useEffect(() => {
    if (mobileMenuOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  const isEditorial = variant === "editorial";

  return (
    <>
      <header
        className={
          isEditorial
            ? "sticky top-0 z-40 border-b border-white/[0.06] bg-black/50 backdrop-blur-xl"
            : "sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl"
        }
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/"
            className={
              isEditorial
                ? "shrink-0 font-display text-[15px] font-semibold text-white sm:text-lg"
                : "shrink-0 font-display text-[15px] font-semibold sm:text-lg"
            }
          >
            <BrandWordmark size="nav" className={isEditorial ? "text-white" : undefined} />
          </Link>

          {!isApp ? (
            <nav
              className={
                isEditorial
                  ? "hidden items-center gap-7 text-sm text-white/50 md:flex"
                  : "hidden items-center gap-7 text-sm text-muted-foreground md:flex"
              }
            >
              <Link
                to="/workflow"
                className={isEditorial ? "hover:text-white" : "hover:text-foreground"}
                activeProps={{ className: isEditorial ? "text-white" : "text-foreground" }}
              >
                Product
              </Link>
              <Link
                to="/changelog"
                className={isEditorial ? "hover:text-white" : "hover:text-foreground"}
                activeProps={{ className: isEditorial ? "text-white" : "text-foreground" }}
              >
                Changelog
              </Link>
              <Link
                to="/docs"
                className={isEditorial ? "hover:text-white" : "hover:text-foreground"}
                activeProps={{ className: isEditorial ? "text-white" : "text-foreground" }}
              >
                Docs
              </Link>
            </nav>
          ) : (
            <nav className="hidden sm:flex items-center gap-5 text-sm text-muted-foreground">
              <Link
                to="/dashboard"
                className="hover:text-foreground transition"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                Dashboard
              </Link>
            </nav>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {!isApp ? (
              <div className="flex items-center gap-2">
                {!isEditorial && <ThemeToggle />}
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen((o) => !o)}
                  className={
                    isEditorial
                      ? "md:hidden grid h-8 w-8 place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white transition"
                      : "md:hidden grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition"
                  }
                  aria-label="Toggle menu"
                >
                  {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                </button>
                <Link
                  to="/dashboard"
                  className={
                    isEditorial
                      ? "hidden md:inline-flex rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-black transition hover:bg-white/90"
                      : "hidden md:inline-flex rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                  }
                >
                  {user ? "Dashboard" : "Dashboard"}
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <ThemeToggle />
                {user && (
                  <Link
                    to="/settings"
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:bg-muted transition"
                  >
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt={user.login} className="h-5 w-5 rounded-full" />
                    ) : (
                      <span className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-[10px]">
                        {user.login[0].toUpperCase()}
                      </span>
                    )}
                    <span className="hidden sm:inline text-muted-foreground">@{user.login}</span>
                  </Link>
                )}
                {/* Hamburger — app, mobile only */}
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen((o) => !o)}
                  className="sm:hidden grid h-7 w-7 place-items-center rounded-md border border-border bg-surface hover:bg-muted transition"
                  aria-label="Toggle menu"
                >
                  <Menu className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Side drawer — marketing ── */}
      {!isApp && (
        <>
          {/* Backdrop */}
          <div
            className={`fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
              mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
            onClick={closeMobileMenu}
          />
          {/* Panel */}
          <div
            className={`fixed top-0 right-0 z-50 flex h-full w-[min(288px,85vw)] flex-col border-l shadow-2xl transition-transform duration-300 ease-in-out md:hidden ${
              isEditorial ? "border-white/10 bg-[#0a0a0b]" : "border-border bg-background"
            } ${mobileMenuOpen ? "translate-x-0" : "translate-x-full"}`}
          >
            <div
              className={`flex h-14 shrink-0 items-center justify-between border-b px-5 ${
                isEditorial ? "border-white/10" : "border-border/60"
              }`}
            >
              <span
                className={`font-display text-sm font-semibold ${isEditorial ? "text-white" : ""}`}
              >
                Menu
              </span>
              <button
                onClick={closeMobileMenu}
                className={`grid h-7 w-7 place-items-center rounded-md transition ${
                  isEditorial
                    ? "text-white/50 hover:bg-white/10 hover:text-white"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex shrink-0 flex-col gap-1 px-3 py-3">
              {[
                {
                  to: "/workflow",
                  label: isEditorial ? "Product" : "How it works",
                  icon: <LayoutGrid className="h-4 w-4" />,
                },
                { to: "/docs", label: "Docs", icon: <BookOpen className="h-4 w-4" /> },
              ].map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={closeMobileMenu}
                  className={
                    isEditorial
                      ? "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/55 transition hover:bg-white/5 hover:text-white"
                      : "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  }
                  activeProps={{
                    className: isEditorial
                      ? "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white bg-white/10"
                      : "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm bg-muted text-foreground font-medium",
                  }}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </nav>
            <div
              className={`flex flex-1 flex-col justify-end px-4 pb-5 pt-6 ${
                isEditorial ? "bg-white/[0.03]" : "bg-muted/20"
              }`}
            >
              {" "}
              {user ? (
                <Link
                  to="/dashboard"
                  onClick={closeMobileMenu}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 transition hover:bg-muted"
                >
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.login} className="h-10 w-10 rounded-full" />
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/20 text-primary font-bold text-sm">
                      {user.login[0].toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Welcome back</p>
                    <p className="truncate text-sm font-semibold text-foreground">@{user.login}</p>
                  </div>
                </Link>
              ) : (
                <div className="flex flex-col gap-2">
                  <Link
                    to="/dashboard"
                    onClick={closeMobileMenu}
                    className={
                      isEditorial
                        ? "inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-white/90"
                        : "inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                    }
                  >
                    <Github className="h-4 w-4" />
                    Dashboard
                  </Link>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Side drawer — app ── */}
      {isApp && (
        <>
          {/* Backdrop */}
          <div
            className={`fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-300 sm:hidden ${
              mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
            onClick={closeMobileMenu}
          />
          {/* Panel */}
          <div
            className={`fixed top-0 right-0 z-50 flex h-full w-[min(288px,85vw)] flex-col bg-background border-l border-border shadow-2xl transition-transform duration-300 ease-in-out sm:hidden ${
              mobileMenuOpen ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-5">
              <span className="font-display font-semibold text-sm">Navigation</span>
              <button
                onClick={closeMobileMenu}
                className="grid h-7 w-7 place-items-center rounded-md hover:bg-muted transition text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex shrink-0 flex-col gap-1 px-3 py-3">
              <Link
                to="/dashboard"
                onClick={closeMobileMenu}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition"
                activeProps={{
                  className:
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm bg-muted text-foreground font-medium",
                }}
              >
                <LayoutGrid className="h-4 w-4" />
                Dashboard
              </Link>

              <Link
                to="/settings"
                onClick={closeMobileMenu}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition"
                activeProps={{
                  className:
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm bg-muted text-foreground font-medium",
                }}
              >
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </nav>
            <div className="border-t border-border/60 px-3 py-3">
              <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                Resources
              </p>
              <nav className="flex flex-col gap-1">
                <Link
                  to="/workflow"
                  onClick={closeMobileMenu}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition"
                >
                  <Compass className="h-4 w-4" />
                  How it works
                </Link>
                <Link
                  to="/docs"
                  onClick={closeMobileMenu}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition"
                >
                  <BookOpen className="h-4 w-4" />
                  Docs
                </Link>
              </nav>
            </div>
            {user && (
              <div className="flex flex-1 flex-col justify-end bg-muted/20 px-4 pb-5 pt-6">
                <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.login} className="h-10 w-10 rounded-full" />
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/20 text-primary font-bold text-sm">
                      {user.login[0].toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Local operator</p>
                    <p className="truncate text-sm font-semibold text-foreground">@{user.login}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
