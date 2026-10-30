import { test, expect, type Page, type Locator } from "@playwright/test";
import { createTable, cellKey } from "../../src/tableData";
const table = createTable(2, 2, () => crypto.randomUUID());
table.cells[cellKey(table.rows[0], table.columns[0])] = "表の文字を保持";
const fixture = {
  version: 1,
  title: "枠のサイズ変更",
  slides: [
    {
      id: "resize",
      x: 0,
      y: 0,
      title: "サイズ変更",
      background: "#ffffff",
      elements: [
        {
          id: "shape",
          type: "shape",
          shape: "rect",
          x: 180,
          y: 150,
          w: 200,
          h: 120,
          fill: "#c9dcc0",
          stroke: "#173d38",
        },
        {
          id: "table",
          type: "table",
          x: 500,
          y: 70,
          w: 260,
          h: 200,
          table,
          fontSize: 20,
          color: "#173d38",
          fill: "#ffffff",
          stroke: "#79958b",
        },
        {
          id: "text",
          type: "text",
          x: 80,
          y: 350,
          w: 220,
          h: 80,
          text: "文字を保持",
          fontSize: 24,
          color: "#173d38",
        },
        {
          id: "image",
          type: "image",
          x: 500,
          y: 350,
          w: 140,
          h: 100,
          aspectLocked: true,
          src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=",
        },
      ],
    },
  ],
};
const object = (page: Page, id: string) =>
  page.locator(`.editor-page-current .element[data-element-id="${id}"]`);
const saved = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0].elements,
  );
