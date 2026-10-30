import { APP_VERSION, releaseHistory } from "../../src/releaseHistory";
import { test, expect } from "@playwright/test";

test("thumbnail footers edit independently, restore after reload and work in both editor rails", async ({
  page,
}, info) => {
  await page.goto("/");
  const footer = page.getByRole("textbox", {
    name: "1.1のフッター",
    exact: true,
  });
  await footer.fill("1班の作品");
  await footer.press("Enter");
  const data = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
  expect((await data()).slides[0].footerLabel).toBe("1班の作品");
  expect((await data()).slides[0].title).toBe("わたしたちのまち");
  await page.reload();
  await expect(footer).toHaveValue("1班の作品");
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  const rail = page.locator(".rail-footer-editor input").first();
  await expect(rail).toHaveValue("1班の作品");
  await rail.fill("左の一覧で編集");
  await rail.press("Enter");
  await page
    .getByRole("button", { name: "1段目の横のページをひらく", exact: true })
    .click();
  const horizontal = page.locator(".flyout-footer-editor").first();
  await expect(horizontal).toHaveValue("左の一覧で編集");
  await horizontal.fill("横の一覧で編集");
  await horizontal.press("Enter");
  await expect(rail).toHaveValue("横の一覧で編集");
  await page.screenshot({ path: info.outputPath("editable-footer.png") });
  await page
    .getByRole("button", { name: "横のページ一覧を閉じる", exact: true })
    .click();
  await rail.fill("");
  await rail.press("Enter");
  await expect(rail).toHaveValue("わたしたちのまち");
});

test("the versioned history opens as a page, supports direct links and returns without changing the work", async ({
  page,
}, info) => {
  await page.goto("/");
  const before = await page.evaluate(() =>
    localStorage.getItem("vhslide-deck-v1"),
  );
  await page.getByRole("button", { name: "その他", exact: true }).click();
  await page.getByRole("menuitem", { name: "更新履歴", exact: true }).click();
  const history = page.getByRole("region", { name: "更新履歴", exact: true });
  await expect(
    history.getByRole("heading", { name: "更新履歴", exact: true }),
  ).toBeVisible();
  await expect(history.locator("[data-version]").first()).toHaveAttribute(
    "data-version",
    APP_VERSION,
  );
  await expect(history.locator("[data-version]").last()).toHaveAttribute(
    "data-version",
    "0.1.0",
  );
  await expect(history.locator("[data-version]")).toHaveCount(
    releaseHistory.length,
  );
  expect(page.url()).toContain("#updates");
  await page.keyboard.press("Delete");
  await page.keyboard.press("ArrowRight");
  expect(
    await page.evaluate(() => localStorage.getItem("vhslide-deck-v1")),
  ).toBe(before);
  await page.screenshot({ path: info.outputPath("release-history.png") });
  await page.reload();
  await expect(history).toBeVisible();
  await history
    .getByRole("button", { name: "アプリに戻る", exact: true })
    .click();
  await expect(history).toHaveCount(0);
  await page.getByRole("button", { name: "その他", exact: true }).click();
  await page.getByRole("menuitem", { name: "更新履歴", exact: true }).click();
  await page.goBack();
  await expect(history).toHaveCount(0);
});
