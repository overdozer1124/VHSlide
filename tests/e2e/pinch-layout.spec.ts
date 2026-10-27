import { test, expect } from "@playwright/test";
import type { CDPSession, Page } from "@playwright/test";

async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  x: number,
  y: number,
  spread: number,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints:
      type === "touchEnd"
        ? []
        : [
            { x: x - spread, y, id: 1 },
            { x: x + spread, y, id: 2 },
          ],
  });
}
async function largeMap(page: Page) {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("public/samples/vhslide-10x40.json");
  await expect(page.locator(".slide-card")).toHaveCount(400);
}
/** Gaps between the first slide and its headings, label and neighbours. */
function layout(page: Page) {
  return page.evaluate(() => {
    const r = (el: Element) => el.getBoundingClientRect();
    const rows = document.querySelectorAll(".grid-row");
    const first = rows[0].querySelector(".slide-card")!;
    const below = rows[1].querySelector(".slide-card")!;
    const footer = first.querySelector(".card-footer");
    return {
      rowHeading: Math.round(
        r(first).left - r(rows[0].querySelector(".row-axis")!).right,
      ),
      columnHeading: Math.round(
        r(first).top - r(document.querySelector(".column-heading")!).bottom,
      ),
      rowGap: Math.round(r(below).top - r(first).bottom),
      label: footer && Math.round(r(footer).height),
      labelInCard: footer && Math.round(r(first).bottom - r(footer).bottom),
      // The add buttons stay beside the card, at their size.
      ...(() => {
        const cell = first.parentElement!;
        const right = r(cell.querySelector(".add-right")!),
          down = r(cell.querySelector(".add-down")!),
          card = r(first),
          thumbnail = r(first.querySelector(".thumbnail")!);
        return {
          addRight: [
            Math.round(right.left - card.right),
            Math.round(
              right.top +
                right.height / 2 -
                (thumbnail.top + thumbnail.height / 2),
            ),
            Math.round(right.width),
          ],
          addDown: [
            Math.round(
              down.left + down.width / 2 - (card.left + card.width / 2),
            ),
            Math.round(down.top - card.bottom),
            Math.round(down.width),
          ],
        };
      })(),
    };
  });
}

/** Equal within a pixel of rounding, field by field. */
function expectNear(actual: object, expected: object) {
  const flat = (value: object) =>
    JSON.stringify(value).match(/-?\d+/g)!.map(Number);
  const a = flat(actual),
    b = flat(expected);
  expect(a.length).toBe(b.length);
  for (const [i, value] of a.entries())
    expect(
      Math.abs(value - b[i]),
      JSON.stringify({ actual, expected }),
    ).toBeLessThanOrEqual(1);
}

test("a touch pinch keeps headings, labels and row gaps at their size around the pinched slide", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "実際の2本指タッチ");
  await largeMap(page);
  const cdp = await page.context().newCDPSession(page);
  const target = page
    .locator(".grid-row")
    .nth(1)
    .locator(".slide-card")
    .nth(1)
    .locator(".thumbnail");
  for (const [from, to] of [
    [100, 66],
    [60, 80],
  ]) {
    const rest = await layout(page);
    const box = (await target.boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await touch(cdp, "touchStart", x, y, from);
    await touch(cdp, "touchMove", x, y, to);
    // Slides two rows and columns away do not slide under the headings, and
    // labels neither shrink, grow nor leave their cards.
    expectNear(await layout(page), rest);
    await touch(cdp, "touchEnd", x, y, 0);
    await expect(page.locator(".map-grid")).not.toHaveAttribute(
      "data-pinching",
    );
  }
  // The numbered overview has no labels: its rows keep their gaps too.
  await page
    .getByRole("button", { name: "番号だけの一覧", exact: true })
    .click();
  const tile = page.locator(".number-tile").first();
  const gaps = () =>
    page.evaluate(() => {
      const tiles = [...document.querySelectorAll(".grid-row")]
        .slice(0, 4)
        .map((row) =>
          row.querySelector(".number-tile")!.getBoundingClientRect(),
        );
      return tiles.slice(1).map((t, i) => Math.round(t.top - tiles[i].bottom));
    });
  const atRest = await gaps();
  const box = (await tile.boundingBox())!;
  await touch(cdp, "touchStart", box.x + box.width / 2, box.y + 10, 60);
  await touch(cdp, "touchMove", box.x + box.width / 2, box.y + 10, 75);
  expect(await gaps()).toEqual(atRest);
  await touch(cdp, "touchEnd", 0, 0, 0);
});

test("a trackpad pinch never zooms the page, also when it carries on into the editor", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "トラックパッドのピンチ");
  await page.goto("/");
  const box = (await page
    .locator(".map-grid .thumbnail")
    .first()
    .boundingBox())!;
  const zoomed = await page.evaluate(
    async ({ x, y }) => {
      const missed: string[] = [];
      const pinch = (target: Element | null, deltaY: number) => {
        const event = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY,
          clientX: x,
          clientY: y,
        });
        target?.dispatchEvent(event);
        if (!event.defaultPrevented)
          missed.push(String(target?.className || target?.tagName));
      };
      // One gesture: it opens the editor and goes on over the editor's frame.
      for (let i = 0; i < 20; i++) {
        pinch(document.elementFromPoint(x, y), -6);
        await new Promise((r) => setTimeout(r, 16));
      }
      return missed;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(zoomed).toEqual([]);
  await expect(page.locator(".editor-pager")).toBeVisible();
  // Nor over the map's toolbar.
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  const toolbar = page.locator(".map-toolbar");
  await expect(toolbar).toBeVisible();
  expect(
    await toolbar.evaluate((node) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -6,
      });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
});

test("pinching beside the slide in the editor does not zoom the page, and a pinch-in there returns to the map", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "実際の2本指タッチ");
  await page.goto("/");
  const cdp = await page.context().newCDPSession(page);
  await page.locator(".map-grid .thumbnail").first().click();
  const pager = page.locator(".editor-pager");
  await expect(pager).toBeVisible();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  const p = (await pager.boundingBox())!;
  const x = p.x + p.width / 2,
    y = Math.min(page.viewportSize()!.height - 80, p.y + p.height + 80);
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest(".editor-pager"),
      { x, y },
    ),
  ).toBeNull();
  for (let i = 0; i <= 6; i++)
    await touch(cdp, i ? "touchMove" : "touchStart", x, y, 40 + i * 12);
  await touch(cdp, "touchEnd", x, y, 0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  await expect(pager).toBeVisible();
  for (let i = 0; i <= 6; i++)
    await touch(cdp, i ? "touchMove" : "touchStart", x, y, 110 - i * 12);
  await touch(cdp, "touchEnd", x, y, 0);
  await expect(page.locator(".map-scroll")).toBeVisible();
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
});
