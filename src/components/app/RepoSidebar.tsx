import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  Gauge,
  TestTube2,
  KeyRound,
  Wrench,
  AlertTriangle,
  FileText,
  Layers,
  ShieldCheck,
  Clock,
  Menu,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { AppSidebarUser } from "./AppSidebar";
import { BrandMark } from "./BrandMark";
import { SidebarUserFooter } from "./SidebarUserFooter";

type RepoNavItem = {
  to: string;
  label: string;
  icon: typeof Gauge;
  exact?: boolean;
};

type RepoNavSection = {
  title: string;
  items: RepoNavItem[];
};

/** grouped nav — sandbox-first journey. */
export const REPO_NAV_SECTIONS: RepoNavSection[] = [
  {
    title: "Verify",
    items: [
      { to: "/repo/$repoId/sandbox", label: "Sandbox build", icon: TestTube2 },
      { to: "/repo/$repoId/runs", label: "Run history", icon: Clock },
      { to: "/repo/$repoId/env", label: "Build & environment", icon: KeyRound },
    ],
  },
  {
    title: "Verdict",
    items: [
      { to: "/repo/$repoId", label: "Production verdict", icon: Gauge, exact: true },
      { to: "/repo/$repoId/arch", label: "Architecture", icon: Layers },
      { to: "/repo/$repoId/live-security", label: "Live security", icon: ShieldCheck },
    ],
  },
  {
    title: "Fix",
    items: [
      { to: "/repo/$repoId/fix", label: "Fix PR", icon: Wrench },
      { to: "/repo/$repoId/blockers", label: "Blockers", icon: AlertTriangle },
    ],
  },
  {
    title: "Deliver",
    items: [{ to: "/repo/$repoId/report", label: "Launch report", icon: FileText }],
  },
];

export const REPO_TABS = REPO_NAV_SECTIONS.flatMap((s) => s.items);

function itemActive(path: string, href: string, exact?: boolean) {
  if (exact) return path === href;
  // Fix page + job detail share the Fix → Fix PR item
  if (href.endsWith("/fix") && path.includes("/job/")) return true;
  return path === href || path.startsWith(`${href}/`);
}

function NavBody({ repoId, path }: { repoId: string; path: string }) {
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-5">
      {REPO_NAV_SECTIONS.map((section, sectionIndex) => (
        <div key={section.title}>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
            <span className="mr-2 font-mono text-data">0{sectionIndex + 1}</span>
            {section.title}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const href = item.to.replace("$repoId", repoId);
              const active = itemActive(path, href, item.exact);
              const Icon = item.icon;
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  params={{ repoId }}
                  className={cn(
                    "relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-200",
                    active
                      ? "bg-data/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
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
}

export function RepoSidebar({
  user,
  repoId,
  repoName,
}: {
  user?: AppSidebarUser | null;
  repoId: string;
  repoName: string;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [path]);

  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const brandRow = (close?: ReactNode) => (
    <div className="flex h-16 shrink-0 items-center gap-1 border-b border-hairline px-5">
      <BrandMark />
      <div className="ml-auto flex shrink-0 items-center">{close}</div>
    </div>
  );

  const repoHeader = (
    <div className="shrink-0 border-b border-hairline px-5 py-4">
      <Link
        to="/repos"
        className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Repositories
      </Link>
      <p className="truncate text-sm font-semibold text-foreground" title={repoName}>
        {repoName}
      </p>
    </div>
  );

  const userFooter = user ? <SidebarUserFooter user={user} /> : null;

  return (
    <>
      <button
        type="button"
        className="print-hide absolute left-3 top-3 z-50 grid h-10 w-10 place-items-center rounded-full border border-hairline bg-surface text-foreground shadow-[var(--app-shadow)] lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open repository navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div className="print-hide fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(17rem,88vw)] flex-col border-r border-hairline bg-[var(--app-sidebar)] shadow-[var(--app-shadow-float)]">
            {brandRow(
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>,
            )}
            {repoHeader}
            <NavBody repoId={repoId} path={path} />
            {userFooter}
          </aside>
        </div>
      )}

      <aside className="print-hide hidden h-full min-h-0 w-60 shrink-0 flex-col border-r border-hairline bg-[var(--app-sidebar)] lg:flex">
        {brandRow()}
        {repoHeader}
        <NavBody repoId={repoId} path={path} />
        {userFooter}
      </aside>
    </>
  );
}
