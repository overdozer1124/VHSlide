import { test, expect, type Page } from "@playwright/test";
import { blank, type Deck } from "../../src/model";
import { createDiagram } from "../../src/diagramTemplates";
let seq = 0;
const es = createDiagram("process", () => `object-${++seq}`);
const initial: Deck = {
  version: 1,
  title: "構造テスト",
  sheets: [
    { id: "main", name: "基本" },
    { id: "second", name: "別のシート" },
  ],
  activeSheetId: "main",
  slides: [
    { ...blank(0, 0), id: "start", title: "構造テスト", elements: es },
    { ...blank(1, 0), id: "end", title: "到着ページ" },
    {
      ...blank(0, 0),
      sheetId: "second",
      id: "cross",
      title: "別シートの目的地",
    },
  ],
};
const canvas = (p: Page) => p.locator(".editor-page-current .slide-canvas");
const object = (p: Page, id: string) =>
  canvas(p).locator(`.element[data-element-id="${id}"]`);
const saved = (p: Page) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
async function drag(
  p: Page,
  touch: boolean,
  x: number,
  y: number,
  dx: number,
  dy: number,
  alt = false,
) {
  if (!touch) {
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x + dx, y + dy, { steps: 8 });
    await p.mouse.up();
    return;
  }
  const c = await p.context().newCDPSession(p);
  await c.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    modifiers: alt ? 1 : 0,
    touchPoints: [{ id: 1, x, y }],
  });
  for (let i = 1; i <= 8; i++)
    await c.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      modifiers: alt ? 1 : 0,
      touchPoints: [{ id: 1, x: x + (dx * i) / 8, y: y + (dy * i) / 8 }],
    });
  await c.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    modifiers: alt ? 1 : 0,
    touchPoints: [],
  });
  await c.detach();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript((d) => {
    if (!localStorage.getItem("vhslide-deck-v1"))
      localStorage.setItem("vhslide-deck-v1", JSON.stringify(d));
  }, initial);
  await page.goto("/");
  await page
    .getByRole("button", { name: "構造テストを編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
});
test("group selection moves together, members edit directly, resize and undo work", async ({
  page,
}, info) => {
  const node = es.find((e) => e.type === "shape")!;
  await object(page, node.id).click();
  await expect(canvas(page).locator(".element.selected-element")).toHaveCount(
    es.length,
  );
  const before = (await saved(page)).slides.find(
    (s: any) => s.id === "start",
  ).elements;
  const r = await canvas(page)
    .locator('.group-selection-box [data-resize-direction="w"]')
    .boundingBox();
  await page.keyboard.down("Alt");
  await drag(
    page,
    info.project.name === "touch",
    r!.x + r!.width / 2,
    r!.y + r!.height / 2,
    15,
    20,
    true,
  );
  await page.keyboard.up("Alt");
  await expect
    .poll(
      async () =>
        (await saved(page)).slides
          .find((s: any) => s.id === "start")
          .elements.find((e: any) => e.id === node.id).x,
    )
    .toBeGreaterThan(node.x);
  const after = (await saved(page)).slides.find(
    (s: any) => s.id === "start",
  ).elements;
  const delta = after.find((e: any) => e.id === node.id).x - node.x;
  expect(after.find((e: any) => e.id === es[0].id).x - before[0].x).toBeCloseTo(
    delta,
  );
  await object(page, node.id).dblclick();
  const text = object(page, node.id).getByRole("textbox");
  await expect(text).toBeVisible();
  await text.fill("手順を直接編集");
  await text.press("Escape");
  await page
    .getByRole("button", { name: "グループ全体を選択", exact: true })
    .click();
  const h = canvas(page).getByRole("button", {
    name: "選択全体のサイズを変更",
  });
  const hr = await h.boundingBox();
  await drag(
    page,
    info.project.name === "touch",
    hr!.x + hr!.width / 2,
    hr!.y + hr!.height / 2,
    -30,
    -20,
  );
  await expect
    .poll(
      async () =>
        (await saved(page)).slides
          .find((s: any) => s.id === "start")
          .elements.find((e: any) => e.id === node.id).w,
    )
    .toBeLessThan(node.w);
  await page
    .getByRole("button", { name: "グループを解除", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await saved(page)).slides
        .find((s: any) => s.id === "start")
        .elements.some((e: any) => e.groupId),
    )
    .toBe(false);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect
    .poll(async () =>
      (await saved(page)).slides
        .find((s: any) => s.id === "start")
        .elements.some((e: any) => e.groupId),
    )
    .toBe(true);
});
test("connector settings follow a separately moved target and detach safely", async ({
  page,
}, info) => {
  const line = es.find((e) => e.type === "line")!,
    node = es.find((e) => e.type === "shape")!;
  await object(page, node.id).click();
  await page
    .getByRole("button", { name: "グループを解除", exact: true })
    .click();
  await object(page, line.id).click();
  await expect(page.getByLabel("始点の接続先", { exact: true })).toHaveValue(
    node.id,
  );
  await object(page, node.id).click();
  const r = await object(page, node.id)
    .locator('[data-resize-direction="w"]')
    .boundingBox();
  await page.keyboard.down("Alt");
  await drag(
    page,
    info.project.name === "touch",
    r!.x + r!.width / 2,
    r!.y + r!.height / 2,
    -20,
    20,
    true,
  );
  await page.keyboard.up("Alt");
  await expect
    .poll(
      async () =>
        (await saved(page)).slides
          .find((s: any) => s.id === "start")
          .elements.find((e: any) => e.id === node.id).y,
    )
    .toBeGreaterThan(node.y);
  const data = (await saved(page)).slides.find(
      (s: any) => s.id === "start",
    ).elements,
    n = data.find((e: any) => e.id === node.id),
    l = data.find((e: any) => e.id === line.id);
  expect(l.x + (l.w * l.lineStart.x) / 100).toBeCloseTo(n.x + n.w);
  expect(l.y + (l.h * l.lineStart.y) / 100).toBeCloseTo(n.y + n.h / 2);
  await object(page, line.id).click();
  await page
    .getByRole("button", { name: "両端の接続を解除", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await saved(page)).slides
          .find((s: any) => s.id === "start")
          .elements.find((e: any) => e.id === line.id).startAnchor,
    )
    .toBeUndefined();
});
test("chart data and type persist, render in presentation and print", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "もっと見る（図解・グラフ）", exact: true })
    .click();
  await page.getByRole("button", { name: "グラフ", exact: true }).click();
  await page
    .getByRole("button", { name: "棒グラフを追加", exact: true })
    .click();
  await page
    .getByLabel("グラフのタイトル", { exact: true })
    .fill("みんなの意見");
  const v = page.getByRole("spinbutton", {
    name: "グラフ項目1の値",
    exact: true,
  });
  await v.fill("55");
  await v.press("Tab");
  await page.getByLabel("グラフの種類", { exact: true }).selectOption("pie");
  await expect(
    canvas(page).getByRole("img", { name: "みんなの意見", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await saved(page)).slides
          .find((s: any) => s.id === "start")
          .elements.at(-1).chart.series[0].value,
    )
    .toBe(55);
  await page.reload();
  await page
    .getByRole("button", { name: "構造テストを編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await expect(
    canvas(page).getByRole("img", { name: "みんなの意見", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  await expect(
    page
      .locator(".present-mode")
      .getByRole("img", { name: "みんなの意見", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  await page.getByRole("menuitem", { name: /^PDFで保存/ }).click();
  await page.getByRole("button", { name: "選択を解除", exact: true }).click();
  await page
    .getByLabel("対象スライド")
    .locator('[data-choice="start"]')
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".print-export .chart-graphic")).toHaveCount(1);
  const pdf = await page.pdf({
    path: test.info().outputPath("chart.pdf"),
    printBackground: true,
    preferCSSPageSize: true,
  });
  expect([
    ...pdf.toString("latin1").matchAll(/\/Type\s*\/Page\b/g),
  ]).toHaveLength(1);
  await test
    .info()
    .attach("グラフPDF", { body: pdf, contentType: "application/pdf" });
});
test("internal links select another sheet, present jump/back work", async ({
  page,
}) => {
  const node = es.find((e) => e.type === "shape")!;
  await object(page, node.id).dblclick();
  await object(page, node.id).getByRole("textbox").press("Escape");
  await page.getByRole("tab", { name: "リンク", exact: true }).click();
  await page.getByRole("button", { name: "移動先を選ぶ", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "リンク先のページを選ぶ" });
  await dialog
    .getByLabel("リンク先のシート", { exact: true })
    .selectOption("second");
  await dialog
    .getByRole("button", { name: "1.1 別シートの目的地にリンク", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await saved(page)).slides
          .find((s: any) => s.id === "start")
          .elements.find((e: any) => e.id === node.id).link?.slideId,
    )
    .toBe("cross");
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  await page
    .locator(".present-mode")
    .locator(`.element[data-element-id="${node.id}"]`)
    .click({ position: { x: 12, y: 12 } });
  const confirmation = page.getByRole("dialog", {
    name: "発表対象外のリンク",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "リンク先を開く", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator(".present-caption")).toContainText(
    "別シートの目的地",
  );
  await page.locator(".present-mode").hover();
  await page
    .getByRole("button", { name: "リンク元へ戻る", exact: true })
    .click({ force: true });
  await expect(
    page
      .locator(".present-mode")
      .locator(`.element[data-element-id="${node.id}"]`),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("構造テスト");
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await canvas(page)
    .locator(`.element[data-element-id="${node.id}"]`)
    .click({ modifiers: ["Control"], position: { x: 12, y: 12 } });
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("別シートの目的地");
});
test("structure palette remains usable in Chromebook and narrow layouts", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1366, height: 610 },
    { width: 1024, height: 640 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const b = page.getByRole("button", {
      name: "もっと見る（図解・グラフ）",
      exact: true,
    });
    await b.scrollIntoViewIfNeeded();
    await b.click();
    const card = page.getByRole("button", {
      name: "比較の図解を追加",
      exact: true,
    });
    const r = await card.boundingBox();
    expect(r!.x).toBeGreaterThanOrEqual(0);
    expect(r!.y).toBeGreaterThanOrEqual(0);
    expect(r!.x + r!.width).toBeLessThanOrEqual(viewport.width);
    expect(r!.y + r!.height).toBeLessThanOrEqual(viewport.height);
    await expect(card).toBeInViewport();
    if (viewport.width === 1366)
      await test.info().attach("図解パレット", {
        body: await page.screenshot({
          path: test.info().outputPath("palette.png"),
        }),
        contentType: "image/png",
      });
    await card.click();
    await expect(canvas(page).locator(".element.selected-element")).toHaveCount(
      7,
    );
  }
});

test("a deleted destination never opens another room or loses the current page", async ({
  page,
}) => {
  const d = await saved(page);
  const source = d.slides.find((s: any) => s.id === "start");
  source.elements[0].link = { slideId: "deleted-page" };
  await page.evaluate(
    (d) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(d)),
    d,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "構造テストを編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await canvas(page)
    .locator('.element[data-object-link="true"]')
    .first()
    .click({ modifiers: ["Control"], position: { x: 12, y: 12 } });
  await expect(
    page.getByText("リンク先のページが見つかりません。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("構造テスト");
  expect(new URL(page.url()).searchParams.get("room")).toBeNull();
});
