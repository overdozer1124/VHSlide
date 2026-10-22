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

test("a thousand pages render nearby thumbnails only, keep their grid positions, and expose exactly three display steps", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "大量ページの描画範囲");
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1366, height: 600 });
  const sample = await (
    await page.request.get("/samples/vhslide-10x40.json")
  ).json();
  const deck = {
    ...sample,
    slides: Array.from({ length: 1000 }, (_, i) => {
      const source = sample.slides[i % sample.slides.length];
      return {
        ...source,
        id: `perf-${i}`,
        x: i % 20,
        y: Math.floor(i / 20),
        title: `確認ページ${i + 1}`,
        elements: source.elements.map((element: { id: string }, j: number) => ({
          ...element,
          id: `perf-${i}-${j}`,
        })),
      };
    }),
  };
  await page.addInitScript(
    (deck) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(deck)),
    deck,
  );
  await page.goto("/");
  await expect(page.locator(".slide-card")).toHaveCount(1000);
  const map = page.locator(".map-scroll");
  const originalMap = await map.elementHandle();
  const rendered = () => page.locator(".map-grid .slide-canvas").count();
  await expect.poll(rendered).toBeGreaterThan(0);
  await expect.poll(rendered).toBeLessThan(60);
  const first = page.locator('[data-page-id="perf-0"]');
  const last = page.locator('[data-page-id="perf-999"]');
  const firstSize = (await first.boundingBox())!;
  const dimensions = await map.evaluate((node) => ({
    width: node.scrollWidth,
    height: node.scrollHeight,
  }));
  await expect(first.locator(".slide-canvas")).toHaveCount(1);
  await expect(last.locator(".slide-canvas")).toHaveCount(0);
  await map.evaluate((node) =>
    node.scrollTo({ left: node.scrollWidth, top: node.scrollHeight }),
  );
  await expect(last.locator(".slide-canvas")).toHaveCount(1);
  await expect(first.locator(".slide-canvas")).toHaveCount(0);
  await expect.poll(rendered).toBeLessThan(60);
  expect(
    await map.evaluate((node) => ({
      width: node.scrollWidth,
      height: node.scrollHeight,
    })),
  ).toEqual(dimensions);
  const placeholder = (await first.boundingBox())!;
  expect(placeholder.width).toBeCloseTo(firstSize.width, 1);
  expect(placeholder.height).toBeCloseTo(firstSize.height, 1);
  await page
    .getByRole("textbox", { name: "ページ番号で探す", exact: true })
    .fill("1.1");
  await page
    .getByRole("button", { name: "番号のページを探す", exact: true })
    .click();
  await expect(first.locator(".slide-canvas")).toHaveCount(1);
  await expect(last.locator(".slide-canvas")).toHaveCount(0);
  const reset = page.getByRole("button", {
    name: "表示サイズを80%に戻す",
    exact: true,
  });
  const down = page.getByRole("button", { name: "マップを縮小", exact: true });
  const up = page.getByRole("button", { name: "マップを拡大", exact: true });
  await expect(reset).toHaveText("80%");
  await expect(up).toBeDisabled();
  await page.getByRole("button", { name: "横をおさめる", exact: true }).click();
  await expect(reset).toHaveText("番号");
  await expect
    .poll(() => map.evaluate((node) => node.scrollWidth - node.clientWidth))
    .toBeLessThanOrEqual(2);
  await reset.click();
  await down.click();
  await expect(reset).toHaveText("60%");
  await expect.poll(rendered).toBeLessThan(90);
  await down.click();
  await expect(reset).toHaveText("番号");
  await expect(down).toBeDisabled();
  await expect.poll(rendered).toBe(0);
  await expect(page.locator(".number-tile")).toHaveCount(1000);
  await page
    .getByRole("button", { name: "確認ページ1000を編集", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("確認ページ1000");
  await expect(map).toBeHidden();
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await expect(reset).toHaveText("番号");
  expect(
    await map.evaluate((node, original) => node === original, originalMap!),
  ).toBe(true);
  await up.click();
  await expect(reset).toHaveText("60%");
  await expect(last.locator(".slide-canvas")).toHaveCount(1);
  await expect(
    last.getByRole("button", {
      name: "確認ページ1000のページメニュー",
      exact: true,
    }),
  ).toBeVisible();
  await up.click();
  await expect(reset).toHaveText("80%");
  await expect(up).toBeDisabled();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides,
    ),
  ).toEqual(deck.slides);
});
