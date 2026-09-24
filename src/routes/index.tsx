import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/` is the app, not a brochure.
 *
 * This route used to render a marketing homepage — hero, trust badges, feature grid, changelog
 * feed. Anyone who reaches a self-hosted install has already installed it, so the page they want
 * is the dashboard, which on a fresh install is exactly where the "set your GitHub token"
 * onboarding lives. The marketing site is a separate deployment (`site/`), so nothing is lost by
 * sending visitors straight through.
 *
 * A redirect rather than rendering the dashboard here on purpose: two URLs for the same screen
 * would give it two canonical addresses for no benefit.
 */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
