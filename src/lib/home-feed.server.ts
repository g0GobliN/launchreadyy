import { getDataStore } from "./data-store.server";
import {
  DEFAULT_HOME_FEED,
  type ChangelogEntry,
  type HighlightEntry,
  type HomeFeed,
  type MarketingArticle,
} from "./home-feed";

type Row = {
  id: string;
  slug: string;
  section: string;
  title: string;
  date_label: string;
  category: string | null;
  author: string;
  read_time: string | null;
  image: string | null;
  body: string;
  sort_order: number;
};

function mapRow(r: Row): MarketingArticle {
  return {
    id: r.id,
    slug: r.slug,
    section: r.section === "highlight" ? "highlight" : "changelog",
    title: r.title,
    dateLabel: r.date_label,
    category: r.category,
    author: r.author,
    readTime: r.read_time,
    image: r.image,
    body: r.body,
    sortOrder: r.sort_order,
  };
}

export async function listPublishedArticles(): Promise<MarketingArticle[]> {
  const db = getDataStore();
  const { data, error } = await db
    .from("marketing_articles")
    .select(
      "id, slug, section, title, date_label, category, author, read_time, image, body, sort_order",
    )
    .eq("published", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[marketing_articles]", error.message);
    return [];
  }
  return (data as Row[] | null)?.map(mapRow) ?? [];
}

export async function getArticleBySlug(slug: string): Promise<MarketingArticle | null> {
  const db = getDataStore();
  const { data, error } = await db
    .from("marketing_articles")
    .select(
      "id, slug, section, title, date_label, category, author, read_time, image, body, sort_order",
    )
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  if (error) {
    console.error("[marketing_articles]", error.message);
    return null;
  }
  return data ? mapRow(data as Row) : null;
}

export async function getHomeFeed(): Promise<HomeFeed> {
  const articles = await listPublishedArticles();
  if (articles.length === 0) return DEFAULT_HOME_FEED;

  const changelogAll = articles
    .filter((a) => a.section === "changelog")
    .map((a) => ({
      slug: a.slug,
      date: a.dateLabel,
      title: a.title,
      href: `/blog/${a.slug}` as `/blog/${string}`,
    }));

  const highlightsAll = articles
    .filter((a) => a.section === "highlight")
    .map((a) => ({
      slug: a.slug,
      date: a.dateLabel,
      category: a.category ?? "Product",
      title: a.title,
      author: a.author,
      readTime: a.readTime ?? "3 min",
      image: a.image ?? "/marketing/blog-launch-week.jpg",
      href: `/blog/${a.slug}` as `/blog/${string}`,
    }));

  return {
    // Homepage teaser only — full archive lives on /changelog
    changelog: (changelogAll.length ? changelogAll : DEFAULT_HOME_FEED.changelog).slice(0, 5),
    highlights: (highlightsAll.length ? highlightsAll : DEFAULT_HOME_FEED.highlights).slice(0, 4),
  };
}

/** Full published lists for /changelog (no homepage teaser cap). */
export async function getChangelogArchive(): Promise<HomeFeed> {
  const articles = await listPublishedArticles();
  if (articles.length === 0) return DEFAULT_HOME_FEED;

  const changelog: ChangelogEntry[] = articles
    .filter((a) => a.section === "changelog")
    .map((a) => ({
      slug: a.slug,
      date: a.dateLabel,
      title: a.title,
      href: `/blog/${a.slug}` as `/blog/${string}`,
    }));

  const highlights: HighlightEntry[] = articles
    .filter((a) => a.section === "highlight")
    .map((a) => ({
      slug: a.slug,
      date: a.dateLabel,
      category: a.category ?? "Product",
      title: a.title,
      author: a.author,
      readTime: a.readTime ?? "3 min",
      image: a.image ?? "/marketing/blog-launch-week.jpg",
      href: `/blog/${a.slug}` as `/blog/${string}`,
    }));

  return {
    changelog: changelog.length ? changelog : DEFAULT_HOME_FEED.changelog,
    highlights: highlights.length ? highlights : DEFAULT_HOME_FEED.highlights,
  };
}
