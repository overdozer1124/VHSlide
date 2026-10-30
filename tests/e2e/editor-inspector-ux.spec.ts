import { test, expect, type Page } from "@playwright/test";
import { blank, type Deck } from "../../src/model";
import { createTable } from "../../src/tableData";
let n = 0;
const deck: Deck = {
  version: 1,
  title: "設定の使い勝手",
  slides: [
    {
      ...blank(0, 0),
      id: "ux",
      title: "設定の使い勝手",
      elements: [
        {
          id: "table",
          type: "table",
          x: 60,
          y: 170,
          w: 570,
          h: 300,
          table: createTable(3, 3, () => `cell-${++n}`),
          fontSize: 24,
          color: "#173d38",
          fill: "#ffffff",
          stroke: "#729276",
        },
        {
          id: "shape",
          type: "shape",
          shape: "rect",
          x: 700,
          y: 200,
          w: 130,
          h: 120,
          fill: "#b8d394",
          stroke: "#173d38",
        },
        {
          id: "text",
          type: "text",
          x: 80,
          y: 40,
          w: 700,
          h: 80,
          text: "ここにことばを入力",
          fontSize: 32,
          color: "#173d38",
        },
      ],
    },
  ],
};
const cell = (p: Page, r = 1, c = 1) =>
  p.getByRole("textbox", { name: `表 ${r}行 ${c}列`, exact: true });
const object = (p: Page, id: string) =>
  p.locator(`.editor-page-current .element[data-element-id="${id}"]`);
const saved = (p: Page) =>
  p.evaluate(
    () =>
      JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0].elements,
  );
