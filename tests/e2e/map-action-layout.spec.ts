import { test, expect, type Page } from "@playwright/test";
import { scopeBook } from "../support/scopeBook";
const card = (page: Page, id: string) =>
  page.locator(`[data-page-id="${id}"] .thumbnail`);
const compare = (page: Page) =>
  page.getByRole("button", { name: "比較", exact: true });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (book) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(book)),
    scopeBook(),
  );
  await page.goto("/");
});
test("comparison is contextual, inherits exact selected IDs and never silently truncates five pages", async ({
  page,
}, info) => {
  const before = await page.evaluate(() =>
    localStorage.getItem("vhslide-deck-v1"),
  );
  await expect(compare(page)).toHaveCount(0);
  await page
    .getByRole("button", { name: "スライドを複数選択", exact: true })
    .click();
  await expect(compare(page)).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "選択したスライドの操作", exact: true }),
  ).toContainText("2〜4枚");
  const ids = ["p00", "p21", "p10", "p11", "p01"];
  for (let i = 0; i < ids.length; i++) {
    await card(page, ids[i]).click({ modifiers: i ? ["Control"] : [] });
    if (i === 0 || i === 4) await expect(compare(page)).toBeDisabled();
    else await expect(compare(page)).toBeEnabled();
    if (i === 1 || i === 3) {
      await compare(page).click();
      await expect(
        page.getByLabel("スライドの比較").locator(".slide-canvas"),
      ).toHaveCount(i + 1);
      await expect(page.getByLabel("スライドの比較")).toContainText("S1.1");
      await expect(page.getByLabel("スライドの比較")).toContainText("S2.3");
      await expect(page.getByLabel("スライドの比較")).not.toContainText("S3.3");
      await page.keyboard.press("Escape");
      await expect(compare(page)).toBeFocused();
      await expect(page.locator('[data-multi-selected="true"]')).toHaveCount(
        i + 1,
      );
    }
  }
  await expect(page.locator('[data-multi-selected="true"]')).toHaveCount(5);
  await expect(
    page.getByRole("region", { name: "選択したスライドの操作", exact: true }),
  ).toContainText("4ページ以下に減らしてください");
  await expect(
    page.getByRole("group", { name: "マップの表示サイズ", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("five-selected.png") });
  await page.getByRole("button", { name: "その他", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-multi-selected="true"]')).toHaveCount(5);
  await card(page, ids[4]).click({ modifiers: ["Control"] });
  await expect(compare(page)).toBeEnabled();
  expect(
    await page.evaluate(() => localStorage.getItem("vhslide-deck-v1")),
  ).toBe(before);
});

test("sheet-wide batch is available without a selection and survives filtered-map scope", async ({
  page,
}) => {
  await expect(
    page.getByRole("button", { name: "行・列を一括操作", exact: true }),
  ).toBeVisible();
  const more = page.getByRole("button", {
    name: "行・列を一括操作",
    exact: true,
  });
  await more.click();
  const batch = page.getByRole("region", {
    name: "行・列の一括操作",
    exact: true,
  });
  await expect(batch).toContainText("このシート全体");
  await batch.getByRole("button", { name: "閉じる", exact: true }).click();
  await page
    .getByRole("button", { name: "スライドを複数選択", exact: true })
    .click();
  await card(page, "p00").click();
  await card(page, "p21").click({ modifiers: ["Control"] });
  await page
    .getByRole("button", { name: "選択したページでフィルタ", exact: true })
    .click();
  await expect(page.locator(".slide-card")).toHaveCount(2);
  await more.click();
  await expect(batch).toContainText("フィルタ外のページも対象");
  await batch.getByRole("button", { name: "閉じる", exact: true }).click();
  await page
    .getByRole("button", { name: "スライドを複数選択", exact: true })
    .click();
  await page
    .getByRole("button", { name: "表示中をすべて選択", exact: true })
    .click();
  await compare(page).click();
  await expect(
    page.getByLabel("スライドの比較").locator(".slide-canvas"),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "スライドを選び直す", exact: true })
    .click();
  await expect(
    page.getByLabel("対象スライド").getByRole("checkbox"),
  ).toHaveCount(2);
});
