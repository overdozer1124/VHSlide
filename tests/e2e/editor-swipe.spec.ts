import { test, expect } from "@playwright/test";
import type { Page, CDPSession } from "@playwright/test";
import type { Deck } from "../../src/model";

const fixture: Deck = {
  version: 1,
  title: "スワイプの確認",
  rowSelections: ["page-0-0", "page-2-1", "page-0-2"],
  slides: Array.from({ length: 9 }, (_, i) => {
    const x = i % 3,
      y = Math.floor(i / 3);
    return {
      id: `page-${x}-${y}`,
      x,
      y,
      title: `${y + 1}.${x + 1}`,
      background: "#ffffff",
      elements: [
        {
          id: `shape-${i}`,
          type: "shape",
          shape: "rect",
          x: 340,
          y: 200,
          w: 280,
          h: 140,
          fill: "#e5f0dc",
          stroke: "#173d38",
        },
        {
          id: `text-${i}`,
          type: "text",
          x: 60,
          y: 40,
          w: 300,
          h: 90,
          text: "ここで文字を編集",
          fontSize: 24,
          color: "#173d38",
        },
      ],
    };
  }),
};
const title = (page: Page) =>
  page.getByRole("textbox", { name: "ページの名前", exact: true });
const canvas = (page: Page) => page.locator(".editor-workspace .slide-canvas");
const saved = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
async function open(page: Page) {
  await page.addInitScript(
    (deck) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(deck)),
    fixture,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "1.1を編集", exact: true }).click();
  return page.context().newCDPSession(page);
}
type Point = { x: number; y: number; id: number };
async function gesture(
  cdp: CDPSession,
  start: Point[],
  dx: number,
  dy: number,
  options: {
    cancel?: boolean;
    spread?: number;
    separateRelease?: boolean;
  } = {},
) {
  // Add the second finger separately, as on a physical touchscreen.
  for (let i = 1; i <= start.length; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: start.slice(0, i),
    });
  let end = start;
  for (let step = 1; step <= 6; step++) {
    end = start.map((p, i) => ({
      ...p,
      x: p.x + (dx * step) / 6 + (i ? ((options.spread ?? 0) * step) / 6 : 0),
      y: p.y + (dy * step) / 6,
    }));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: end,
    });
  }
  if (options.separateRelease && !options.cancel)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [end[1]],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: options.cancel ? "touchCancel" : "touchEnd",
    touchPoints: [],
  });
}
async function swipe(page: Page, cdp: CDPSession, dx: number, dy: number) {
  const b = (await canvas(page).boundingBox())!;
  await gesture(
    cdp,
    [{ id: 1, x: b.x + b.width * 0.5, y: b.y + b.height * 0.8 }],
    dx,
    dy,
  );
}

test.beforeEach(({}, info) =>
  test.skip(info.project.name !== "touch", "実タッチのスワイプ操作"),
);

test("canvas swipes navigate all four directions, remember row choices and obey linked rows and edges", async ({
  page,
}) => {
  const cdp = await open(page);
  await swipe(page, cdp, -85, 0);
  await expect(title(page)).toHaveValue("1.2");
  await swipe(page, cdp, 85, 0);
  await expect(title(page)).toHaveValue("1.1");
  await swipe(page, cdp, -85, 0);
  await swipe(page, cdp, 0, -85);
  await expect(title(page)).toHaveValue("2.3");
  await swipe(page, cdp, 0, 85);
  await expect(title(page)).toHaveValue("1.2");
  await page.getByRole("switch", { name: "縦の連動" }).click();
  await swipe(page, cdp, 0, -85);
  await expect(title(page)).toHaveValue("2.2");
  await swipe(page, cdp, 0, 85);
  await swipe(page, cdp, 85, 0);
  await expect(title(page)).toHaveValue("1.1");
  await swipe(page, cdp, 85, 0);
  await swipe(page, cdp, 0, 85);
  await expect(title(page)).toHaveValue("1.1");
  expect((await saved(page)).slides).toEqual(fixture.slides);
});

test("two fingers over an object navigate once without moving it; one finger still drags and resizes", async ({
  page,
}) => {
  const cdp = await open(page);
  const b = (await canvas(page).boundingBox())!;
  const shape = page.locator(".editor-workspace .element").first();
  const s = (await shape.boundingBox())!;
  const start = [
    { id: 1, x: s.x + s.width * 0.4, y: s.y + s.height / 2 },
    { id: 2, x: s.x + s.width * 0.7, y: s.y + s.height / 2 },
  ];
  await gesture(cdp, start, -85, 0, { separateRelease: true });
  await expect(title(page)).toHaveValue("1.2");
  expect((await saved(page)).slides).toEqual(fixture.slides);
  await swipe(page, cdp, 85, 0);
  await gesture(cdp, [start[0]], 65, 0);
  await expect(title(page)).toHaveValue("1.1");
  await expect
    .poll(async () => (await saved(page)).slides[0].elements[0].x)
    .toBeGreaterThan(340);
  const handle = (await page
    .getByRole("button", { name: "要素のサイズを変更" })
    .boundingBox())!;
  await gesture(
    cdp,
    [
      {
        id: 1,
        x: handle.x + handle.width / 2,
        y: handle.y + handle.height / 2,
      },
    ],
    30,
    20,
  );
  await expect
    .poll(async () => (await saved(page)).slides[0].elements[0].w)
    .toBeGreaterThan(280);
  // Background swipes still work after manipulating an object.
  await gesture(
    cdp,
    [{ id: 1, x: b.x + b.width * 0.5, y: b.y + b.height * 0.8 }],
    -85,
    0,
  );
  await expect(title(page)).toHaveValue("1.2");
});

test("taps, diagonal gestures, cancelled touches and pinches do not switch pages or save accidental changes", async ({
  page,
}) => {
  const cdp = await open(page);
  const b = (await canvas(page).boundingBox())!;
  const start = [{ id: 1, x: b.x + b.width * 0.4, y: b.y + b.height * 0.8 }];
  await gesture(cdp, start, -15, 0);
  await gesture(cdp, start, -65, -65);
  await gesture(cdp, start, -85, 0, { cancel: true });
  await gesture(
    cdp,
    [...start, { ...start[0], id: 2, x: start[0].x + 70 }],
    -85,
    0,
    { spread: 65 },
  );
  await expect(title(page)).toHaveValue("1.1");
  expect((await saved(page)).slides).toEqual(fixture.slides);
  await swipe(page, cdp, -85, 0);
  await expect(title(page)).toHaveValue("1.2");
});

test("inline text selection stays editable and a canvas swipe keeps the entered text", async ({
  page,
}) => {
  const cdp = await open(page);
  await page.locator(".editor-workspace .element").nth(1).tap();
  const input = page.getByRole("textbox", {
    name: "スライド内の文字",
    exact: true,
  });
  await expect(input).toBeFocused();
  await input.fill("入力を残す");
  const b = (await input.boundingBox())!;
  await gesture(
    cdp,
    [{ id: 1, x: b.x + b.width * 0.7, y: b.y + b.height / 2 }],
    -60,
    0,
  );
  await expect(title(page)).toHaveValue("1.1");
  await expect(input).toBeVisible();
  await swipe(page, cdp, -85, 0);
  await expect(title(page)).toHaveValue("1.2");
  expect((await saved(page)).slides[0].elements[1].text).toBe("入力を残す");
});
