import { test, expect } from "@playwright/test";
import type { Page, Locator } from "@playwright/test";
const data = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
async function editor(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page
    .getByRole("button", { name: "1段目の横のページをひらく", exact: true })
    .click();
}
async function start(
  page: Page,
  source: Locator,
  touch: boolean,
  preview: string,
  jitter = false,
) {
  const b = (await source.boundingBox())!;
  let current = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const cdp = touch ? await page.context().newCDPSession(page) : undefined;
  if (cdp) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...current, id: 1 }],
    });
    if (jitter) {
      current = { ...current, x: current.x + 9 };
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...current, id: 1 }],
      });
    }
  } else {
    await page.mouse.move(current.x, current.y);
    await page.mouse.down();
    await page.mouse.move(current.x + 12, current.y, { steps: 3 });
  }
  if (touch || preview === ".rail-drag-preview")
    await expect(page.locator(preview)).toBeVisible();
  return {
    async move(target: Locator, offset?: { x: number; y: number }) {
      const box = (await target.boundingBox())!,
        next = {
          x: box.x + (offset?.x ?? box.width / 2),
          y: box.y + (offset?.y ?? box.height / 2),
        };
      if (cdp) {
        for (let i = 1; i <= 12; i++)
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
              {
                id: 1,
                x: current.x + ((next.x - current.x) * i) / 12,
                y: current.y + ((next.y - current.y) * i) / 12,
              },
            ],
          });
      } else {
        await page.mouse.move(next.x, next.y, { steps: 12 });
        // HTML dragover follows dragenter on the next pointer event.
        await page.mouse.move(next.x, next.y);
      }
      current = next;
    },
    async end(cancel = false) {
      if (cdp)
        await cdp.send("Input.dispatchTouchEvent", {
          type: cancel ? "touchCancel" : "touchEnd",
          touchPoints: [],
        });
      else if (cancel) await page.keyboard.press("Escape");
      else await page.mouse.up();
    },
  };
}

test("an individual thumbnail inserts across rows with an animated gap, one undo restores all positions", async ({
  page,
}, info) => {
  await editor(page);
  const before = await data(page);
  const source = page.getByRole("button", {
    name: "1.2 自然がいっぱいを編集",
    exact: true,
  });
  const drag = await start(
    page,
    info.project.name === "touch" ? source.locator(".page-drag-grip") : source,
    info.project.name === "touch",
    ".rail-drag-preview",
  );
  await drag.move(page.locator('[data-drop-row="1"] .rail-trigger'));
  await expect(
    page.getByRole("region", { name: "2段目の横のページ一覧" }),
  ).toBeVisible();
  const neighbor = page.locator('[data-drop-cell="1,1"] .row-page');
  const x = (await neighbor.boundingBox())!.x;
  await drag.move(page.locator('[data-drop-insert="1,1"]'));
  await expect(page.locator('[data-drop-insert="1,1"]')).toHaveAttribute(
    "data-over",
    "true",
  );
  await expect
    .poll(async () => (await neighbor.boundingBox())!.x - x)
    .toBeGreaterThan(12);
  const gap = page.locator('[data-drop-insert="1,1"]');
  const gapBox = (await gap.boundingBox())!;
  await drag.move(gap, { x: gapBox.width + 8, y: gapBox.height / 2 });
  await expect(gap).toHaveAttribute("data-over", "true");
  expect((await data(page)).slides).toEqual(before.slides);
  await drag.end();
  const after = await data(page),
    moved = after.slides.find((s: any) => s.title === "自然がいっぱい"),
    park = after.slides.find((s: any) => s.title === "お気に入りの公園");
  expect(moved).toMatchObject({ x: 1, y: 1 });
  expect(park).toMatchObject({ x: 2, y: 1 });
  expect(after.slides).toHaveLength(before.slides.length);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect
    .poll(async () => (await data(page)).slides)
    .toEqual(before.slides);
});

test("a touch long press tolerates finger jitter, swaps occupied cards, and cancels safely", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "タッチによる長押しとキャンセル");
  await editor(page);
  const before = await data(page);
  const source = page.getByRole("button", {
    name: "1.2 自然がいっぱいを編集",
    exact: true,
  });
  let drag = await start(page, source, true, ".rail-drag-preview", true);
  await source.dispatchEvent("contextmenu");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await drag.move(
    page.getByRole("button", { name: "1.3 人とつながるを編集", exact: true }),
  );
  await drag.end(true);
  expect((await data(page)).slides).toEqual(before.slides);
  await page
    .getByRole("button", { name: "1段目の横のページをひらく", exact: true })
    .tap();
  drag = await start(page, source, true, ".rail-drag-preview", true);
  await drag.move(
    page.getByRole("button", { name: "1.3 人とつながるを編集", exact: true }),
  );
  await drag.end();
  expect(
    (await data(page)).slides.find((s: any) => s.title === "自然がいっぱい"),
  ).toMatchObject({ x: 2, y: 0 });
  expect(
    (await data(page)).slides.find((s: any) => s.title === "人とつながる"),
  ).toMatchObject({ x: 1, y: 0 });
});

