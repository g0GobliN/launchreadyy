export const E2E_HOME_SPEC = `import { test, expect } from "@playwright/test";

test("home loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/./);
});
`;
