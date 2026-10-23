import { test, expect } from "@playwright/test";
import type { Page, Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
const data = (p: Page) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
async function start(page: Page) {
  await page.addInitScript(
    () =>
      !localStorage.getItem("vhslide-deck-v1") &&
      localStorage.setItem(
        "vhslide-deck-v1",
        JSON.stringify({
          version: 1,
          title: "シートとフィルタ",
          slides: Array.from({ length: 8 }, (_, i) => ({
            id: `page-${i}`,
            x: i % 2,
            y: Math.floor(i / 2),
            title: `ページ${Math.floor(i / 2) + 1}.${(i % 2) + 1}`,
            background: "#e5f0dc",
            elements: [],
          })),
        }),
      ),
  );
  await page.goto("/");
}
async function pinch(
  page: Page,
  target: Locator,
  out: boolean,
  touch: boolean,
) {
  const box = (await target.boundingBox())!,
    x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    for (const [type, r] of [
      ["touchStart", 40],
      ["touchMove", out ? 65 : 22],
      ["touchEnd", 0],
    ] as const)
      await cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: r
          ? [
              { id: 1, x: x - r, y },
              { id: 2, x: x + r, y },
            ]
          : [],
      });
  } else
    await target.dispatchEvent("wheel", {
      clientX: x,
      clientY: y,
      deltaY: out ? -30 : 30,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
}
test("filters a column into a balanced grid, retains real numbers, zooms and pinches into the correct editor and back", async ({
  page,
}, info) => {
  await start(page);
  const before = await data(page);
  await button(page, "マップをフィルタ").click();
  await button(page, "フィルタする列1").click();
  await button(page, "フィルタを適用").click();
  await expect(page.locator(".slide-card")).toHaveCount(4);
  const boxes = await Promise.all(
    [0, 2, 4, 6].map((i) =>
      page.locator(`[data-page-id="page-${i}"]`).boundingBox(),
    ),
  );
  expect(boxes[0]!.y).toBeCloseTo(boxes[1]!.y, 0);
  expect(boxes[0]!.x).toBeCloseTo(boxes[2]!.x, 0);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + 30);
  await expect(page.locator('[data-page-id="page-4"] .page-number')).toHaveText(
    "3.1",
  );
  expect((await data(page)).slides).toEqual(before.slides);
  await button(page, "マップを縮小").click();
  await expect(page.locator(".map-scale-reset")).toHaveText("60%");
  await button(page, "マップを縮小").click();
  await expect(page.locator(".map-scale-reset")).toHaveText("番号");
  await expect(page.locator('[data-page-id="page-4"] .number-tile')).toHaveText(
    "3.1",
  );
  await button(page, "マップを拡大").click();
  await button(page, "マップを拡大").click();
  await pinch(
    page,
    page.locator('[data-page-id="page-4"] .thumbnail'),
    true,
    info.project.name === "touch",
  );
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("ページ3.1");
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await pinch(
    page,
    page.locator(".editor-pager"),
    false,
    info.project.name === "touch",
  );
  await expect(page.locator(".map-main")).toBeVisible();
  await expect(page.locator(".slide-card")).toHaveCount(4);
  await button(page, "フィルタ解除").click();
  await expect(page.locator(".slide-card")).toHaveCount(8);
  await button(page, "マップをフィルタ").click();
  await button(page, "フィルタする行3").click();
  await button(page, "フィルタ選択: 1.1 ページ1.1").click();
  await button(page, "フィルタ選択: 4.2 ページ4.2").click();
  await button(page, "フィルタを適用").click();
  await expect(page.locator(".slide-card")).toHaveCount(4);
});
test("sheets add, duplicate, rename, reorder, delete and undo independently and roundtrip through JSON", async ({
  page,
}) => {
  await start(page);
  await button(page, "空のシートを追加").click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".slide-card")).toHaveCount(1);
  await button(page, "あたらしいページを編集").click();
  await page
    .getByRole("textbox", { name: "ページの名前", exact: true })
    .fill("このシートだけ");
  await button(page, "文字").click();
  await page
    .getByRole("textbox", { name: "スライド内の文字", exact: true })
    .fill("シート固有の内容");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "シート1", exact: true }).click();
  await button(page, "全体マップへ").click();
  await expect(page.locator(".slide-card")).toHaveCount(8);
  await expect(page.locator(".map-main")).not.toContainText("シート固有の内容");
  await page.getByRole("tab", { name: "シート2", exact: true }).click();
  await button(page, "シートの操作").click();
  await button(page, "このシートを複製").click();
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.locator(".slide-card")).toHaveCount(1);
  await button(page, "シートの操作").click();
  await page
    .getByRole("textbox", { name: "シート名", exact: true })
    .fill("別の練習");
  await button(page, "名前を変更").click();
  await button(page, "シートの操作").click();
  await button(page, "シートを左へ移動").click();
  await button(page, "閉じる").click();
  expect(await page.getByRole("tab").allTextContents()).toEqual([
    "シート1",
    "別の練習",
    "シート2",
  ]);
  await button(page, "シートの操作").click();
  await button(page, "このシートを削除").click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await button(page, "もとに戻す").click();
  await expect(page.getByRole("tab")).toHaveCount(3);
  const download = page.waitForEvent("download");
  await button(page, "保存").click();
  const file = await download,
    book = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(book.sheets.map((s: any) => s.name)).toEqual([
    "シート1",
    "別の練習",
    "シート2",
  ]);
  expect(book.slides).toHaveLength(10);
  expect(new Set(book.slides.map((s: any) => s.id)).size).toBe(10);
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "sheets.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(book)),
    });
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "別の練習", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".map-main")).toContainText("シート固有の内容");
});
test("a requested number of row copies is created atomically and one undo restores the grid", async ({
  page,
}) => {
  await start(page);
  await button(page, "ページ1.1を編集").click();
  const before = await data(page);
  await button(page, "2段目のメニュー").click();
  await page
    .getByRole("spinbutton", { name: "複製する段の数", exact: true })
    .fill("3");
  await page
    .getByRole("menuitem", { name: "指定数の段を複製", exact: true })
    .click();
  await expect(page.locator(".rail-trigger")).toHaveCount(7);
  expect((await data(page)).slides).toHaveLength(14);
  await button(page, "もとに戻す").click();
  expect((await data(page)).slides).toEqual(before.slides);
});
