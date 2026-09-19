import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Home, RefreshCw } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { getSiteConfigFn } from "../lib/api/site-config.functions";
import { DEFAULT_STATUS_BANNER_MESSAGE } from "../lib/status-banner";

// Tracks pointer position within the section as a -0.5..0.5 offset, used to
// drive a subtle parallax on the background glow/grid.
function useParallax() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({
      x: (e.clientX - rect.left) / rect.width - 0.5,
      y: (e.clientY - rect.top) / rect.height - 0.5,
    });
  }
  function onMouseLeave() {
    setPos({ x: 0, y: 0 });
  }
  return { pos, onMouseMove, onMouseLeave };
}

// Animates 1 (full ring) down to `target` on mount, eased — drives the
// 404 ring's drain animation independent of what number it displays.
function useCrashingProgress(target: number, duration = 1100) {
  const [progress, setProgress] = useState(1);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(1 - eased * (1 - target));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return progress;
}

// Same ring geometry/styling as ui-bits' ScoreRing (score dashboards elsewhere
// in the app), but showing the literal "404" instead of a score — the ring
// still drains live on mount so it reads as the same kind of live check.
function NotFoundRing({ size = 168 }: { size?: number }) {
  const progress = useCrashingProgress(0.04);
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--color-border)"
          strokeWidth={10}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--color-critical)"
          strokeWidth={10}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - progress * c}
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-3xl font-semibold text-critical">404</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Not found</div>
      </div>
    </div>
  );
}

// Parallax grid + glow, shared by both fallback scenes' backgrounds.
function SceneBackdrop({
  accentClass,
  pos,
}: {
  accentClass: string;
  pos: { x: number; y: number };
}) {
  return (
    <>
      <div
        className="absolute inset-0 grid-bg opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)] transition-transform duration-300 ease-out"
        style={{ transform: `translate(${pos.x * -16}px, ${pos.y * -16}px)` }}
      />
      <div
        className={`absolute left-1/2 top-1/3 -z-10 h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full ${accentClass} blur-3xl transition-transform duration-300 ease-out sm:h-[520px] sm:w-[720px]`}
        style={{
          transform: `translate(calc(-50% + ${pos.x * 40}px), calc(-50% + ${pos.y * 40}px))`,
        }}
      />
    </>
  );
}

// Centered single-column layout on top of the shared backdrop — used by the
// 500 scene. The 404 scene below builds its own card layout on the same
// backdrop instead, since it isn't a simple icon/heading/subtext shape.
function ErrorScene({
  accentClass,
  hero,
  heading,
  subtext,
  actions,
}: {
  accentClass: string;
  hero: ReactNode;
  heading?: ReactNode;
  subtext?: string;
  actions: ReactNode;
}) {
  const { pos, onMouseMove, onMouseLeave } = useParallax();

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-16 sm:px-6 sm:py-24"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <SceneBackdrop accentClass={accentClass} pos={pos} />
      <div className="relative w-full max-w-lg text-center">
        {hero}
        {heading ? (
          <h1 className="mt-6 font-display text-2xl font-semibold sm:text-3xl">{heading}</h1>
        ) : null}
        {subtext ? <p className="mt-4 text-muted-foreground">{subtext}</p> : null}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{actions}</div>
      </div>
    </div>
  );
}

// A single "beat then flatline" unit, 0..400 on the x axis, baseline y=40.
// Rendered twice back to back (0..800) and scrolled by exactly one unit width
// so the loop seam is invisible.
function heartbeatUnit(offsetX: number) {
  return `L${offsetX + 150},40 L${offsetX + 160},30 L${offsetX + 172},58 L${offsetX + 184},8 L${offsetX + 196},68 L${offsetX + 208},40 L${offsetX + 400},40`;
}
const HEARTBEAT_PATH = `M0,40 ${heartbeatUnit(0)} ${heartbeatUnit(400)}`;

