import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import type { AppSidebarUser } from "@/components/app/AppSidebar";
import { HelpMain, HelpProvider } from "@/components/app/HelpCenter";
import { RepoSidebar } from "@/components/app/RepoSidebar";
import { REPO_TABS } from "@/components/app/repo-nav";
import { ProductTopbar } from "@/components/app/ProductTopbar";
import { DashboardThemeBoundary } from "@/components/app/DashboardThemeBoundary";

/**
 * Full available width, matching AppLayout so the content edge doesn't shift between tabs.
 * Readability is protected where it actually matters — the finding paragraphs carry their own
 * `max-w-[85ch]` measure — rather than by holding the whole page narrow.
 */
const CONTENT_WIDTH = "mx-auto w-full";

export function RepoLayout({
  user,
  repoId,
  repoName,
  actions,
  fullWidth,
  children,
}: {
  user?: AppSidebarUser | null;
  repoId: string;
  repoName: string;
  actions?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const activePage = REPO_TABS.find((item) => {
    const href = item.to.replace("$repoId", repoId);
    if (item.exact) return pathname === href;
    if (href.endsWith("/fix") && pathname.includes("/job/")) return true;
    return pathname === href || pathname.startsWith(`${href}/`);
  });

  return (
    <DashboardThemeBoundary>
      <HelpProvider>
        <div className="app-shell relative flex h-full min-h-0 flex-1 overflow-hidden">
          <RepoSidebar user={user} repoId={repoId} repoName={repoName} />
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <ProductTopbar
              breadcrumbs={[
                { label: "Repositories", to: "/repos" },
                { label: repoName },
                ...(activePage ? [{ label: activePage.label }] : []),
              ]}
            />
            <HelpMain contentClassName={fullWidth ? "h-full" : "pb-8"}>
              {fullWidth ? (
                <div className="flex h-full min-h-0 flex-col">
                  {actions ? (
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-hairline px-4 py-3 sm:px-6 lg:px-8">
                      {actions}
                    </div>
                  ) : null}
                  <div className="min-h-0 flex-1">{children}</div>
                </div>
              ) : (
                <div className={`${CONTENT_WIDTH} max-w-7xl px-5 py-8 sm:px-7 lg:py-9`}>
                  {actions ? (
                    <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
                      {actions}
                    </div>
                  ) : null}
                  {children}
                </div>
              )}
            </HelpMain>
          </div>
        </div>
      </HelpProvider>
    </DashboardThemeBoundary>
  );
}
