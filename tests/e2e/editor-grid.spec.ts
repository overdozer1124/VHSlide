import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
async function openEditor(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
}
const readDeck = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));

test("hover previews a row without resizing the editor, and remains open across the pointer bridge", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "マウス用のチェック");
  await openEditor(page);
  const rail = page.getByRole("complementary", { name: "縦横のページ一覧" });
  const beforeRail = await rail.boundingBox(),
    beforeCanvas = await page
      .locator(".editor-workspace > .canvas-scale")
      .boundingBox();
  const row = page.getByRole("button", { name: "1段目の横のページをひらく" });
  await row.hover();
  const popup = page.getByRole("region", { name: "1段目の横のページ一覧" });
  await expect(popup).toBeVisible();
  await expect(popup.locator(".row-page")).toHaveCount(3);
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "わたしたちのまち",
  );
  expect(await rail.boundingBox()).toEqual(beforeRail);
  expect(
    await page.locator(".editor-workspace > .canvas-scale").boundingBox(),
  ).toEqual(beforeCanvas);
  const target = popup.getByRole("button", {
    name: "2.1 自然がいっぱいを編集",
    exact: true,
  });
  await target.hover();
  // Deliberately exceed the pointer-leave grace period to detect a disappearing flyout.
  await page.waitForTimeout(450);
  await expect(popup).toBeVisible();
  await target.click();
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "自然がいっぱい",
  );
  await expect(rail.locator(".rail-heading strong")).toHaveText("話題 2");
  await expect(target).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: testInfo.outputPath("expanded-row.png") });
  await page.mouse.move(1100, 800);
  await expect(popup).toBeHidden();
});

test("row and column insertion edits the new page, preserves other pages, and supports undo", async ({
  page,
}, testInfo) => {
  await openEditor(page);
  const before = await readDeck(page);
  const open = page.getByRole("button", { name: "1段目の横のページをひらく" });
  if (testInfo.project.name === "touch") await open.tap();
  else await open.click();
  await page
    .getByRole("button", { name: "1番目の話題の右に列を挿入", exact: true })
    .click();
  let after = await readDeck(page);
  expect(after.slides).toHaveLength(6);
  expect(after.slides.at(-1)).toMatchObject({ x: 1, y: 0 });
  expect(after.slides.find((s: any) => s.title === "自然がいっぱい").x).toBe(2);
  expect(after.slides.find((s: any) => s.title === "お気に入りの公園").x).toBe(
    2,
  );
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "あたらしいページ",
  );
  await expect(page.locator(".row-flyout")).toHaveCount(0);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  expect(await readDeck(page)).toEqual(before);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await page
    .getByRole("button", { name: "1段目の下に行を挿入", exact: true })
    .click();
  after = await readDeck(page);
  expect(after.slides).toHaveLength(7);
  expect(after.slides.at(-1)).toMatchObject({ x: 1, y: 1 });
  expect(
    after.slides.find((s: any) => s.title === "まちを歩いてみたら").y,
  ).toBe(2);
  expect(after.slides.find((s: any) => s.title === "お気に入りの公園").y).toBe(
    2,
  );
  await expect(
    page.locator(".rail-trigger.rail-active .rail-coordinate"),
  ).toHaveText("2.2");
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await expect(page.locator(".slide-card")).toHaveCount(7);
  await page.reload();
  expect((await readDeck(page)).slides).toEqual(after.slides);
});

