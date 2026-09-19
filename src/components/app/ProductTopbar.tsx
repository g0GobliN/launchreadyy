import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { HelpButton } from "./HelpCenter";
import { ThemeToggle } from "@/components/theme-toggle";
import type { BreadcrumbItem } from "./TopNavigation";

export function ProductTopbar({
  breadcrumbs = [],
  trailing,
}: {
  breadcrumbs?: BreadcrumbItem[];
  trailing?: ReactNode;
}) {
  return (
    <header className="app-glass sticky top-0 z-30 flex h-16 shrink-0 items-center border-b border-hairline pl-14 pr-3 sm:pr-5 lg:px-8">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link
          to="/dashboard"
          className="hidden text-muted-foreground transition hover:text-foreground sm:inline"
        >
          Workspace
        </Link>
        {breadcrumbs.map((crumb, index) => {
          const last = index === breadcrumbs.length - 1;
          return (
            <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/50 sm:block" />
              {crumb.to && !last ? (
                <Link
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- route targets vary
                  to={crumb.to as any}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- route params vary
                  params={crumb.params as any}
                  className="truncate text-muted-foreground transition hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate font-medium text-foreground">{crumb.label}</span>
              )}
            </span>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {trailing}
        <HelpButton />
        <ThemeToggle className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground" />
      </div>
    </header>
  );
}
