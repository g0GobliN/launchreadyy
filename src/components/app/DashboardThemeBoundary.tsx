import { useEffect, type ReactNode } from "react";

/**
 * Gives the authenticated product its own visual system. The body class is
 * intentional: dialogs, dropdowns and popovers are portalled outside the shell.
 */
export function DashboardThemeBoundary({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add("dashboard-theme");
    return () => document.body.classList.remove("dashboard-theme");
  }, []);

  return children;
}
