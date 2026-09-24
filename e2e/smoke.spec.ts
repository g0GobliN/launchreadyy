/**
 * Minimal Playwright smoke — the app's entry point + docs load without auth.
 * Full authenticated flows need staging secrets; documented in docs/guides/production.md.
 *
 * Run: npm run test:e2e:smoke
 * Optional CI: workflow_dispatch / nightly (see .github/workflows/e2e-smoke.yml)
 */

import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL?.trim() || "http://127.0.0.1:5174";

test.describe("public smoke", () => {
  test("root sends visitors to the dashboard", async ({ page }) => {
    const res = await page.goto(BASE + "/");
    expect(res?.ok() || res?.status() === 200).toBeTruthy();
    // `/` is a redirect, not a page: a self-hosted install should land on the app itself. This is
    // what catches the landing page coming back (the marketing one lives in site/).
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator("body")).toBeVisible();
  });

  test("docs loads", async ({ page }) => {
    const res = await page.goto(BASE + "/docs");
    expect(res?.ok() || res?.status() === 200).toBeTruthy();
  });
});