async function drag(
  page: Page,
  target: Locator,
  dx: number,
  dy: number,
  touch: boolean,
  alt = false,
) {
  const r = (await target.boundingBox())!,
    scale =
      (await page.locator(".editor-page-current .slide-canvas").boundingBox())!
        .width / 960;
  const x = r.x + r.width / 2,
    y = r.y + r.height / 2;
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      modifiers: alt ? 1 : 0,
      touchPoints: [{ id: 1, x, y }],
    });
    for (let i = 1; i <= 6; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        modifiers: alt ? 1 : 0,
        touchPoints: [
          { id: 1, x: x + (dx * scale * i) / 6, y: y + (dy * scale * i) / 6 },
        ],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      modifiers: alt ? 1 : 0,
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx * scale, y + dy * scale, { steps: 6 });
    await page.mouse.up();
  }
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (data) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(data)),
    fixture,
  );
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
});
test("tiny image corner targets remain distinct and the bottom-right corner really grows it", async ({
  page,
}, info) => {
  const tiny = structuredClone(fixture);
  tiny.title = "小さい画像の枠";
  tiny.slides[0].elements = [
    {
      ...tiny.slides[0].elements.find((e) => e.id === "image")!,
      x: 400,
      y: 240,
      w: 20,
      h: 20,
    },
  ];
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "tiny.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(tiny)),
    });
  await expect(page.getByLabel("作品のタイトル", { exact: true })).toHaveValue(
    tiny.title,
  );
  if (await page.locator(".map-main").isVisible())
    await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  const image = object(page, "image");
  await image.click();
  const boxes = [];
  for (const direction of ["nw", "ne", "sw", "se"]) {
    const handle = image.locator(`[data-resize-direction="${direction}"]`);
    const box = (await handle.boundingBox())!;
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document
            .elementFromPoint(x, y)
            ?.getAttribute("data-resize-direction"),
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      ),
    ).toBe(direction);
    for (const other of boxes) {
      const overlapX =
        Math.min(box.x + box.width, other.x + other.width) -
        Math.max(box.x, other.x);
      const overlapY =
        Math.min(box.y + box.height, other.y + other.height) -
        Math.max(box.y, other.y);
      expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0.1);
    }
    boxes.push(box);
  }
  await drag(
    page,
    image.locator('[data-resize-direction="se"]'),
    20,
    20,
    info.project.name === "touch",
  );
  await expect
    .poll(async () => (await saved(page)).find((e: any) => e.id === "image").w)
    .toBeGreaterThan(20);
});
test("all four borders and corners resize against the opposite anchor, and undo restores geometry", async ({
  page,
}, info) => {
  const shape = object(page, "shape");
  await shape.click();
  for (const direction of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
    const dx = direction.includes("w") ? -20 : direction.includes("e") ? 20 : 0,
      dy = direction.includes("n") ? -15 : direction.includes("s") ? 15 : 0;
    await drag(
      page,
      shape.locator(`[data-resize-direction="${direction}"]`),
      dx,
      dy,
      info.project.name === "touch",
    );
    const next = (await saved(page)).find((e: any) => e.id === "shape");
    expect(next.x).toBeCloseTo(direction.includes("w") ? 160 : 180, 0);
    expect(next.y).toBeCloseTo(direction.includes("n") ? 135 : 150, 0);
    expect(next.w).toBeCloseTo(dx ? 220 : 200, 0);
    expect(next.h).toBeCloseTo(dy ? 135 : 120, 0);
    await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
    expect(
      (await saved(page)).find((e: any) => e.id === "shape"),
    ).toMatchObject({ x: 180, y: 150, w: 200, h: 120 });
  }
  await page.screenshot({ path: info.outputPath("resize-frame.png") });
});
test("table and text retain contents when resized; Alt-border still moves the table", async ({
  page,
}, info) => {
  const el = object(page, "table");
  await el.locator("textarea").first().click();
  await drag(
    page,
    el.locator('[data-resize-direction="w"]'),
    -30,
    0,
    info.project.name === "touch",
  );
  let data = (await saved(page)).find((e: any) => e.id === "table");
  expect(data.x).toBeCloseTo(470, 0);
  expect(data.w).toBeCloseTo(290, 0);
  expect(Object.values(data.table.cells)).toContain("表の文字を保持");
  await page.keyboard.down("Alt");
  await drag(
    page,
    el.locator('[data-resize-direction="n"]'),
    20,
    10,
    info.project.name === "touch",
    true,
  );
  await page.keyboard.up("Alt");
  data = (await saved(page)).find((e: any) => e.id === "table");
  expect(data.x).toBeCloseTo(490, 0);
  expect(data.y).toBeCloseTo(80, 0);
  expect(data.w).toBeCloseTo(290, 0);
  const text = object(page, "text");
  await text.click();
  await drag(
    page,
    text.locator('[data-resize-direction="n"]'),
    0,
    -20,
    info.project.name === "touch",
  );
  expect((await saved(page)).find((e: any) => e.id === "text")).toMatchObject({
    text: "文字を保持",
  });
});
test("image ratio lock and multi-selection resize work from the left corner", async ({
  page,
}, info) => {
  const image = object(page, "image");
  await image.click();
  await drag(
    page,
    image.locator('[data-resize-direction="nw"]'),
    -28,
    -20,
    info.project.name === "touch",
  );
  const e = (await saved(page)).find((v: any) => v.id === "image");
  expect(e.w / e.h).toBeCloseTo(1.4);
  expect(e.x + e.w).toBeCloseTo(640, 0);
  expect(e.y + e.h).toBeCloseTo(450, 0);
  await object(page, "shape").click();
  await object(page, "text").click({ modifiers: ["Control"] });
  const before = (await saved(page)).filter((e: any) =>
      ["shape", "text"].includes(e.id),
    ),
    right = Math.max(...before.map((e: any) => e.x + e.w)),
    bottom = Math.max(...before.map((e: any) => e.y + e.h));
  await drag(
    page,
    page.locator('.group-selection-box [data-resize-direction="nw"]'),
    -15,
    -15,
    info.project.name === "touch",
  );
  const after = (await saved(page)).filter((e: any) =>
    ["shape", "text"].includes(e.id),
  );
  expect(Math.max(...after.map((e: any) => e.x + e.w))).toBeCloseTo(right, 0);
  expect(Math.max(...after.map((e: any) => e.y + e.h))).toBeCloseTo(bottom, 0);
  expect(after[0].w).toBeGreaterThan(before[0].w);
});
