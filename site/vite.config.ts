import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Canonical and social-preview tags need an absolute origin, so the deployed origin is a build
 * setting (`VITE_SITE_URL`) rather than a constant in the source.
 *
 * The repository does not know its own domain, and a guessed one is worse than none: a wrong
 * canonical URL tells crawlers the real page lives elsewhere. When the variable is unset, the tags
 * that need an origin are removed from the shell instead of shipped pointing at a placeholder, and
 * the app omits them at runtime for the same reason.
 */
export default defineConfig(({ mode }) => {
  const siteUrl = (
    process.env.VITE_SITE_URL ??
    loadEnv(mode, process.cwd(), "VITE_").VITE_SITE_URL ??
    ""
  ).replace(/\/+$/, "");

  return {
    plugins: [
      react(),
      {
        name: "site-url-meta",
        transformIndexHtml(html) {
          if (siteUrl) return html.split("%SITE_URL%").join(siteUrl);
          return html.replace(/^.*%SITE_URL%.*$\n?/gm, "");
        },
      },
    ],
  };
});
