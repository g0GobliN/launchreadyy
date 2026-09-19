import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  GitBranch,
  ScanSearch,
  FileText,
  Wrench,
  Settings,
  User,
  Menu,
  X,
  MoreHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { BrandMark } from "./BrandMark";
import { SidebarUserFooter } from "./SidebarUserFooter";

export type AppSidebarUser = {
  login: string;
  avatarUrl: string;
};

const SECTIONS = [
  {
    title: "Workspace",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/repos", label: "Repositories", icon: GitBranch },
      { to: "/scans", label: "Scans", icon: ScanSearch },
    ],
  },
  {
    title: "Ship",
    items: [
      { to: "/jobs", label: "Fixes", icon: Wrench },
      { to: "/reports", label: "Reports", icon: FileText },
    ],
  },
  {
    title: "Account",
    items: [{ to: "/settings", label: "Settings", icon: Settings }],
  },
] as const;

const MOBILE_PRIMARY = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard, exact: true },
  { to: "/repos", label: "Repos", icon: GitBranch },
  { to: "/scans", label: "Scans", icon: ScanSearch },
  { to: "/jobs", label: "Fixes", icon: Wrench },
] as const;

export function AppSidebar({ user }: { user?: AppSidebarUser | null }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const hash = useRouterState({ select: (s) => s.location.hash.replace(/^#/, "") });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [path, hash]);

  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const isActive = (to: string, exact?: boolean) => {
    if (exact) return path === to;
    if (to === "/repos") return path === "/repos" || path.startsWith("/repo/");
    return path === to || path.startsWith(`${to}/`);
  };

  const nav = (
    <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-5">
      {SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
            {section.title}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.to, "exact" in item ? item.exact : false);
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  className={cn(
                    "relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-200",
                    active
                      ? "bg-data/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", active ? "text-data" : "text-current")} />
                  {item.label}
                  {active ? (
                    <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-data" />
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const userFooter = user ? <SidebarUserFooter user={user} /> : null;

  return (
    <>
      <button
        type="button"
        className="absolute left-3 top-3 z-50 grid h-10 w-10 place-items-center rounded-full border border-hairline bg-surface text-foreground shadow-[var(--app-shadow)] lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(17rem,88vw)] flex-col border-r border-hairline bg-[var(--app-sidebar)] shadow-[var(--app-shadow-float)]">
            <div className="flex h-16 shrink-0 items-center gap-1 border-b border-hairline px-5">
              <BrandMark />
              <div className="ml-auto flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {nav}
            {userFooter}
          </aside>
        </div>
      )}

      <aside className="hidden h-full min-h-0 w-60 shrink-0 flex-col border-r border-hairline bg-[var(--app-sidebar)] lg:flex">
        <div className="flex h-16 shrink-0 items-center gap-1 border-b border-hairline px-5">
          <BrandMark />
        </div>
        {nav}
        {userFooter}
      </aside>

      <nav className="app-glass fixed inset-x-0 bottom-0 z-40 border-t border-hairline pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="grid h-16 grid-cols-5 px-2">
          {MOBILE_PRIMARY.map((item) => {
            const active = isActive(item.to, "exact" in item ? item.exact : false);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
                  active ? "text-data" : "text-muted-foreground",
                )}
              >
                <Icon className="h-4.5 w-4.5" />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground"
          >
            <MoreHorizontal className="h-4.5 w-4.5" />
            More
          </button>
        </div>
      </nav>
    </>
  );
}
