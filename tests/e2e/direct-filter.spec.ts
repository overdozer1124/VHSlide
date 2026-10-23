import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
const data = (p: Page) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
async function start(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem("vhslide-deck-v1"))
      localStorage.setItem(
        "vhslide-deck-v1",
        JSON.stringify({
          version: 1,
          title: "直接選択",
          slides: Array.from({ length: 12 }, (_, i) => ({
            id: `page-${i}`,
            x: i % 4,
            y: Math.floor(i / 4),
            title: `ページ${Math.floor(i / 4) + 1}.${(i % 4) + 1}`,
            background: "#e5f0dc",
            elements: [],
          })),
        }),
      );
  });
  await page.goto("/");
  await button(page, "マップをフィルタ").click();
}
const pick = (page: Page, no: string) =>
  button(page, `フィルタ選択: ${no} ページ${no}`);
async function selectThree(page: Page) {
  for (const n of ["1.1", "1.4", "3.4"]) await pick(page, n).click();
  await button(page, "フィルタを適用").click();
}
const name = (p: Page) =>
  p.getByRole("textbox", { name: "ページの名前", exact: true });

test("selects actual column/row headers and thumbnails, supports exclusions, and cancels without changing the applied filter", async ({
  page,
}) => {
  await start(page);
  const before = await data(page);
  await expect(
    page
      .getByRole("region", { name: "マップのフィルタ設定" })
      .getByRole("textbox"),
  ).toHaveCount(0);
  await button(page, "フィルタする列3").click();
  await expect(button(page, "フィルタする列3")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("3ページ選択中", { exact: true })).toBeVisible();
  await pick(page, "2.3").click();
  await expect(button(page, "フィルタする列3")).toHaveAttribute(
    "aria-pressed",
    "mixed",
  );
  await expect(pick(page, "2.3")).toHaveAttribute("aria-pressed", "false");
  await button(page, "フィルタする行2").click();
  await expect(page.getByText("6ページ選択中", { exact: true })).toBeVisible();
  await pick(page, "1.1").click();
  await button(page, "フィルタする行2").click();
  await expect(page.getByText("3ページ選択中", { exact: true })).toBeVisible();
  await button(page, "フィルタを適用").click();
  await expect(page.locator(".slide-card")).toHaveCount(3);
  expect((await data(page)).slides).toEqual(before.slides);
  await button(page, "マップをフィルタ").click();
  await expect(page.locator(".slide-card")).toHaveCount(12);
  await button(page, "選択をクリア").click();
  await expect(button(page, "フィルタを適用")).toBeDisabled();
  await button(page, "キャンセル").click();
  await expect(page.locator(".slide-card")).toHaveCount(3);
  await button(page, "ページ1.1を編集").click();
  await expect(page.locator(".rail-trigger")).toHaveCount(2);
});

test("editing keeps only selected pages in the rail, flyout, keys and touch swipes, while saving every original page", async ({
  page,
}, info) => {
  await start(page);
  await selectThree(page);
  await button(page, "ページ1.1を編集").click();
  await expect(page.locator(".rail-trigger")).toHaveCount(2);
  await expect(button(page, "編集画面にもフィルタを適用")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await button(page, "1段目の横のページをひらく").click();
  await expect(page.locator(".row-page")).toHaveCount(2);
  await expect(page.locator(".row-page-empty")).toHaveCount(0);
  await button(page, "1.1 ページ1.1を編集").click();
  await page.keyboard.press("ArrowRight");
  await expect(name(page)).toHaveValue("ページ1.4");
  await page.keyboard.press("ArrowDown");
  await expect(name(page)).toHaveValue("ページ3.4");
  await page.keyboard.press("ArrowUp");
  await expect(name(page)).toHaveValue("ページ1.4");
  await page.keyboard.press("ArrowLeft");
  await expect(name(page)).toHaveValue("ページ1.1");
  if (info.project.name === "touch") {
    await expect(page.locator(".workspace-flight")).toHaveCount(0);
    const box = (await page.locator(".editor-pager").boundingBox())!,
      cdp = await page.context().newCDPSession(page),
      x = box.x + box.width * 0.85,
      y = box.y + box.height * 0.75;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x, y }],
    });
    for (let i = 1; i <= 10; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ id: 1, x: x - (box.width * 0.7 * i) / 10, y }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(name(page)).toHaveValue("ページ1.4");
  }
  await name(page).fill("表示中を編集");
  const book = await data(page);
  expect(book.slides).toHaveLength(12);
  expect(book.slides.find((s: any) => s.id === "page-1").title).toBe(
    "ページ1.2",
  );
  await button(page, "編集画面にもフィルタを適用").click();
  await expect(page.locator(".rail-trigger")).toHaveCount(3);
  await button(page, "1段目の横のページをひらく").click();
  await expect(page.locator(".row-page")).toHaveCount(4);
  await button(page, "編集画面にもフィルタを適用").click();
  await expect(page.locator(".rail-trigger")).toHaveCount(2);
  await button(page, "全体マップへ").click();
  await expect(page.locator(".slide-card")).toHaveCount(3);
  await button(page, "フィルタ解除").click();
  await expect(page.locator(".slide-card")).toHaveCount(12);
});

test("can keep the map filtered and independently enable or disable the editor filter, including sparse linked rows", async ({
  page,
}) => {
  await start(page);
  await pick(page, "1.2").click();
  await pick(page, "3.4").click();
  await page
    .getByRole("checkbox", { name: "編集画面にもフィルタを適用", exact: true })
    .uncheck();
  await button(page, "フィルタを適用").click();
  await button(page, "ページ1.2を編集").click();
  await expect(page.locator(".rail-trigger")).toHaveCount(3);
  await button(page, "編集画面にもフィルタを適用").click();
  await expect(page.locator(".rail-trigger")).toHaveCount(2);
  await page.getByRole("switch", { name: "縦の連動", exact: true }).click();
  await expect(page.locator(".rail-empty")).toHaveCount(0);
  await button(page, "3段目の横のページをひらく").click();
  await expect(page.locator(".row-page")).toHaveCount(1);
  await button(page, "3.4 ページ3.4を編集").click();
  await expect(name(page)).toHaveValue("ページ3.4");
  await button(page, "全体マップへ").click();
  await expect(page.locator(".slide-card")).toHaveCount(2);
});

test("deleting the last selected pages shows an empty editor without exposing or removing unselected data, and supports undo", async ({
  page,
}) => {
  await start(page);
  await pick(page, "1.1").click();
  await pick(page, "1.2").click();
  await button(page, "フィルタを適用").click();
  await button(page, "ページ1.1を編集").click();
  for (let i = 0; i < 2; i++) {
    await button(page, "1段目のメニュー").click();
    await expect(
      page.getByRole("menuitem", { name: "この段をまとめて削除", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("menuitem", { name: "このページを削除", exact: true })
      .click();
  }
  await expect(page.locator(".filtered-editor-empty")).toBeVisible();
  await expect(page.locator(".editor-pager")).toHaveCount(0);
  expect((await data(page)).slides).toHaveLength(10);
  await button(page, "もとに戻す").click();
  await expect(page.locator(".editor-pager")).toBeVisible();
  await expect(page.locator(".rail-trigger")).toHaveCount(1);
  expect((await data(page)).slides).toHaveLength(11);
});
