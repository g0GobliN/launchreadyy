export const SENTRY_INIT = `import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION,
  tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
  beforeSend(event) {
    // Drop noisy network errors from browser extensions
    if (event.exception?.values?.[0]?.value?.includes("Extension context")) return null;
    return event;
  },
});
`;

export const SENTRY_ERROR_BOUNDARY_TSX = `import * as Sentry from "@sentry/react";
import type { ReactNode } from "react";

export function SentryErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "An unexpected error occurred"}
            </p>
            <button
              className="mt-4 text-sm text-primary underline"
              onClick={resetError}
            >
              Try again
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
`;
