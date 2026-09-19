import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy URL — product capabilities now live in /docs#capabilities */
export const Route = createFileRoute("/features")({
  beforeLoad: () => {
    throw redirect({ to: "/docs", hash: "capabilities" });
  },
});
