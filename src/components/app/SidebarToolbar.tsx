import { ThemeToggle } from "@/components/theme-toggle";

/** Theme control next to the LaunchReadyy wordmark. Notifications live in the top-right cluster. */
export function SidebarToolbar() {
  return (
    <div className="flex shrink-0 items-center">
      <ThemeToggle />
    </div>
  );
}
