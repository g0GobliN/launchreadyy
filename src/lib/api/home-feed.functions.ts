import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getHomeFeedFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getHomeFeed } = await import("../home-feed.server");
  return getHomeFeed();
});

export const getChangelogArchiveFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getChangelogArchive } = await import("../home-feed.server");
  return getChangelogArchive();
});

export const getBlogArticleFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ slug: z.string().min(1).max(120) }))
  .handler(async ({ data }) => {
    const { getArticleBySlug } = await import("../home-feed.server");
    return getArticleBySlug(data.slug);
  });
