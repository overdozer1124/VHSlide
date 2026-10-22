import { test, expect } from "@playwright/test";

test("Chromebook map shows two full rows, fits ten topics, and returns to the selected page", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Chromebookの画面サイズ");
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("public/samples/vhslide-10x40.json");
  await expect(page.locator(".slide-card")).toHaveCount(400);
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides,
  );
  const map = page.getByRole("region", {
    name: "スライドのマップ",
    exact: true,
  });
  const bounds = (await map.boundingBox())!;
  expect(bounds.y).toBeLessThanOrEqual(145);
  expect(bounds.height).toBeGreaterThanOrEqual(400);
  for (const card of [
    page.locator(".slide-card").nth(0),
    page.locator(".slide-card").nth(10),
  ]) {
    const b = (await card.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(bounds.y);
    expect(b.y + b.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: info.outputPath("chromebook-map.png") });
  await page.getByRole("button", { name: "横をおさめる", exact: true }).click();
  await expect
    .poll(() => map.evaluate((node) => node.scrollWidth - node.clientWidth))
    .toBeLessThanOrEqual(2);
  const lastColumn = (await page.locator(".slide-card").nth(9).boundingBox())!;
  expect(lastColumn.x + lastColumn.width).toBeLessThanOrEqual(
    bounds.x + bounds.width,
  );
  await page.screenshot({ path: info.outputPath("ten-topics-map.png") });
  const scale = await page
    .getByRole("button", { name: "表示サイズを80%に戻す", exact: true })
    .textContent();
  await page
    .getByRole("button", { name: "40.10 まとめ｜おわりにを編集", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("40.10 まとめ｜おわりに");
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "表示サイズを80%に戻す", exact: true }),
  ).toHaveText(scale!);
  const active = (await page.locator(".active-card").boundingBox())!;
  expect(active.y).toBeGreaterThanOrEqual(bounds.y);
  expect(active.y + active.height).toBeLessThanOrEqual(
    bounds.y + bounds.height,
  );
  expect(await map.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides,
    ),
  ).toEqual(before);
});

test("map zoom and editing remain usable on a narrow touch screen", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "タッチ端末の表示");
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto("/");
  const reset = page.getByRole("button", {
    name: "表示サイズを80%に戻す",
    exact: true,
  });
  const card = page.locator(".slide-card").first();
  const width = (await card.boundingBox())!.width;
  await page.getByRole("button", { name: "マップを縮小", exact: true }).tap();
  await expect
    .poll(async () => (await card.boundingBox())!.width)
    .toBeLessThan(width);
  await page.getByRole("button", { name: "マップを拡大", exact: true }).tap();
  await expect(reset).toHaveText("80%");
  await page.getByRole("button", { name: "横をおさめる", exact: true }).tap();
  await expect
    .poll(() =>
      page
        .locator(".map-scroll")
        .evaluate((node) => node.scrollWidth - node.clientWidth),
    )
    .toBeLessThanOrEqual(2);
  await reset.tap();
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .tap();
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("わたしたちのまち");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
