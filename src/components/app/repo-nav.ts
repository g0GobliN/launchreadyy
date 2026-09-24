import {
  AlertTriangle,
  Clock,
  FileText,
  Gauge,
  KeyRound,
  Layers,
  ShieldCheck,
  TestTube2,
  Wrench,
} from "lucide-react";

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

/**
 * Grouped nav — sandbox-first journey.
 *
 * Lives apart from RepoSidebar because RepoLayout also needs the flattened tab list to decide
 * which tab is active: a module exporting both data and components defeats Fast Refresh.
 */
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
