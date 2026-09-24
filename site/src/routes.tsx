import type { ReactNode } from "react";
import { About } from "./pages/about";
import { Contact } from "./pages/contact";
import { Docs } from "./pages/docs";
import { Home } from "./pages/home";
import { License } from "./pages/license";
import { Privacy } from "./pages/privacy";
import { Security } from "./pages/security";
import { Terms } from "./pages/terms";

export type Route = {
  /** Browser tab title. */
  title: string;
  /** Meta description, also used for social previews. */
  description: string;
  render: () => ReactNode;
};

/**
 * Every page the static site serves, keyed by path.
 *
 * Navigation is history-based rather than a router dependency: `vercel.json` rewrites all paths to
 * `index.html`, and the lookup here is the only place a URL becomes a page. There is no route
 * nesting, no parameters, and no data loading, so the smallest thing that works is a plain map.
 */
export const ROUTES: Record<string, Route> = {
  "/": {
    title: "LaunchReadyy Community — Know before you ship",
    description:
      "Open-source, self-hosted production-readiness and verification for software repositories.",
    render: Home,
  },
  "/docs": {
    title: "Documentation — LaunchReadyy",
    description:
      "Install, configure, and operate LaunchReadyy Community on infrastructure you control.",
    render: Docs,
  },
  "/about": {
    title: "About — LaunchReadyy",
    description: "About LaunchReadyy Community and its self-hosted architecture.",
    render: About,
  },
  "/privacy": {
    title: "Privacy — LaunchReadyy",
    description: "How data is handled by self-hosted LaunchReadyy Community installations.",
    render: Privacy,
  },
  "/terms": {
    title: "Terms — LaunchReadyy",
    description: "Terms for the LaunchReadyy Community project.",
    render: Terms,
  },
  "/security": {
    title: "Security — LaunchReadyy",
    description: "Report security vulnerabilities in LaunchReadyy Community.",
    render: Security,
  },
  "/license": {
    title: "License — LaunchReadyy",
    description:
      "LaunchReadyy Community licensing: Apache-2.0 for the code, separate terms for the name and logos.",
    render: License,
  },
  "/contact": {
    title: "Contact — LaunchReadyy",
    description: "Contact the LaunchReadyy Community project.",
    render: Contact,
  },
};
