import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
});

test("display settings remain usable with selected objects and both sidebars closed", async ({
  page,
}) => {
  await page
    .locator(".editor-page-current .element[data-element-id]")
    .last()
    .click();
  await page
    .getByRole("button", { name: "サムネイルバーをたたむ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "右のサイドバーをたたむ", exact: true })
    .click();
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  );
  const button = page.getByRole("button", { name: "表示の設定", exact: true });
  await button.click();
  const panel = page.getByRole("dialog", { name: "表示の設定", exact: true });
  await expect(panel).toContainText("ページの内容ではなく");
  await page.keyboard.press("Delete");
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  );
  expect(after.slides).toEqual(before.slides);
  const linked = panel.getByRole("switch", { name: "縦の連動", exact: true });
  await linked.click();
  await expect(linked).toBeChecked();
  expect(
    (
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
      )
    ).linkedRows,
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(
    page.getByRole("button", { name: "右のサイドバーを表示", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "右のサイドバーを表示", exact: true })
    .click();
  await expect(page.locator(".inspector")).toBeVisible();
});

test("insertion palettes open directly and retain visible labels in compact layouts", async ({
  page,
}, info) => {
  for (const width of [1366, 1024, 810]) {
    await page.setViewportSize({ width, height: 768 });
    for (const name of [
      "文字",
      "画像",
      "手描き",
      "表を追加",
      "図形を追加",
      "線を追加",
      "もっと見る（図解・グラフ）",
      "スピーカーノート",
      "表示の設定",
    ]) {
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    }
    expect(
      (await page.locator(".editor-layout").boundingBox())!.y,
    ).toBeLessThanOrEqual(104);
    await page
      .getByRole("button", { name: "もっと見る（図解・グラフ）", exact: true })
      .click();
    const palette = page.getByRole("dialog", {
      name: "図解・グラフを追加",
      exact: true,
    });
    await expect(palette).toBeVisible();
    await expect(
      palette.getByRole("button", { name: "比較の図解を追加", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`tools-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", {
        name: "もっと見る（図解・グラフ）",
        exact: true,
      }),
    ).toBeFocused();
    await page.getByRole("button", { name: "図形を追加", exact: true }).click();
    await page.getByRole("button", { name: "四角を追加", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "図形を追加", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "線を追加", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "線を追加", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
});
