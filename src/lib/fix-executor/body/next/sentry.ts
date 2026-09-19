export const SENTRY_INIT_NEXTJS = `import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_APP_VERSION,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
});
`;

export function sentryInstrumentationNextjs(usesSrcDir: boolean): string {
  const importPath = usesSrcDir ? "./lib/sentry" : "./src/lib/sentry";
  return `export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("${importPath}");
  }
}
`;
}
