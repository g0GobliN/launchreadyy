import { useEffect } from "react";
import { Layout } from "./components/layout";
import { NotFound } from "./pages/not-found";
import { ROUTES } from "./routes";
import { pageUrl } from "./lib/site";
import { useLocation } from "./lib/use-location";

const NOT_FOUND = {
  title: "Page not found — LaunchReadyy",
  description: "This LaunchReadyy page could not be found.",
};

/**
 * Point the per-page tags at the current route. The tags themselves live in index.html.
 *
 * Origin-dependent tags are only written when the site origin is configured at build time; without
 * it the build has already dropped them, so there is nothing here to correct.
 */
function applyMetadata(title: string, description: string, path: string) {
  document.title = title;

  const tags: [string, string][] = [
    ["meta[name='description']", description],
    ["meta[property='og:title']", title],
    ["meta[property='og:description']", description],
    ["meta[name='twitter:title']", title],
    ["meta[name='twitter:description']", description],
  ];

  const url = pageUrl(path);
  if (url) tags.push(["link[rel='canonical']", url], ["meta[property='og:url']", url]);

  for (const [selector, value] of tags) {
    const element = document.querySelector(selector);
    if (!element) continue;
    element.setAttribute(element.tagName === "LINK" ? "href" : "content", value);
  }
}

export function App() {
  const { path, hash } = useLocation();
  const route = ROUTES[path];

  useEffect(() => {
    applyMetadata(
      route?.title ?? NOT_FOUND.title,
      route?.description ?? NOT_FOUND.description,
      path,
    );
  }, [route, path]);

  // Scroll is owned here rather than by the link component, so back/forward restores the right
  // position too. A hash targets a section (`/docs#configuration`); without one the reader starts
  // at the top of the new page.
  useEffect(() => {
    const target = hash ? document.getElementById(hash) : null;
    if (target) target.scrollIntoView({ behavior: "instant", block: "start" });
    else window.scrollTo({ top: 0, behavior: "instant" });
  }, [path, hash]);

  return <Layout>{route ? route.render() : <NotFound />}</Layout>;
}
