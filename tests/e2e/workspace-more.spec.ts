import { test, expect, type Page } from "@playwright/test";
const more = (p: Page) =>
  p.getByRole("button", { name: "その他", exact: true });
const menu = (p: Page) => p.getByRole("menu", { name: "その他", exact: true });
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});
test("map keeps primary actions, exposes labeled secondary actions and restores focus", async ({
  page,
}) => {
  const before = await page.evaluate(() =>
    localStorage.getItem("vhslide-deck-v1"),
  );
  await expect(more(page)).toContainText("その他");
  await expect(
    page.getByRole("button", { name: "更新履歴", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "使い方", exact: true }),
  ).toHaveCount(0);
  for (const name of ["ファイル", "発表する", "発表方法を選ぶ"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await more(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem")).toHaveCount(2);
  await page.getByRole("menuitem", { name: "更新履歴", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "更新履歴", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more(page)).toBeFocused();
  expect(
    await page.evaluate(() => localStorage.getItem("vhslide-deck-v1")),
  ).toBe(before);
  await more(page).click();
  await page.getByRole("menuitem", { name: "使い方", exact: true }).click();
  const help = page.getByRole("complementary", { name: "使い方", exact: true });
  await expect(help).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使い方を閉じる", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(more(page)).toBeFocused();
});
test("menu keyboard navigation, outside dismissal and history browser-back preserve the workspace", async ({
  page,
}) => {
  await more(page).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    menu(page).getByRole("menuitem", { name: "更新履歴", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    menu(page).getByRole("menuitem", { name: "使い方", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Escape");
  await expect(more(page)).toBeFocused();
  await more(page).click();
  await page.keyboard.press("Tab");
  await expect(menu(page)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.activeElement?.closest('[role="menu"]') === null,
    ),
  ).toBe(true);
  await more(page).click();
  await page.locator(".map-summary h1").click();
  await expect(menu(page)).toHaveCount(0);
  await more(page).click();
  await page.getByRole("menuitem", { name: "更新履歴", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "更新履歴", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(more(page)).toBeFocused();
});
test("editor menu is not clipped by the scrolling toolbar and fits Chromebook and small screens", async ({
  page,
}, info) => {
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  const before = await page.evaluate(() =>
    localStorage.getItem("vhslide-deck-v1"),
  );
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 1024, height: 600 },
  ]) {
    await page.setViewportSize(size);
    await more(page).click();
    await expect(menu(page)).toBeVisible();
    expect(
      await menu(page).evaluate(
        (node) => node.closest(".editor-toolbar") === null,
      ),
    ).toBe(true);
    const r = (await menu(page).boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(size.width + 1);
    expect(r.y + r.height).toBeLessThanOrEqual(size.height + 1);
    await page.screenshot({
      path: info.outputPath(`more-editor-${size.width}.png`),
    });
    await page.getByRole("menuitem", { name: "使い方", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "使い方", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "使い方を閉じる", exact: true })
      .click();
    await expect(more(page)).toBeFocused();
    if (info.project.name === "desktop")
      expect(
        (await page.locator(".editor-layout").boundingBox())!.y,
      ).toBeLessThanOrEqual(104);
  }
  expect(
    await page.evaluate(() => localStorage.getItem("vhslide-deck-v1")),
  ).toBe(before);
});
test("direct history links close back to the secondary-menu trigger", async ({
  page,
}) => {
  await page.goto("/#updates");
  await expect(
    page.getByRole("region", { name: "更新履歴", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "アプリに戻る", exact: true }).click();
  await expect(more(page)).toBeFocused();
});

test("help keyboard focus does not delete the selected object", async ({
  page,
}) => {
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  const id = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("vhslide-deck-v1")!,
      ).slides[0].elements.find((e: any) => e.type === "shape").id,
  );
  await page
    .locator(`.editor-page-current .element[data-element-id="${id}"]`)
    .click();
  const before = await page.evaluate(() =>
    localStorage.getItem("vhslide-deck-v1"),
  );
  await more(page).click();
  await page.getByRole("menuitem", { name: "使い方", exact: true }).click();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  expect(
    await page.evaluate(() => localStorage.getItem("vhslide-deck-v1")),
  ).toBe(before);
  await page.keyboard.press("Escape");
  await expect(more(page)).toBeFocused();
  await expect(
    page.locator(`.editor-page-current .element[data-element-id="${id}"]`),
  ).toBeVisible();
});
