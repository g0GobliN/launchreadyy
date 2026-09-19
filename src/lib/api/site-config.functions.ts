import { createServerFn } from "@tanstack/react-start";
import { resolveStatusBannerMessage } from "@/lib/status-banner";

export const getSiteConfigFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getAllSiteConfig } = await import("../site-config.server");
  const config = await getAllSiteConfig();
  const maintenanceMode = config["maintenance_mode"] === "true";
  return {
    betaBanner: config["beta_banner"] === "true",
    statusBannerMessage: resolveStatusBannerMessage(
      config["status_banner_message"],
      maintenanceMode,
    ),
    maintenanceMode,
    contactEmail: config["contact_email"] ?? "launchreadyy@gmail.com",
  };
});