test.beforeEach(async ({ page }) => {
  await page.route("**/api/config", (r) =>
    r.fulfill({ json: { clientId: "", notice: "" } }),
  );
  await page.addInitScript((d) => {
    if (!localStorage.getItem("vhslide-deck-v1"))
      localStorage.setItem("vhslide-deck-v1", JSON.stringify(d));
  }, deck);
  await page.goto("/");
  await page
    .getByRole("button", { name: "設定の使い勝手を編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
});
test("cell scrollbars are hidden; empty space focuses input, long text stays editable and fixed in the table", async ({
  page,
}, info) => {
  await cell(page).click();
  await cell(page).fill("ああああ");
  await cell(page, 1, 2).fill("いいい");
  await cell(page, 2, 2).fill("ううう");
  const content = object(page, "table")
      .locator("td")
      .last()
      .locator(".table-cell-content"),
    r = await content.boundingBox();
  if (info.project.name === "touch")
    await page.touchscreen.tap(r!.x + r!.width / 2, r!.y + r!.height - 5);
  else await page.mouse.click(r!.x + r!.width / 2, r!.y + r!.height - 5);
  await expect(cell(page, 3, 3)).toBeFocused();
  await cell(page, 3, 3).fill("長い文\n".repeat(40));
  await cell(page, 3, 3).press("End");
  await cell(page, 3, 3).press("!");
  await expect(cell(page, 3, 3)).toHaveValue(/!/);
  for (const field of await object(page, "table").locator("textarea").all()) {
    expect(
      await field.evaluate((e) => getComputedStyle(e).scrollbarWidth),
    ).toBe("none");
    expect(
      await field.evaluate(
        (e) => getComputedStyle(e, "::-webkit-scrollbar").display,
      ),
    ).toBe("none");
  }
  const before = await saved(page);
  expect(before[0].x).toBe(60);
  expect(before[0].h).toBe(300);
  await page.screenshot({ path: info.outputPath("table-clean-input.png") });
});
test("sidebar retains the chosen section across selection; keyboard tabs and insertion defaults work", async ({
  page,
}, info) => {
  await object(page, "shape").click();
  const tabs = page.getByRole("tablist", { name: "編集設定", exact: true });
  await expect(
    tabs.getByRole("tab", { name: "見た目", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("図形の塗り色", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "最背面へ", exact: true }),
  ).toHaveCount(0);
  await tabs.getByRole("tab", { name: "見た目", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    tabs.getByRole("tab", { name: "配置", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "最背面へ", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("button", { name: "移動先を選ぶ", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.getByLabel("図形の塗り色", { exact: true })).toBeVisible();
  await tabs.getByRole("tab", { name: "配置", exact: true }).click();
  await object(page, "text").click();
  await expect(
    tabs.getByRole("tab", { name: "配置", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "文字", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".inspector-quick-actions")
      .getByRole("button", { name: "複製", exact: true }),
  ).toBeVisible();
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "文字", exact: true })
    .click();
  await expect(
    tabs.getByRole("tab", { name: "見た目", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: info.outputPath("contextual-inspector.png") });
});

test("mixed cell formats are explicit and inspecting them never applies the first cell's values", async ({
  page,
}) => {
  await cell(page).click();
  await page.getByLabel("セルの文字の大きさ", { exact: true }).fill("20");
  await page.getByLabel("セルの文字の大きさ", { exact: true }).press("Tab");
  await page
    .getByLabel("セルの左右揃え", { exact: true })
    .selectOption("center");
  await cell(page, 2, 2).click();
  await page.getByLabel("セルの文字の大きさ", { exact: true }).fill("32");
  await page.getByLabel("セルの文字の大きさ", { exact: true }).press("Tab");
  await page
    .getByRole("button", { name: "セルの範囲を選ぶ", exact: true })
    .click();
  await cell(page).click();
  await cell(page, 2, 2).click();
  const size = page.getByLabel("セルの文字の大きさ", { exact: true });
  await expect(size).toHaveValue("");
  await expect(size).toHaveAttribute("placeholder", "混在");
  await expect(
    page.getByRole("button", { name: "セルを太字", exact: true }),
  ).toHaveAttribute("aria-pressed", "mixed");
  await expect(page.getByLabel("セルの左右揃え", { exact: true })).toHaveValue(
    "mixed",
  );
  const before = await saved(page);
  await size.focus();
  await size.press("Tab");
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
  expect(await saved(page)).toEqual(before);
  await size.fill("36");
  await size.press("Tab");
  await expect(size).toHaveValue("36");
  await page.getByRole("button", { name: "セルを太字", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "セルを太字", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("セルの背景色（混在）", { exact: true }).click();
  await page.getByRole("button", { name: "色を適用", exact: true }).click();
  await expect(
    page.getByLabel("セルの背景色（混在）", { exact: true }),
  ).toHaveCount(0);
  const t = (await saved(page)).find(
    (e: { id: string }) => e.id === "table",
  ).table;
  const keys = [...t.rows.slice(0, 2)].flatMap((r: string) =>
    t.columns.slice(0, 2).map((c: string) => `${r}:${c}`),
  );
  expect(
    keys.every(
      (k: string) => t.styles[k].fontSize === 36 && t.styles[k].bold === true,
    ),
  ).toBe(true);
});
test("table scope follows clicked cells, retains whole-table settings and makes destructive actions deliberate", async ({
  page,
}) => {
  await cell(page).click();
  const scope = page.getByRole("tablist", {
    name: "表の編集対象",
    exact: true,
  });
  await expect(
    scope.getByRole("tab", { name: "セル", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByLabel("セルの文字の大きさ", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("表の文字の大きさ", { exact: true }),
  ).toHaveCount(0);
  await scope.getByRole("tab", { name: "表全体", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "行を追加", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "最後の行を削除", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByText("Excelなどから複数セルを貼り付けできます。", {
      exact: false,
    }),
  ).not.toBeVisible();
  await cell(page).click();
  await expect(
    scope.getByRole("tab", { name: "セル", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "セルの範囲を選ぶ", exact: true })
    .click();
  await cell(page).click();
  await cell(page, 2, 2).click();
  await expect(
    page.getByRole("heading", { name: "4セルを選択中", exact: true }),
  ).toBeVisible();
  await scope.getByRole("tab", { name: "表全体", exact: true }).click();
  await scope.getByRole("tab", { name: "セル", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "セルの範囲を選ぶ", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page
    .getByRole("button", { name: "セルの範囲を選ぶ", exact: true })
    .click();
  await page.getByRole("tab", { name: "配置", exact: true }).click();
  await page.getByRole("tab", { name: "見た目", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "セルの範囲を選ぶ", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  const value = await saved(page);
  await page.getByRole("tab", { name: "配置", exact: true }).focus();
  await page.keyboard.press("Delete");
  expect(await saved(page)).toEqual(value);
});
test("Chromebook and narrow layouts keep tabs and frequent actions physically reachable", async ({
  page,
}, info) => {
  for (const viewport of [
    { width: 1366, height: 610 },
    { width: 1024, height: 640 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await cell(page).click();
    const tab = page.getByRole("tab", { name: "表全体", exact: true });
    await tab.click();
    for (const b of [
      page.getByRole("tab", { name: "見た目", exact: true }),
      page
        .locator(".inspector-quick-actions")
        .getByRole("button", { name: "複製", exact: true }),
      page.getByRole("button", { name: "行を追加", exact: true }),
    ]) {
      const box = await b.boundingBox();
      expect(box!.width).toBeGreaterThan(35);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      if (viewport.width > 760) await expect(b).toBeInViewport();
      if (info.project.name === "touch")
        expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("tab", { name: "セル", exact: true }).click();
    const rangeButton = page.getByRole("button", {
      name: "セルの範囲を選ぶ",
      exact: true,
    });
    if (info.project.name === "touch")
      expect((await rangeButton.boundingBox())!.height).toBeGreaterThanOrEqual(
        44,
      );
    await page.getByRole("tab", { name: "表全体", exact: true }).click();
    if (viewport.width === 1366)
      await page.screenshot({
        path: info.outputPath("chromebook-sidebar.png"),
      });
  }
});
