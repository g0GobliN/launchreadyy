export const HEALTH_CHECK_TANSTACK = `import { createAPIFileRoute } from "@tanstack/start/api";

export const APIRoute = createAPIFileRoute("/api/health")({
  GET: () => Response.json({ status: "ok", uptime: process.uptime() }),
});
`;
