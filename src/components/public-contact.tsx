import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Contact addresses must come from the root loader, not from `process.env` read inside a
 * component: the root loader resolves the operator-configured `contact_email` (site config) with the
 * env var as fallback, on the server. Reading the env directly in a client component yields the
 * non-routable default in the browser and a different value in the SSR HTML — a hydration mismatch
 * and, worse, an address the operator did not configure.
 */
type RootChrome = { contactEmail?: string; securityEmail?: string };

function useAddresses(): { contactEmail: string; securityEmail: string } {
  const data = useRouterState({
    select: (state) =>
      state.matches.find((m) => m.routeId === "__root__")?.loaderData as RootChrome | undefined,
  });
  return {
    contactEmail: data?.contactEmail ?? "",
    securityEmail: data?.securityEmail ?? "",
  };
}

export function ContactEmailLink({
  className,
  subject,
  children,
}: {
  className?: string;
  subject?: string;
  children?: ReactNode;
}) {
  const { contactEmail } = useAddresses();
  return (
    <a
      href={`mailto:${contactEmail}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`}
      className={className}
    >
      {children ?? contactEmail}
    </a>
  );
}

export function SecurityEmailLink({
  className,
  subject,
  children,
}: {
  className?: string;
  subject?: string;
  children?: ReactNode;
}) {
  const { securityEmail } = useAddresses();
  return (
    <a
      href={`mailto:${securityEmail}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`}
      className={className}
    >
      {children ?? securityEmail}
    </a>
  );
}

/** Just the address, for pages that render it as plain text. */
export function ContactEmailText() {
  return <>{useAddresses().contactEmail}</>;
}

export function SecurityEmailText() {
  return <>{useAddresses().securityEmail}</>;
}
