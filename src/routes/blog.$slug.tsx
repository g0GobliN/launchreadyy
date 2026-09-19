import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { getBlogArticleFn } from "@/lib/api/home-feed.functions";
import { articleBodyToBlocks } from "@/lib/home-feed";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/blog/$slug")({
  loader: async ({ params }) => {
    const article = await getBlogArticleFn({ data: { slug: params.slug } });
    if (!article) throw notFound();
    return article;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData ? `${loaderData.title} — LaunchReadyy` : "Article — LaunchReadyy",
      },
      {
        name: "description",
        content: loaderData?.title ?? "LaunchReadyy update",
      },
    ],
  }),
  component: BlogArticlePage,
});

function BlogArticlePage() {
  const article = Route.useLoaderData();
  const blocks = articleBodyToBlocks(article.body);

  return (
    <div className="dark home-editorial min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <SiteHeader variant="editorial" />
      <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <Link
          to="/changelog"
          className="inline-flex items-center gap-1.5 text-sm text-white/45 transition hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to changelog
        </Link>

        <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.16em] text-white/35">
          {article.dateLabel}
          {article.category ? (
            <>
              <span className="mx-2 text-white/20">·</span>
              {article.category}
            </>
          ) : null}
        </p>
        <h1 className="mt-4 font-display text-3xl tracking-[-0.03em] text-white sm:text-4xl lg:text-5xl">
          {article.title}
        </h1>
        <p className="mt-4 text-sm text-white/40">
          {article.author}
          {article.readTime ? ` · ${article.readTime}` : ""}
        </p>

        {article.image ? (
          <div className="home-media-frame mt-10 overflow-hidden">
            <img src={article.image} alt="" className="aspect-[16/9] w-full object-cover" />
          </div>
        ) : null}

        <article className="mt-12 space-y-6">
          {blocks.map((b, i) => {
            if (b.type === "h2") {
              return (
                <h2
                  key={i}
                  className="pt-4 font-display text-xl tracking-[-0.02em] text-white sm:text-2xl"
                >
                  {b.text}
                </h2>
              );
            }
            if (b.type === "ul" || b.type === "ol") {
              return (
                <ul
                  key={i}
                  className="list-disc space-y-2 pl-5 text-base leading-relaxed text-white/65"
                >
                  {b.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              );
            }
            if (b.type === "p" || b.type === "h3" || b.type === "note") {
              return (
                <p key={i} className="text-base leading-relaxed text-white/65">
                  {b.text}
                </p>
              );
            }
            return null;
          })}
        </article>

        <div className="mt-16 border-t border-white/[0.08] pt-8">
          <Link
            to="/dashboard"
            className="inline-flex h-11 items-center rounded-full bg-white px-5 text-sm font-medium text-black transition hover:bg-white/90"
          >
            Connect GitHub
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