function FlatlineHero() {
  return (
    <div className="mx-auto h-20 w-64 overflow-hidden sm:w-80" aria-hidden="true">
      <svg
        width={800}
        height={80}
        viewBox="0 0 800 80"
        preserveAspectRatio="none"
        className="h-full w-[200%] animate-[heartbeat-scroll_2.8s_linear_infinite] text-critical"
      >
        <path
          d={HEARTBEAT_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// LaunchReadyy, scanning itself: the ring drains live on mount, landing on
// the literal 404 — that's the whole joke, this route doesn't pass its own
// readiness check.
function NotFoundComponent() {
  const { pos, onMouseMove, onMouseLeave } = useParallax();

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-16 sm:px-6 sm:py-24"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <SceneBackdrop accentClass="bg-critical/10" pos={pos} />
      <div className="relative flex flex-col items-center gap-6">
        <NotFoundRing />
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-widest text-critical">
            Ship status
          </div>
          <p className="mt-1 font-display text-xl font-semibold sm:text-2xl">
            This route never shipped.
          </p>
        </div>
        <Link
          to="/"
          className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground glow-primary transition hover:opacity-90"
        >
          <Home className="h-4 w-4" /> Go home
        </Link>
      </div>
    </div>
  );
}

// Deliberately no SiteHeader/SiteFooter here — if the app broke badly enough
// to trip this boundary, rendering the same shared chrome that may be part of
// the problem isn't a great idea, and a minimal page signals "actually broken"
// more clearly than the full site shell would.
function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <ErrorScene
      accentClass="bg-critical/10"
      hero={<FlatlineHero />}
      heading="Something went wrong"
      subtext="Something broke on our end. Try refreshing or head back home — we'll get it sorted."
      actions={
        <>
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground glow-primary transition hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-5 py-2.5 text-sm font-medium hover:bg-muted"
          >
            <Home className="h-4 w-4" /> Go home
          </a>
        </>
      }
    />
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async () => {
    // Static import on purpose: the root loader runs on every page load, so deferring
    // it only bought an extra request in the critical path — and two other modules
    // import it statically anyway, so it never left the main chunk.
    return getSiteConfigFn().catch(() => ({
      betaBanner: false,
      statusBannerMessage: DEFAULT_STATUS_BANNER_MESSAGE,
      maintenanceMode: false,
      contactEmail: "launchreadyy@gmail.com",
    }));
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "LaunchReadyy" },
      {
        name: "description",
        content:
          "Production readiness for any software repository — web, mobile, desktop, APIs, and backend stacks via GitHub.",
      },
      { name: "author", content: "LaunchReadyy" },
      { property: "og:title", content: "LaunchReadyy" },
      {
        property: "og:description",
        content:
          "Production readiness for any software repository — web, mobile, desktop, APIs, and backend stacks via GitHub.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/logo/horizontal_logo.png" },
      {
        property: "og:image:alt",
        content: "LaunchReadyy — Production readiness for any software repository",
      },
      { property: "og:site_name", content: "LaunchReadyy" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "/logo/horizontal_logo.png" },
      { name: "twitter:title", content: "LaunchReadyy" },
      {
        name: "twitter:description",
        content:
          "Production readiness for any software repository — web, mobile, desktop, APIs, and backend stacks via GitHub.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/logo/logoo.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <script
          // Dark is the default; only an explicit "light" choice turns it off.
          // Runs before first paint. Mirrors src/lib/theme.ts — keep both in sync.
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{if(localStorage.getItem('lr-theme')==='light'){document.documentElement.classList.remove('dark')}}catch(e){}})();",
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "LaunchReadyy",
              url: "https://github.com/g0GobliN/launchreadyy",
              logo: "/logo/horizontal_logo.png",
              sameAs: ["https://github.com/g0GobliN", "https://v1.monster/"],
              founder: {
                "@type": "Person",
                name: "Vishal Gurung",
                url: "https://v1.monster/",
                sameAs: ["https://v1.monster/", "https://github.com/g0GobliN"],
              },
            }),
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RouterProgressBar() {
  const isLoading = useRouterState({ select: (s) => s.status === "pending" });
  const [width, setWidth] = useState(0);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    if (isLoading) {
      setOpacity(1);
      setWidth(80);
    } else {
      setWidth(100);
      const t = setTimeout(() => setOpacity(0), 200);
      return () => clearTimeout(t);
    }
  }, [isLoading]);

  return (
    <div
      className="pointer-events-none fixed top-0 left-0 right-0 z-50 h-0.5"
      style={{ opacity, transition: "opacity 300ms" }}
      suppressHydrationWarning
    >
      <div
        className="h-full bg-primary"
        suppressHydrationWarning
        style={{
          width: `${width}%`,
          transition: width === 80 ? "width 8s cubic-bezier(0.1, 0.05, 0, 1)" : "width 200ms ease",
        }}
      />
    </div>
  );
}

function StatusBanner({
  message,
  contactEmail,
  label,
  onDismiss,
}: {
  message: string;
  contactEmail: string;
  label: string;
  onDismiss: () => void;
}) {
  return (
    <div className="relative z-40 w-full shrink-0 border-b border-amber-300/80 bg-amber-100 py-2.5 pl-4 pr-10 text-center text-[11px] leading-relaxed text-amber-950 sm:pl-10 sm:text-xs dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-100">
      <p className="mx-auto max-w-3xl text-balance lg:max-w-none">
        <span className="font-semibold text-amber-900 dark:text-yellow-300">{label}</span>
        <span className="mx-2 text-amber-800/50 dark:text-yellow-500/60">·</span>
        {message}
        <span className="mx-2 text-amber-800/50 dark:text-yellow-500/60">·</span>
        Questions?{" "}
        <a
          href={`mailto:${contactEmail}`}
          className="font-medium underline underline-offset-2 transition hover:text-amber-700 dark:hover:text-yellow-50"
        >
          {contactEmail}
        </a>
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss banner"
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-amber-800/60 transition hover:text-amber-950 dark:text-yellow-500/60 dark:hover:text-yellow-200"
      >
        ✕
      </button>
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { betaBanner, statusBannerMessage, maintenanceMode, contactEmail } = Route.useLoaderData();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const showBanner = (betaBanner || maintenanceMode) && !bannerDismissed;

  // Signals that hydration finished. Scroll reveals ship as opacity-0 HTML; if
  // this never lands, a CSS failsafe in styles.css shows them anyway.
  useEffect(() => {
    document.documentElement.classList.add("js-ready");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div
        className="flex h-svh flex-col overflow-hidden"
        style={
          {
            // Used by marketing hero to fill one mobile screen under banner + sticky header.
            "--lr-banner-h": showBanner ? "2.75rem" : "0px",
          } as CSSProperties
        }
      >
        {showBanner && (
          <StatusBanner
            label={maintenanceMode ? "Maintenance" : "Notice"}
            message={statusBannerMessage}
            contactEmail={contactEmail}
            onDismiss={() => setBannerDismissed(true)}
          />
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <RouterProgressBar />
          <Outlet />
        </div>
      </div>
    </QueryClientProvider>
  );
}