test("sparse rows stay in their real positions and empty cells can be filled", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("vhslide-deck-v1")!);
    d.slides.find((s: any) => s.title === "まちを歩いてみたら").y = 3;
    localStorage.setItem("vhslide-deck-v1", JSON.stringify(d));
  });
  await page.reload();
  await page
    .getByRole("button", { name: "人とつながるを編集", exact: true })
    .click();
  await expect(page.locator(".rail-trigger")).toHaveCount(4);
  await expect(page.locator(".rail-trigger").nth(2)).toContainText("空のマス");
  const trigger = page.getByRole("button", {
    name: "3段目の横のページをひらく",
  });
  if (testInfo.project.name === "touch") await trigger.tap();
  else await trigger.click();
  const popup = page.getByRole("region", { name: "3段目の横のページ一覧" });
  await expect(popup.locator(".row-page-empty")).toHaveCount(3);
  await popup
    .getByRole("button", { name: "3.3の空のマスにページを追加", exact: true })
    .click();
  const data = await readDeck(page);
  expect(data.slides.at(-1)).toMatchObject({ x: 2, y: 2 });
  expect(
    data.slides.find((s: any) => s.title === "まちを歩いてみたら"),
  ).toMatchObject({ x: 0, y: 3 });
  await expect(
    page.locator(".rail-trigger.rail-active .rail-coordinate"),
  ).toHaveText("3.3");
});

test("keyboard focus opens the row, Escape restores focus, and outside clicks dismiss it", async ({
  page,
}) => {
  await openEditor(page);
  const row = page.getByRole("button", { name: "1段目の横のページをひらく" });
  await row.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".row-flyout")).toBeVisible();
  await expect(page.locator(".row-flyout [aria-current=page]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".row-flyout")).toHaveCount(0);
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".row-flyout")).toBeVisible();
  await page
    .getByRole("button", { name: "2.1 自然がいっぱいを編集", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.row-flyout [aria-current="page"]')).toBeFocused();
  await expect(
    page.locator('.row-flyout [aria-current="page"]'),
  ).toHaveAccessibleName("2.1 自然がいっぱいを編集");
  await page.getByRole("textbox", { name: "ページの名前" }).click();
  await expect(page.locator(".row-flyout")).toHaveCount(0);
});

test("narrow screens retain a slim rail and long rows scroll within the flyout", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("vhslide-deck-v1")!);
    for (let x = 3; x < 10; x++)
      d.slides.push({
        id: `extra-${x}`,
        x,
        y: 0,
        title: `話題${x + 1}`,
        background: "#ffffff",
        elements: [],
      });
    localStorage.setItem("vhslide-deck-v1", JSON.stringify(d));
  });
  await page.reload();
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  const rail = page.locator(".two-d-rail");
  expect((await rail.boundingBox())!.width).toBe(96);
  const canvas = await page
    .locator(".editor-workspace > .canvas-scale")
    .boundingBox();
  const trigger = page.getByRole("button", {
    name: "1段目の横のページをひらく",
  });
  if (testInfo.project.name === "touch") await trigger.tap();
  else await trigger.click();
  const popup = page.locator(".row-flyout");
  await expect(popup).toBeVisible();
  expect(
    (await popup.boundingBox())!.x + (await popup.boundingBox())!.width,
  ).toBeLessThanOrEqual(600);
  await popup
    .getByRole("button", { name: "10.1 話題10を編集", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "話題10",
  );
  expect(
    await page.locator(".editor-workspace > .canvas-scale").boundingBox(),
  ).toEqual(canvas);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(600);
  await page.screenshot({
    path: testInfo.outputPath("narrow-expanded-row.png"),
    fullPage: true,
  });
});

test("touch selection keeps the horizontal row open until tapping outside", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "touch", "実タップ用のチェック");
  await openEditor(page);
  await page.getByRole("button", { name: "2段目の横のページをひらく" }).tap();
  const popup = page.getByRole("region", { name: "2段目の横のページ一覧" });
  await popup
    .getByRole("button", { name: "2.2 お気に入りの公園を編集", exact: true })
    .tap();
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "お気に入りの公園",
  );
  await expect(popup).toBeVisible();
  await expect(page.locator(".rail-heading strong")).toHaveText("話題 2");
  await page.getByRole("button", { name: "文字", exact: true }).tap();
  await expect(popup).toBeHidden();
  await expect(page.locator(".selected-element")).toContainText(
    "ここにことばを入力",
  );
});
