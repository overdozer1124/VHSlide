import { test, expect, type Page } from "@playwright/test";
import { blank, type Deck } from "../../src/model";
async function drag(
  page: Page,
  touch: boolean,
  x: number,
  y: number,
  dx: number,
  dy: number,
) {
  if (!touch) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, x, y }],
  });
  for (let i = 1; i <= 8; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 1, x: x + (dx * i) / 8, y: y + (dy * i) / 8 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}
const initial: Deck = {
  version: 1,
  title: "表現テスト",
  slides: [
    {
      ...blank(0, 0),
      title: "表現テスト",
      elements: [
        {
          id: "a",
          type: "shape",
          shape: "rect",
          x: 60,
          y: 80,
          w: 120,
          h: 100,
          fill: "#b8d394",
          stroke: "#173d38",
        },
        {
          id: "b",
          type: "shape",
          shape: "circle",
          x: 260,
          y: 160,
          w: 120,
          h: 100,
          fill: "#b8d394",
          stroke: "#173d38",
        },
        {
          id: "c",
          type: "shape",
          shape: "triangle",
          x: 560,
          y: 240,
          w: 120,
          h: 100,
          fill: "#b8d394",
          stroke: "#173d38",
        },
      ],
    },
  ],
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript((d) => {
    if (!localStorage.getItem("vhslide-deck-v1"))
      localStorage.setItem("vhslide-deck-v1", JSON.stringify(d));
  }, initial);
  await page.goto("/");
  await page
    .getByRole("button", { name: "表現テストを編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
});
test("palette inserts labeled shapes and editable arrow endpoints, settings survive reload", async ({
  page,
}, info) => {
  await page.getByRole("button", { name: "図形を追加", exact: true }).click();
  const tile = page.getByRole("button", { name: "三角を追加", exact: true });
  await expect(tile).toBeInViewport();
  await tile.click();
  const canvas = page.locator(".editor-page-current .slide-canvas");
  const item = canvas.locator(".element").last();
  await item.dblclick();
  const input = item.getByRole("textbox");
  await expect(input).toBeVisible();
  await input.fill("直接入力の図形");
  await input.press("Escape");
  await page.getByLabel("塗りなし", { exact: true }).check();
  await page.getByLabel("線の種類", { exact: true }).selectOption("dash");
  await page.getByRole("button", { name: "線を追加", exact: true }).click();
  await page.getByRole("button", { name: "両矢印を追加", exact: true }).click();
  const end = canvas.getByRole("button", { name: "線の終点を移動" });
  const r = await end.boundingBox();
  expect(r).not.toBeNull();
  await drag(
    page,
    info.project.name === "touch",
    r!.x + r!.width / 2,
    r!.y + r!.height / 2,
    60,
    -60,
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem("vhslide-deck-v1")!);
        return d.slides[0].elements.at(-1).lineEnd.y;
      }),
    )
    .toBeLessThan(50);
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0].elements,
  );
  expect(saved[3]).toMatchObject({
    text: "直接入力の図形",
    fill: "none",
    strokeDash: "dash",
  });
  expect(saved[4]).toMatchObject({
    type: "line",
    startArrow: "triangle",
    endArrow: "triangle",
  });
  await page.reload();
  await page
    .getByRole("button", { name: "表現テストを編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await expect(page.locator(".editor-page-current .element")).toHaveCount(5);
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  await expect(page.locator(".present-slide")).toContainText("直接入力の図形");
  await expect(page.locator(".present-slide marker")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("objects-present.png") });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "保存方法を選ぶ", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^PDFで保存/ }).click();
  await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".print-export")).toContainText("直接入力の図形");
  await expect(page.locator(".print-export marker")).toHaveCount(2);
  if (info.project.name === "desktop") {
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      path: info.outputPath("objects.pdf"),
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  }
});
test("explicit multi selection aligns, duplicates, undoes and moves together", async ({
  page,
}, info) => {
  const canvas = page.locator(".editor-page-current .slide-canvas");
  await page.getByRole("button", { name: "まとめて選択", exact: true }).click();
  for (const id of ["a", "b", "c"]) {
    const el = canvas.locator(`[data-element-id="${id}"].element`);
    if (info.project.name === "touch") await el.tap();
    else await el.click();
  }
  await expect(canvas.locator(".selected-element")).toHaveCount(3);
  await page.getByRole("button", { name: "まとめて選択", exact: true }).click();
  await page.getByRole("button", { name: "横に等間隔", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0]
            .elements[1].x,
      ),
    )
    .toBe(310);
  const border = canvas
    .locator('.element[data-element-id="a"] .element-drag-border')
    .first();
  const r = await border.boundingBox();
  expect(r).not.toBeNull();
  await drag(
    page,
    info.project.name === "touch",
    r!.x + r!.width / 2,
    r!.y + r!.height / 2,
    30,
    20,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0]
            .elements[0].x,
      ),
    )
    .toBeGreaterThan(60);
  const positions = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0].elements.map(
      (e: any) => e.x,
    ),
  );
  expect(positions[1] - positions[0]).toBeCloseTo(250);
  await page.getByRole("button", { name: "複製", exact: true }).click();
  await expect(canvas.locator(".element")).toHaveCount(6);
  await page.screenshot({ path: info.outputPath("multi-selection.png") });
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect(canvas.locator(".element")).toHaveCount(3);
});

