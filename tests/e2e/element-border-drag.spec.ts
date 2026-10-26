import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { blank, uid } from "../../src/model";
import type { Deck } from "../../src/model";
import { createTable, cellKey } from "../../src/tableData";
const t = createTable(3, 3, uid);
t.cells[cellKey(t.rows[0], t.columns[0])] = "セルの入力";
const fixture: Deck = {
  version: 1,
  title: "枠ドラッグ",
  slides: [
    {
      ...blank(0, 0),
      title: "枠の移動",
      elements: [
        {
          id: "table",
          type: "table",
          x: 100,
          y: 60,
          w: 500,
          h: 240,
          table: t,
          fontSize: 18,
          color: "#173d38",
          fill: "#ffffff",
          stroke: "#79958b",
          textAlign: "left",
        },
        {
          id: "text",
          type: "text",
          x: 100,
          y: 360,
          w: 350,
          h: 70,
          text: "枠のテスト",
          fontSize: 24,
          color: "#173d38",
        },
        {
          id: "shape",
          type: "shape",
          shape: "rect",
          x: 660,
          y: 80,
          w: 160,
          h: 120,
          fill: "#e5f0dc",
          stroke: "#173d38",
        },
        {
          id: "image",
          type: "image",
          x: 660,
          y: 300,
          w: 160,
          h: 120,
          src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        },
      ],
    },
    { ...blank(1, 0), title: "次のページ" },
  ],
};
const book = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
async function drag(
  page: Page,
  touch: boolean,
  x: number,
  y: number,
  dx: number,
  dy: number,
) {
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x, y }],
    });
    for (let i = 1; i <= 6; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ id: 1, x: x + (dx * i) / 6, y: y + (dy * i) / 6 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 6 });
    await page.mouse.up();
  }
}
async function dragBorder(
  page: Page,
  target: Locator,
  touch: boolean,
  dx = 25,
  dy = 15,
) {
  await expect
    .poll(() =>
      target.evaluate((node) => {
        const r = node.getBoundingClientRect(),
          hit = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          );
        return hit === node;
      }),
    )
    .toBe(true);
  const r = (await target.boundingBox())!;
  await drag(page, touch, r.x + r.width / 2, r.y + r.height / 2, dx, dy);
}
test("borders move every element without icons; mouse grid margins move and cell input remains editable", async ({
  page,
}, info) => {
  const touch = info.project.name === "touch";
  await page.addInitScript(
    (d) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(d)),
    fixture,
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "枠の移動を編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "要素を移動", exact: true }),
  ).toHaveCount(0);
  const workspace = (await page.locator(".editor-workspace").boundingBox())!;
  const fittedWidth =
    Math.max(
      0.1,
      Math.min((workspace.width - 48) / 960, (workspace.height - 85) / 540),
    ) * 960;
  await expect
    .poll(
      async () =>
        (await page
          .locator(".editor-page-current .slide-canvas")
          .boundingBox())!.width,
    )
    .toBeCloseTo(fittedWidth, 0);
  const elements = page.locator(".editor-page-current .element");
  for (const [index, id] of ["table", "text", "shape", "image"].entries()) {
    const before = (await book(page)).slides[0].elements.find(
      (e: any) => e.id === id,
    );
    await dragBorder(page, elements.nth(index).locator(".border-top"), touch);
    await expect
      .poll(
        async () =>
          (await book(page)).slides[0].elements.find((e: any) => e.id === id).x,
      )
      .toBeGreaterThan(before.x);
    await expect(
      page.getByRole("textbox", { name: "ページの名前", exact: true }),
    ).toHaveValue("枠の移動");
  }
  // A visible internal grid margin previously advertised a move cursor but did nothing.
  if (!touch) {
    const margin = elements.first().locator("th").nth(1),
      r = (await margin.boundingBox())!;
    const before = (await book(page)).slides[0].elements[0];
    await drag(page, false, r.x + 2, r.y + r.height / 2, 20, 0);
    await expect
      .poll(async () => (await book(page)).slides[0].elements[0].x)
      .toBeGreaterThan(before.x);
  }
  const moved = (await book(page)).slides[0].elements[0];
  const input = page.getByRole("textbox", { name: "表 1行 1列", exact: true });
  if (touch) await input.tap();
  else await input.click();
  await input.fill("入力は移動にならない");
  expect((await book(page)).slides[0].elements[0].x).toBe(moved.x);
  // An actively edited textbox can also be moved by its frame, without losing its text.
  if (touch) await elements.nth(1).locator(".text-layout").tap();
  else await elements.nth(1).locator(".text-layout").click();
  const text = page.getByRole("textbox", {
    name: "スライド内の文字",
    exact: true,
  });
  await text.fill("編集した文字を保持");
  await dragBorder(page, elements.nth(1).locator(".border-left"), touch, 15, 0);
  expect((await book(page)).slides[0].elements[1].text).toBe(
    "編集した文字を保持",
  );
  await page.screenshot({ path: info.outputPath("border-move.png") });
  if (touch) {
    const cell = (await input.boundingBox())!,
      geometry = (await book(page)).slides[0].elements[0];
    await drag(
      page,
      true,
      cell.x + cell.width / 2,
      cell.y + cell.height / 2,
      -100,
      0,
    );
    await expect(
      page.getByRole("textbox", { name: "ページの名前", exact: true }),
    ).toHaveValue("次のページ");
    expect((await book(page)).slides[0].elements[0]).toEqual(geometry);
  }
});
