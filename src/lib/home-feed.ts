/**
 * Homepage changelog + highlights backed by marketing_articles rows.
 * Each item links to /blog/$slug (article body in DB).
 */

export type ArticleSection = "changelog" | "highlight";

export type MarketingArticle = {
  id: string;
  slug: string;
  section: ArticleSection;
  title: string;
  dateLabel: string;
  category: string | null;
  author: string;
  readTime: string | null;
  image: string | null;
  body: string;
  sortOrder: number;
};

export type ChangelogEntry = {
  slug: string;
  date: string;
  title: string;
  href: `/blog/${string}`;
};

export type HighlightEntry = {
  slug: string;
  date: string;
  category: string;
  title: string;
  author: string;
  readTime: string;
  image: string;
  href: `/blog/${string}`;
};

export type HomeFeed = {
  changelog: ChangelogEntry[];
  highlights: HighlightEntry[];
};

/** Blog-only conceptual images — do not reuse homepage gen-* product shots. */
export const HOME_IMAGE_PRESETS = [
  {
    id: "blog-sandbox-verify",
    label: "Terminal cursor",
    path: "/marketing/blog-sandbox-verify.jpg",
  },
  {
    id: "blog-sandbox-concurrency",
    label: "Concurrency slots",
    path: "/marketing/blog-sandbox-concurrency.jpg",
  },
  {
    id: "blog-production-security",
    label: "Padlock",
    path: "/marketing/blog-production-security.jpg",
  },
  { id: "blog-fix-prs", label: "Paper plane", path: "/marketing/blog-fix-prs.jpg" },
  {
    id: "blog-why-sandbox-score",
    label: "Score dial",
    path: "/marketing/blog-why-sandbox-score.jpg",
  },
  {
    id: "blog-security-evidence",
    label: "Magnifier",
    path: "/marketing/blog-security-evidence.jpg",
  },
  { id: "blog-one-pr", label: "Branch merge", path: "/marketing/blog-one-pr.jpg" },
  { id: "blog-launch-week", label: "Checklist", path: "/marketing/blog-launch-week.jpg" },
] as const;

/** Fallback when DB table is empty / missing (pre-migration). */
export const DEFAULT_HOME_FEED: HomeFeed = {
  changelog: [
    {
      slug: "sandbox-verify",
      date: "Aug 6, 2026",
      title: "Sandbox verify: install, build, lint before you trust the score",
      href: "/blog/sandbox-verify",
    },
    {
      slug: "sandbox-concurrency",
      date: "Aug 3, 2026",
      title: "Sandbox concurrency, tuned for a single machine",
      href: "/blog/sandbox-concurrency",
    },
    {
      slug: "production-security",
      date: "Jul 28, 2026",
      title: "Production Security findings with file evidence",
      href: "/blog/production-security",
    },
    {
      slug: "fix-prs",
      date: "Jul 22, 2026",
      title: "One-click fix PRs for CI, env, Docker, and tests",
      href: "/blog/fix-prs",
    },
  ],
  highlights: [
    {
      slug: "why-sandbox-score",
      date: "Aug 6, 2026",
      category: "Product",
      title: "Sandbox verify is why the score means something",
      author: "LaunchReadyy",
      readTime: "5 min",
      image: "/marketing/blog-why-sandbox-score.jpg",
      href: "/blog/why-sandbox-score",
    },
    {
      slug: "security-with-evidence",
      date: "Jul 20, 2026",
      category: "Security",
      title: "Production Security — evidence, not a scanner dump",
      author: "LaunchReadyy",
      readTime: "4 min",
      image: "/marketing/blog-security-evidence.jpg",
      href: "/blog/security-with-evidence",
    },
    {
      slug: "one-pr-readiness",
      date: "Jul 8, 2026",
      category: "Product",
      title: "One pull request that closes readiness gaps",
      author: "LaunchReadyy",
      readTime: "3 min",
      image: "/marketing/blog-one-pr.jpg",
      href: "/blog/one-pr-readiness",
    },
    {
      slug: "launch-week-checklist",
      date: "Jun 29, 2026",
      category: "Guide",
      title: "Know before you ship — launch week with LaunchReadyy",
      author: "LaunchReadyy",
      readTime: "6 min",
      image: "/marketing/blog-launch-week.jpg",
      href: "/blog/launch-week-checklist",
    },
  ],
};

export type ChartBar = { label: string; value: number; note?: string };

