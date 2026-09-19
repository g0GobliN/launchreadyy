import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/repo/$repoId")({
  component: () => <Outlet />,
});
