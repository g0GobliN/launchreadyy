import { createFileRoute } from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import {
  HomeHero,
  HomeTrust,
  HomeFeatures,
  HomeIntegrate,
  HomeChecks,
  HomeFrontier,
  HomeChangelog,
  HomeHighlights,
  HomeCta,
} from "@/components/marketing/home";
import { getHomeFeedFn } from "@/lib/api/home-feed.functions";
import { DEFAULT_HOME_FEED } from "@/lib/home-feed";

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      return await getHomeFeedFn();
    } catch {
      return DEFAULT_HOME_FEED;
    }
  },
  head: () => ({
    meta: [
      { title: "LaunchReadyy — Know before you ship" },
      {
        name: "description",
        content:
          "Production readiness for any software repository — sandbox verify, evidence-backed findings, and one-click fix PRs.",
      },
      {
        property: "og:title",
        content: "LaunchReadyy — Know before you ship",
      },
      {
        property: "og:description",
        content:
          "Sandbox-verified readiness and Production Security with one-click fix PRs. Know before you ship.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const feed = Route.useLoaderData();

  return (
    <MotionConfig reducedMotion="user">
      <div className="dark home-editorial min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <SiteHeader variant="editorial" />
        <main>
          <HomeHero />
          <HomeTrust />
          <HomeFeatures />
          <HomeIntegrate />
          <HomeChecks />
          <HomeFrontier />
          <HomeChangelog entries={feed.changelog} />
          <HomeHighlights entries={feed.highlights} />
          <HomeCta />
        </main>
        <SiteFooter />
      </div>
    </MotionConfig>
  );
}