export type ArticleBlock =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "image"; src: string; alt: string; caption?: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "code"; lang: string | null; code: string }
  | { type: "note"; text: string }
  | { type: "chart"; title: string; unit: string | null; bars: ChartBar[] }
  | { type: "diagram"; id: string; caption?: string };

/**
 * Markdown-lite → blocks, for article bodies stored as plain text in the DB.
 *
 * Beyond `##`/`###`, paragraphs and lists it understands four fenced directives so a post
 * can carry evidence inline rather than linking out to an image someone has to trust:
 *
 *   ```lang … ```            code block
 *   :::note … :::            callout
 *   :::chart Title (unit)    bar chart; body lines are `label | value | optional note`
 *   :::diagram <id>          named inline SVG (see DIAGRAMS in the blog route)
 *
 * Charts are data, not pictures — the numbers live in the body text, so a chart can never
 * drift from the figure it illustrates the way an exported PNG does.
 */
export function articleBodyToBlocks(body: string): ArticleBlock[] {
  const lines = body.replace(/\r\n/g, "\n").trim().split("\n");
  const blocks: ArticleBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let listOrdered = false;
  let table: string[][] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ").trim() });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: listOrdered ? "ol" : "ul", items: [...list] });
    list = [];
  };
  // A markdown table's second row is the `---|---` separator, not data.
  const flushTable = () => {
    if (table.length) {
      const [head, ...rest] = table;
      const rows = rest.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c.trim())));
      blocks.push({ type: "table", head: head!, rows });
    }
    table = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushTable();
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const t = raw.trim();

    if (!t) {
      flushAll();
      continue;
    }

    if (t.startsWith("```")) {
      flushAll();
      const lang = t.slice(3).trim() || null;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) buf.push(lines[i++]!);
      blocks.push({ type: "code", lang, code: buf.join("\n") });
      continue;
    }

    if (t.startsWith(":::")) {
      flushAll();
      const header = t.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== ":::") buf.push(lines[i++]!);

      if (/^note\b/i.test(header)) {
        blocks.push({ type: "note", text: buf.join(" ").trim() });
      } else if (/^chart\b/i.test(header)) {
        const title = header.replace(/^chart\s*/i, "").trim();
        const unitMatch = title.match(/\(([^)]+)\)\s*$/);
        const bars = buf
          .map((l) => l.split("|").map((c) => c.trim()))
          .filter((c) => c.length >= 2 && c[0])
          .map(([label, value, note]) => ({
            label: label!,
            value: Number(value),
            ...(note ? { note } : {}),
          }))
          .filter((b) => Number.isFinite(b.value));
        blocks.push({
          type: "chart",
          title: unitMatch ? title.replace(/\s*\([^)]+\)\s*$/, "") : title,
          unit: unitMatch ? unitMatch[1]! : null,
          bars,
        });
      } else if (/^diagram\b/i.test(header)) {
        const id = header.replace(/^diagram\s*/i, "").trim();
        const caption = buf.join(" ").trim();
        blocks.push({ type: "diagram", id, ...(caption ? { caption } : {}) });
      }
      continue;
    }

    const image = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*(.*)$/);
    if (image) {
      flushAll();
      blocks.push({
        type: "image",
        alt: image[1] ?? "",
        src: image[2]!,
        ...(image[3] ? { caption: image[3] } : {}),
      });
      continue;
    }

    if (t.startsWith("| ") || (t.startsWith("|") && t.endsWith("|"))) {
      flushPara();
      flushList();
      table.push(
        t
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim()),
      );
      continue;
    }

    if (t.startsWith("### ")) {
      flushAll();
      blocks.push({ type: "h3", text: t.slice(4).trim() });
      continue;
    }
    if (t.startsWith("## ")) {
      flushAll();
      blocks.push({ type: "h2", text: t.slice(3).trim() });
      continue;
    }

    const ordered = t.match(/^(\d+)\.\s+(.*)$/);
    if (ordered) {
      flushPara();
      flushTable();
      if (list.length && !listOrdered) flushList();
      listOrdered = true;
      list.push(ordered[2]!.trim());
      continue;
    }
    if (t.startsWith("- ")) {
      flushPara();
      flushTable();
      if (list.length && listOrdered) flushList();
      listOrdered = false;
      list.push(t.slice(2).trim());
      continue;
    }

    flushList();
    flushTable();
    para.push(t);
  }

  flushAll();
  return blocks;
}
