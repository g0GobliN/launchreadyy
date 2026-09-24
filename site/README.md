# LaunchReadyy public site

The standalone informational website for LaunchReadyy Community: what the product is, how to
install it, and where the project stands on license, privacy, and security.

It is a static React/Vite app. It does not import or deploy the root Community server, worker,
scheduler, credentials, or SQLite data, and it runs no scans. Everything it says about the product
is a summary of the repository README and `docs/`; when those change, this site follows.

## Commands

```bash
npm install
npm run dev      # Vite dev server
npm run build    # tsc --noEmit -p tsconfig.app.json, then vite build
npm run preview  # serve the production build locally
```

## Layout

| Path              | What lives there                                                           |
| ----------------- | -------------------------------------------------------------------------- |
| `src/App.tsx`     | Router shell: route lookup, page metadata, scroll restoration              |
| `src/routes.tsx`  | The route table — path to component, title, and meta description           |
| `src/pages/`      | One module per page                                                        |
| `src/components/` | Layout, page shell, link, command block, and the `/docs` building blocks   |
| `src/lib/`        | Site constants, the docs table of contents, and the location/scroll hooks  |
| `src/styles.css`  | All styling; design tokens are the custom properties at the top            |
| `public/`         | Logos, screenshots, `robots.txt`, and `.well-known/security.txt`           |
| `index.html`      | Static shell: fonts, favicon, and the social-preview tags the router edits |

## Routing

There is no router dependency. `vercel.json` rewrites every path to `index.html`, and
`src/routes.tsx` maps the pathname to a page. Adding a page means adding a module under
`src/pages/`, an entry in `src/routes.tsx`, and a link wherever it belongs in the header or footer.

Links between pages go through `src/components/link.tsx`, which pushes history and re-renders
instead of reloading. In-page anchors are left to the browser.

## Documentation page

`/docs` is the exception to the two-column prose layout used by the narrative pages: it renders a
sticky table of contents beside one reading column, because tables and command blocks stop being
readable when split.

The table of contents is `DOCS_SECTIONS` in `src/lib/docs-sections.ts`. Each `id` there must match
a `DocsSection` id in `src/pages/docs.tsx` — the sidebar links and the active-section observer both
read that list, so a mismatch shows up as an entry that scrolls nowhere. Add a section in both
places, in reading order.

Content rules for that page: state what an operator can actually do, prefer the repository name for
anything version-specific, and link into the repository docs rather than restating them. Anything
that turns into a claim about behavior should be checkable in the root README, `.env.example`, or
`docs/`.

## Star button

`src/components/star-button.tsx` is the call to action in the header — one place, so the hero stays
focused on the two things a first-time reader needs (view the source, read the install steps). It asks the
public GitHub API (`api.github.com/repos/g0GobliN/launchreadyy`, no token) for
`stargazers_count` and renders the number beside the star.

Rules worth keeping:

- The button is a link first. If the request fails — rate limited, offline, blocked — it renders
  with no number instead of a zero it cannot confirm, and a stale cached count is preferred to an
  empty one.
- An answer of zero is left off deliberately, so a new repository is not advertised as an empty
  counter. Change the `stars > 0` condition in that component to show it.
- Responses are cached in `localStorage` for an hour. Anonymous GitHub API access is limited to 60
  requests per hour per IP, and a shared network can exhaust that on its own.
- The request comes from the visitor's browser, which is why `/privacy` names it. Keep that page
  in step if this ever moves server-side.

## Build settings

| Setting         | Purpose                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `VITE_SITE_URL` | The origin the site is served from, without a trailing slash. See below. |

`VITE_SITE_URL` fills the canonical, `og:url`, `og:image`, and `twitter:image` tags. The repository
cannot know its own domain, and a guessed origin is worse than none — a wrong canonical URL tells
crawlers the real page lives elsewhere. So when the variable is unset the build **removes** those
tags instead of shipping a placeholder, and the router omits them at runtime for the same reason.
Set it before the production build and rebuild (it is read at build time, not at runtime).

The repository's GitHub homepage field currently points at `https://launchreadyy.vercel.app/`, so
that is the origin to set until a custom domain is attached.

## Deployment

On Vercel, set the project root directory to `site`, the build command to `npm run build`, the
output directory to `dist`, and `VITE_SITE_URL` in the project's environment variables. The
`rewrites` in `vercel.json` send unknown paths to the app so history-based navigation works on a
direct hit.

## License

The site ships from the same repository as the product and is covered by the same Apache-2.0
license; the project name and logos are governed separately by
[`TRADEMARKS.md`](../TRADEMARKS.md). The `/license` page states both for readers who arrive here
first.