test("palettes stay physically usable at Chromebook size, Shift selection and transforms are contextual", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const canvas = page.locator(".editor-page-current .slide-canvas");
  await page.getByRole("button", { name: "図形を追加", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "図形を追加", exact: true });
  for (const category of ["基本", "矢印", "吹き出し", "フロー"]) {
    await palette.getByRole("button", { name: category, exact: true }).click();
    const buttons = palette.locator(".palette-grid button");
    for (let i = 0; i < (await buttons.count()); i++) {
      const b = buttons.nth(i);
      await expect(b).toBeInViewport();
      expect(
        await b.evaluate((n) => {
          const r = n.getBoundingClientRect();
          return n.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          );
        }),
      ).toBe(true);
    }
  }
  await page.screenshot({ path: info.outputPath("shape-palette.png") });
  await palette.getByRole("button", { name: "閉じる", exact: true }).click();
  const a = canvas.locator('.element[data-element-id="a"]');
  await a.click();
  if (info.project.name === "desktop") {
    await canvas
      .locator('.element[data-element-id="b"]')
      .click({ modifiers: ["Shift"] });
    await expect(canvas.locator(".selected-element")).toHaveCount(2);
    await a.click({ modifiers: ["Shift"] });
    await expect(canvas.locator(".selected-element")).toHaveCount(1);
    await a.click();
  }
  await page.getByRole("tab", { name: "配置", exact: true }).click();
  await page.getByText("サイズ・向き", { exact: true }).click();
  await page.getByRole("button", { name: "右へ90度", exact: true }).click();
  await expect(a.locator(".element-visual")).toHaveCSS(
    "transform",
    /matrix\(0, 1, -1, 0/,
  );
  await page.getByLabel("縦横比を固定", { exact: true }).check();
  const width = page.getByLabel("幅", { exact: true });
  await width.fill("150");
  await width.press("Enter");
  const el = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0]
        .elements[0],
  );
  expect(el.w / el.h).toBeCloseTo(100 / 120);
  const x = page.getByLabel("横の位置", { exact: true });
  await x.fill("9999");
  await x.press("Enter");
  await expect(x).toHaveValue("810");

  await page.getByRole("button", { name: "左右反転", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0]
            .elements[0].flipX,
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "線を追加", exact: true }).click();
  await page.getByRole("button", { name: "曲線を追加", exact: true }).click();
  const line = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0].elements.at(
      -1,
    ),
  );
  expect(line.lineStart.y).not.toBe(line.lineEnd.y);
});
