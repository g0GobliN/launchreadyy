import type { ReactNode } from "react";
import { AppSidebar, type AppSidebarUser } from "@/components/app/AppSidebar";
import { HelpMain, HelpProvider } from "@/components/app/HelpCenter";
import type { BreadcrumbItem } from "@/components/app/TopNavigation";
import { ProductTopbar } from "@/components/app/ProductTopbar";
import { DashboardThemeBoundary } from "@/components/app/DashboardThemeBoundary";

export type { BreadcrumbItem };

export function AppLayout({
  user,
  breadcrumbs,
  actions,
  children,
  fullWidth,
}: {
  user?: AppSidebarUser | null;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  children: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <DashboardThemeBoundary>
      <HelpProvider>
        <div className="app-shell relative flex h-full min-h-0 flex-1 overflow-hidden">
          <AppSidebar user={user} />
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <ProductTopbar breadcrumbs={breadcrumbs} />
            <HelpMain contentClassName="pb-24 lg:pb-8">
              <div
                className={
                  fullWidth
                    ? "h-full px-4 py-5 sm:px-6 lg:px-8"
                    : "mx-auto w-full max-w-7xl px-5 py-8 sm:px-7 lg:py-9"
                }
              >
                {actions ? (
                  <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
                    {actions}
                  </div>
                ) : null}
                {children}
              </div>
            </HelpMain>
          </div>
        </div>
      </HelpProvider>
    </DashboardThemeBoundary>
  );
}
