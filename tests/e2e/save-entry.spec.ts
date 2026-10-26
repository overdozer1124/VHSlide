import { test, expect } from "@playwright/test";
test("file saving explains formats and opens backup recovery without signing in", async ({
  page,
}) => {
  await page.goto("/");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ファイルに保存", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await expect(page.locator(".toast")).toContainText("ダウンロード先を確認");
  await expect(page.locator(".toast")).toContainText("付箋・共有設定");
  await page
    .getByRole("button", { name: "保存方法を選ぶ", exact: true })
    .click();
  await expect(page.getByRole("menu")).toContainText(
    "付箋・共有設定は含みません",
  );
  await page.getByRole("menuitem", { name: /完全バックアップ（ZIP）/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "完全バックアップと復元",
    exact: true,
  });
  await expect(dialog).toContainText("サインインしてください");
  await dialog.locator("summary").click();
  await expect(dialog).toContainText("過去の版は含みません");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "保存方法を選ぶ", exact: true }),
  ).toBeFocused();
});
