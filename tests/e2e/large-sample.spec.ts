import { test, expect } from "@playwright/test";

test("imports 400 sample pages, selects the last thumbnail, and restores the deck", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles("public/samples/vhslide-10x40.json");
  await expect(page.locator(".slide-card")).toHaveCount(400);
  await page
    .getByRole("button", {
      name: "1.1 まちの紹介｜はじめにを編集",
      exact: true,
    })
    .click();
  await expect(page.locator(".rail-trigger")).toHaveCount(40);
  const row = page.getByRole("button", {
    name: "40段目の横のページをひらく",
    exact: true,
  });
  if (testInfo.project.name === "touch") await row.tap();
  else await row.click();
  const popup = page.getByRole("region", { name: "40段目の横のページ一覧" });
  await expect(popup.locator(".row-page")).toHaveCount(10);
  const last = popup.getByRole("button", {
    name: "40.10 40.10 まとめ｜おわりにを編集",
    exact: true,
  });
  if (testInfo.project.name === "touch") await last.tap();
  else await last.click();
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "40.10 まとめ｜おわりに",
  );
  await expect(
    page.locator(".rail-trigger.rail-active .rail-coordinate > span").first(),
  ).toHaveText("40.10");
  await page.reload();
  await expect(page.locator(".slide-card")).toHaveCount(400);
  await page
    .getByRole("button", {
      name: "1.1 まちの紹介｜はじめにを編集",
      exact: true,
    })
    .click();
  await expect(page.locator(".rail-trigger").last()).toContainText("40.10");
  expect(errors).toEqual([]);
});
