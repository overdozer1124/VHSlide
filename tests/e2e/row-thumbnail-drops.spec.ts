import { test, expect } from "@playwright/test";
import type { Page, Locator } from "@playwright/test";

const readDeck = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));

async function editor(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "vhslide-deck-v1",
      JSON.stringify({
        version: 1,
        title: "3段の移動",
        slides: Array.from({ length: 6 }, (_, i) => ({
          id: `page-${i}`,
          x: i % 2,
          y: Math.floor(i / 2),
          title: `段${Math.floor(i / 2) + 1}-${(i % 2) + 1}`,
          background: "#e8efdf",
          elements: [],
        })),
      }),
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "段1-1を編集", exact: true }).click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
}

async function drag(page: Page, source: Locator, touch: boolean) {
  const box = (await source.boundingBox())!;
  let point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = touch ? await page.context().newCDPSession(page) : undefined;
  if (cdp)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...point, id: 1 }],
    });
  else {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 10, point.y, { steps: 3 });
  }
  await expect(page.locator(".rail-drag-preview")).toBeVisible();
  return {
    async move(target: Locator, offset?: { x: number; y: number }) {
      const b = (await target.boundingBox())!;
      const next = {
        x: b.x + (offset?.x ?? b.width / 2),
        y: b.y + (offset?.y ?? b.height / 2),
      };
      if (cdp)
        for (let i = 1; i <= 12; i++)
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
              {
                id: 1,
                x: point.x + ((next.x - point.x) * i) / 12,
                y: point.y + ((next.y - point.y) * i) / 12,
              },
            ],
          });
      else await page.mouse.move(next.x, next.y, { steps: 12 });
      point = next;
    },
    async end() {
      if (cdp)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      else await page.mouse.up();
      await expect(page.locator(".rail-drag-preview")).toHaveCount(0);
    },
  };
}

test("overlapping vertical thumbnails swaps complete groups and leaves the middle row unchanged", async ({
  page,
}, info) => {
  await editor(page);
  const before = await readDeck(page);
  // Use the thumbnail body so the touch project exercises long-press activation.
  const gesture = await drag(
    page,
    page.locator('[data-drop-row="0"] .rail-trigger'),
    info.project.name === "touch",
  );
  await gesture.move(page.locator('[data-drop-row="2"] .rail-trigger'));
  await gesture.end();
  const after = await readDeck(page);
  expect(after.slides.map((s: any) => s.y)).toEqual([2, 2, 1, 1, 0, 0]);
  for (const slide of before.slides)
    expect(after.slides.find((s: any) => s.id === slide.id)).toEqual({
      ...slide,
      y: 2 - slide.y,
    });
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect
    .poll(async () => (await readDeck(page)).slides)
    .toEqual(before.slides);
});

test("vertical gaps animate and insert a group, including the expanded gap and final boundary", async ({
  page,
}, info) => {
  await editor(page);
  const before = await readDeck(page);
  const touch = info.project.name === "touch";
  // The grip bypasses the delay and starts a touch drag immediately.
  let gesture = await drag(
    page,
    page.locator('[data-drop-row="0"] .rail-drag-hint'),
    touch,
  );
  const gap = page.locator('[data-drop-row-insert="2"]');
  const neighbor = page.locator('[data-drop-row="2"] .rail-trigger');
  const top = (await neighbor.boundingBox())!.y;
  await gesture.move(gap);
  await expect(gap).toHaveAttribute("data-over", "true");
  await expect
    .poll(async () => (await neighbor.boundingBox())!.y - top)
    .toBeGreaterThan(12);
  const b = (await gap.boundingBox())!;
  await gesture.move(gap, { x: b.width / 2, y: b.height + 8 });
  await expect(gap).toHaveAttribute("data-over", "true");
  expect((await readDeck(page)).slides).toEqual(before.slides);
  await gesture.end();
  expect((await readDeck(page)).slides.map((s: any) => s.y)).toEqual([
    1, 1, 0, 0, 2, 2,
  ]);

  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  expect((await readDeck(page)).slides).toEqual(before.slides);
  gesture = await drag(
    page,
    page.locator('[data-drop-row="0"] .rail-drag-hint'),
    touch,
  );
  await gesture.move(page.locator(".rail-new-row-drop"));
  await gesture.end();
  expect((await readDeck(page)).slides.map((s: any) => s.y)).toEqual([
    2, 2, 0, 0, 1, 1,
  ]);
});
