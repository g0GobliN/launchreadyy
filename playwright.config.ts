import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || "http://127.0.0.1:5174";
const useRemoteBase = Boolean(process.env.PLAYWRIGHT_BASE_URL?.trim());

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: useRemoteBase
    ? undefined
    : {
        command: "npm run dev:vite",
        url: "http://127.0.0.1:5174",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
