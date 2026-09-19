/**
 * Minimal Playwright smoke — landing + docs load without auth.
 * Full authenticated flows need staging secrets; documented in docs/guides/production.md.
 *
 * Run: npm run test:e2e:smoke
 * Optional CI: workflow_dispatch / nightly (see .github/workflows/e2e-smoke.yml)
 */

import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL?.trim() || "http://127.0.0.1:5174";

test.describe("public smoke", () => {
  test("landing loads", async ({ page }) => {
    const res = await page.goto(BASE + "/");
    expect(res?.ok() || res?.status() === 200).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
  });

  test("docs loads", async ({ page }) => {
    const res = await page.goto(BASE + "/docs");
    expect(res?.ok() || res?.status() === 200).toBeTruthy();
  });
});
