import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const data = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
async function editor(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
}
const title = (page: Page) =>
  page.getByRole("textbox", { name: "ページの名前", exact: true });

test("linked rows can be toggled, navigate within a topic, restore independent choices and persist", async ({
  page,
}) => {
  await editor(page);
  const link = page.getByRole("switch", { name: "縦の連動" });
  await expect(link).not.toBeChecked();
  await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  await page
    .getByRole("button", { name: "1.3 人とつながるを編集", exact: true })
    .click();
  const choices = (await data(page)).rowSelections;
  const width = (await page.locator(".two-d-rail").boundingBox())!.width;
  await link.click();
  await expect(link).toBeChecked();
  await expect(page.locator(".rail-trigger").nth(1)).toContainText("空のマス");
  await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  await page
    .getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true })
    .click();
  await expect(page.locator(".rail-trigger").nth(1)).toContainText(
    "お気に入りの公園",
  );
  await page.keyboard.press("ArrowDown");
  await expect(title(page)).toHaveValue("お気に入りの公園");
  expect((await data(page)).rowSelections).toEqual(choices);
  await page.keyboard.press("ArrowUp");
  await expect(title(page)).toHaveValue("自然がいっぱい");
  await link.click();
  await expect(title(page)).toHaveValue("人とつながる");
  await expect(page.locator(".rail-trigger").nth(1)).toContainText(
    "まちを歩いてみたら",
  );
  expect((await page.locator(".two-d-rail").boundingBox())!.width).toBe(width);
  await link.click();
  const saved = await data(page);
  await page.reload();
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  await expect(link).toBeChecked();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "linked.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(saved)),
    });
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  await expect(link).toBeChecked();
});

test("right-click duplicates one page without altering adjacent rows, and deletion is undoable", async ({
  page,
}) => {
  await editor(page);
  const before = await data(page);
  await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  await page
    .getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true })
    .click({ button: "right" });
  const menu = page.getByRole("menu", { name: "ページの操作", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(2);
  // The portal menu must stay usable even after leaving the thumbnail flyout.
  await page.mouse.move(1200, 800);
  await page.waitForTimeout(400);
  await menu
    .getByRole("menuitem", { name: "このページを複製", exact: true })
    .click();
  await expect(title(page)).toHaveValue("自然がいっぱい のコピー");
  const copied = await data(page);
  expect(copied.slides).toHaveLength(6);
  expect(copied.slides.filter((s: any) => s.y === 1)).toEqual(
    before.slides.filter((s: any) => s.y === 1),
  );
  const copy = copied.slides.at(-1);
  expect(copy).toMatchObject({ x: 2, y: 0 });
  expect(copy.elements.map((e: any) => e.id)).not.toEqual(
    before.slides[1].elements.map((e: any) => e.id),
  );
  await title(page).fill("コピーだけ変更");
  expect(
    (await data(page)).slides.find((s: any) => s.id === before.slides[1].id)
      .title,
  ).toBe("自然がいっぱい");
  await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  await page
    .getByRole("button", { name: "1.3 コピーだけ変更を編集", exact: true })
    .click({ button: "right" });
  const preDelete = await data(page);
  await page
    .getByRole("menuitem", { name: "このページを削除", exact: true })
    .click();
  expect((await data(page)).slides.some((s: any) => s.id === copy.id)).toBe(
    false,
  );
  await expect(title(page)).toBeVisible();
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  expect(await data(page)).toEqual(preDelete);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  expect((await data(page)).slides.some((s: any) => s.id === copy.id)).toBe(
    false,
  );
});

test("left thumbnails duplicate and delete whole groups with one undo", async ({
  page,
}) => {
  await editor(page);
  const before = await data(page);
  await page.locator(".rail-trigger").first().click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "1段目の操作", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("menuitem", { name: "この段をまとめて複製", exact: true })
    .click();
  const copied = await data(page);
  expect(copied.slides).toHaveLength(8);
  for (const original of before.slides)
    expect(copied.slides.find((s: any) => s.id === original.id)).toMatchObject({
      x: original.x,
      y: original.y > 0 ? original.y + 1 : 0,
    });
  expect(copied.slides.filter((s: any) => s.y === 1)).toHaveLength(3);
  await expect(page.locator(".rail-trigger")).toHaveCount(3);
  await page
    .getByRole("button", { name: "2段目のメニュー", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "この段をまとめて削除", exact: true })
    .click();
  const deleted = await data(page);
  expect(deleted.slides).toEqual(before.slides);
  await expect(page.locator(".rail-trigger")).toHaveCount(2);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  expect(await data(page)).toEqual(copied);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  expect((await data(page)).slides).toEqual(before.slides);
});

test("map menus support keyboard navigation, Escape, outside dismissal and origin deletion", async ({
  page,
}) => {
  await page.goto("/");
  const before = await data(page);
  const more = page.getByRole("button", {
    name: "わたしたちのまちのページメニュー",
    exact: true,
  });
  await more.click();
  await expect(
    page.getByRole("menuitem", { name: "このページを複製", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "このページを削除", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(more).toBeFocused();
  await more.click();
  await page
    .getByRole("heading", { name: "アイデアを、つなげよう。", exact: true })
    .click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await data(page)).toEqual(before);
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "このページを削除", exact: true })
    .click();
  const deleted = await data(page);
  expect(deleted.slides).toHaveLength(4);
  expect(deleted.slides.some((s: any) => s.x === 0 && s.y === 0)).toBe(true);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  expect(await data(page)).toEqual(before);
});

test("touch menu buttons work within a narrow viewport without widening the rail", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "タッチ操作のチェック");
  await page.setViewportSize({ width: 390, height: 844 });
  await editor(page);
  await page
    .getByRole("button", { name: "2段目のメニュー", exact: true })
    .tap();
  const menu = page.getByRole("menu", { name: "2段目の操作", exact: true });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page
    .getByRole("menuitem", { name: "この段をまとめて複製", exact: true })
    .tap();
  await expect(page.locator(".rail-trigger")).toHaveCount(3);
  expect((await page.locator(".two-d-rail").boundingBox())!.width).toBe(96);
  await page.getByRole("switch", { name: "縦の連動" }).tap();
  await expect(page.getByRole("switch", { name: "縦の連動" })).toBeChecked();
});