test("the full map supports dragging into a gap with the same insertion animation", async ({
  page,
}, info) => {
  await page.goto("/");
  const before = await data(page);
  const source = page.locator(".slide-card").filter({
    has: page.getByRole("button", {
      name: "自然がいっぱいを編集",
      exact: true,
    }),
  });
  const drag = await start(
    page,
    source.locator(".thumbnail"),
    info.project.name === "touch",
    ".map-touch-preview",
    info.project.name === "touch",
  );
  const neighbor = page.locator('[data-map-cell="1,1"] .slide-card'),
    x = (await neighbor.boundingBox())!.x;
  await drag.move(page.locator('[data-map-insert="1,1"]'));
  await expect(page.locator('[data-map-insert="1,1"]')).toHaveAttribute(
    "data-over",
    "true",
  );
  await expect
    .poll(async () => (await neighbor.boundingBox())!.x - x)
    .toBeGreaterThan(12);
  const gap = page.locator('[data-map-insert="1,1"]');
  const gapBox = (await gap.boundingBox())!;
  await drag.move(gap, { x: gapBox.width + 8, y: gapBox.height / 2 });
  await expect(gap).toHaveAttribute("data-over", "true");
  await drag.end();
  expect(
    (await data(page)).slides.find((s: any) => s.title === "自然がいっぱい"),
  ).toMatchObject({ x: 1, y: 1 });
  expect(
    (await data(page)).slides.find((s: any) => s.title === "お気に入りの公園"),
  ).toMatchObject({ x: 2, y: 1 });
  await expect(page.locator(".editor-pager")).toHaveCount(0);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  expect((await data(page)).slides).toEqual(before.slides);
  // A new pointer gesture immediately after dropping must not be mistaken for
  // the synthetic release click that dragging suppresses.
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  await expect(page.locator(".editor-pager")).toBeVisible();
});

test("a held touch map drag blocks native drag takeover and keeps moving until release", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "ブラウザ標準ドラッグとの競合");
  await page.goto("/");
  const before = await data(page);
  const card = page.locator('[data-map-cell="1,0"] .slide-card');
  const drag = await start(
    page,
    card.locator(".thumbnail"),
    true,
    ".map-touch-preview",
  );
  await expect(card).toHaveAttribute("draggable", "false");
  // Keep holding beyond the browser's native long-press drag threshold.
  await page.waitForTimeout(750);
  expect(
    await card.evaluate(
      (node) =>
        !node.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer: new DataTransfer(),
          }),
        ),
    ),
  ).toBe(true);
  await card.dispatchEvent("dragend");
  await expect(page.locator(".map-touch-preview")).toBeVisible();
  await drag.move(page.locator('[data-map-cell="0,1"] .thumbnail'));
  await drag.end();
  await expect(page.locator(".map-touch-preview")).toHaveCount(0);
  await expect(card).toHaveAttribute("draggable", "true");
  expect(
    (await data(page)).slides.find((s: any) => s.title === "自然がいっぱい"),
  ).toMatchObject({ x: 0, y: 1 });
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  expect((await data(page)).slides).toEqual(before.slides);
  // Hybrid devices must still accept mouse HTML dragging after touch dragging.
  const mouse = await start(
    page,
    card.locator(".thumbnail"),
    false,
    ".map-touch-preview",
  );
  await mouse.move(page.locator('[data-map-cell="0,1"] .thumbnail'));
  await mouse.end();
  expect(
    (await data(page)).slides.find((s: any) => s.title === "自然がいっぱい"),
  ).toMatchObject({ x: 0, y: 1 });
});

test("touch map grips start immediately, swap cards, and two-finger pinches still belong to zoom", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "マップの実タッチ移動");
  await page.goto("/");
  const before = await data(page);
  const source = page.locator(
    '[data-map-cell="1,0"] .card-tool[data-map-drag-handle]',
  );
  let drag = await start(page, source, true, ".map-touch-preview");
  await drag.move(page.locator('[data-map-cell="0,1"] .thumbnail'));
  await drag.end();
  expect(
    (await data(page)).slides.find((s: any) => s.title === "自然がいっぱい"),
  ).toMatchObject({ x: 0, y: 1 });
  expect(
    (await data(page)).slides.find(
      (s: any) => s.title === "まちを歩いてみたら",
    ),
  ).toMatchObject({ x: 1, y: 0 });
  await expect(page.locator(".map-touch-preview")).toHaveCount(0);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  expect((await data(page)).slides).toEqual(before.slides);
  drag = await start(page, source, true, ".map-touch-preview");
  await drag.end(true);
  expect((await data(page)).slides).toEqual(before.slides);
  const cdp = await page.context().newCDPSession(page);
  const box = (await page
    .locator('[data-map-cell="0,0"] .thumbnail')
    .boundingBox())!;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  for (const [type, radius] of [
    ["touchStart", 40],
    ["touchMove", 25],
    ["touchEnd", 0],
  ] as const)
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: radius
        ? [
            { id: 1, x: cx - radius, y: cy },
            { id: 2, x: cx + radius, y: cy },
          ]
        : [],
    });
  await expect(page.locator(".map-scale-reset")).toHaveText("60%");
  await expect(page.locator(".map-touch-preview")).toHaveCount(0);
  expect((await data(page)).slides).toEqual(before.slides);
});
