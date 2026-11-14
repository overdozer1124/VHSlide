import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { blank } from "../../src/model";
const headers = { Origin: "http://127.0.0.1:3187" };
async function signIn(page: Page, name: string) {
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential: name },
      })
    ).status(),
  ).toBe(200);
}

test("help menu shows the deck file size dialog", async ({ page }) => {
  await signIn(page, "size-host");
  const created = await page.request.post("/api/decks", {
    headers,
    data: {
      version: 1,
      title: "サイズ確認",
      slides: [blank(0, 0), blank(1, 0)],
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "ヘルプ" }).click();
  await page.getByRole("menuitem", { name: "ファイルサイズ" }).click();
  const dialog = page.getByRole("dialog", { name: "ファイルサイズ" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".deck-size-total")).toHaveText(/B|KB|MB/);
  await expect(dialog).toContainText("保存上限（25MB）");
  await expect(dialog).toContainText("2枚");
  await expect(dialog).toContainText("埋め込みアプリのサムネイル");
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(dialog).toBeHidden();
});
