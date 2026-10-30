import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/config", (r) =>
    r.fulfill({
      json: { clientId: "test.apps.googleusercontent.com", notice: "" },
    }),
  );
  await page.route("**/api/session", (r) =>
    r.fulfill({ json: { user: null } }),
  );
  await page.route("https://accounts.google.com/**", (r) => r.abort());
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "クラウド", exact: true }),
  ).toBeVisible();
});

test("file/cloud are distinct, presentation is last, and the map toolbar stays on one row", async ({
  page,
}, info) => {
  await expect(
    page.getByRole("button", { name: "作品", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "その他", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "マップのその他", exact: true }),
  ).toHaveCount(0);
  const file = page.getByRole("button", { name: "ファイル", exact: true });
  await file.click();
  const menu = page.getByRole("menu", { name: "ファイル", exact: true });
  for (const name of [
    "新しく",
    "開く",
    "JSONで保存",
    "PDFで保存",
    "完全バックアップ（ZIP）・復元",
    "保存した版",
  ])
    await expect(menu.getByRole("menuitem", { name })).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "クラウド", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(file).toBeFocused();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ファイルに保存", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "クラウドの作品", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  for (const width of [1366, 1024, 810, 390]) {
    await page.setViewportSize({ width, height: 768 });
    expect(
      await page
        .locator(".header-actions")
        .evaluate((e) =>
          e.lastElementChild?.classList.contains("present-action"),
        ),
    ).toBe(true);
    const presenting = (await page.locator(".present-action").boundingBox())!;
    expect(presenting.x + presenting.width).toBeLessThanOrEqual(width);
    const toolbar = page.locator(".map-toolbar");
    const box = (await toolbar.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(48);
    const centers = await toolbar.getByRole("button").evaluateAll((buttons) =>
      buttons.map((e) => {
        const r = e.getBoundingClientRect();
        return r.y + r.height / 2;
      }),
    );
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`map-toolbar-${width}.png`),
    });
  }
  await page
    .getByRole("button", { name: "行・列を一括操作", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "行・列の一括操作", exact: true }),
  ).toBeVisible();
});

test("drawing has a pencil and panel toggles stay with their own sidebar, including restore focus", async ({
  page,
}, info) => {
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "手描き", exact: true }).locator("svg"),
  ).toHaveCount(1);
  for (const width of [1366, 1024, 810, 390]) {
    await page.setViewportSize({ width, height: 768 });
    const railClose = page.getByRole("button", {
      name: "サムネイルバーをたたむ",
      exact: true,
    });
    const inspectorClose = page.getByRole("button", {
      name: "右のサイドバーをたたむ",
      exact: true,
    });
    expect(
      await railClose.evaluate((e) => !!e.closest("#editor-thumbnails")),
    ).toBe(true);
    expect(
      await inspectorClose.evaluate((e) => !!e.closest("#editor-inspector")),
    ).toBe(true);
    await railClose.click();
    const railOpen = page.getByRole("button", {
      name: "サムネイルバーを表示",
      exact: true,
    });
    await expect(railOpen).toBeFocused();
    await inspectorClose.click();
    const inspectorOpen = page.getByRole("button", {
      name: "右のサイドバーを表示",
      exact: true,
    });
    await expect(inspectorOpen).toBeFocused();
    expect(
      (await page.locator(".collapsed-inspector").boundingBox())!.width,
    ).toBeLessThanOrEqual(36);
    await page.screenshot({
      path: info.outputPath(`collapsed-panels-${width}.png`),
    });
    await railOpen.click();
    await expect(railClose).toBeFocused();
    await inspectorOpen.click();
    await expect(inspectorClose).toBeFocused();
  }
});
