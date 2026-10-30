import type { Page } from "@playwright/test";

export async function saveJSON(page: Page) {
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  await page.getByRole("menuitem", { name: /^JSONで保存/ }).click();
}
