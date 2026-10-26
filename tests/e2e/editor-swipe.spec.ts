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
        {
          id: `image-${i}`,
          type: "image",
          x: 650,
          y: 40,
          w: 200,
          h: 140,
          src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        },
      ],
    };
  }),
};
const title = (page: Page) =>
  page.getByRole("textbox", { name: "ページの名前", exact: true });
const pager = (page: Page) => page.locator(".editor-pager");
const canvas = (page: Page) =>
  page.locator(".editor-page-current .slide-canvas");
const saved = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
async function idle(page: Page) {
  await expect(pager(page)).toHaveAttribute("data-pan-phase", "idle");
}
async function open(page: Page, initialTitle = "1.1") {
  await page.addInitScript(
    (deck) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(deck)),
    fixture,
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: `${initialTitle}を編集`, exact: true })
    .click();
  await idle(page);
  const workspace = (await page.locator(".editor-workspace").boundingBox())!;
  const fittedWidth =
    Math.max(
      0.1,
      Math.min((workspace.width - 48) / 960, (workspace.height - 85) / 540),
    ) * 960;
  await expect
    .poll(async () => (await canvas(page).boundingBox())!.width)
    .toBeCloseTo(fittedWidth, 0);
  return page.context().newCDPSession(page);
}
type Point = { x: number; y: number; id: number };
async function move(cdp: CDPSession, start: Point, dx: number, dy: number) {
  for (let step = 1; step <= 6; step++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          ...start,
          x: start.x + (dx * step) / 6,
          y: start.y + (dy * step) / 6,
        },
      ],
    });
}
async function gesture(
  page: Page,
  cdp: CDPSession,
  start: Point,
  dx: number,
  dy: number,
  cancel = false,
) {
  await idle(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  await move(cdp, start, dx, dy);
  await cdp.send("Input.dispatchTouchEvent", {
    type: cancel ? "touchCancel" : "touchEnd",
    touchPoints: [],
  });
  await idle(page);
}
async function swipe(page: Page, cdp: CDPSession, dx: number, dy: number) {
  const b = (await canvas(page).boundingBox())!;
  await gesture(
    page,
    cdp,
    { id: 1, x: b.x + b.width * 0.5, y: b.y + b.height * 0.8 },
    dx,
    dy,
  );
}
async function offset(page: Page) {
  return page.locator(".editor-page-current").evaluate((node) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    return { x: m.m41, y: m.m42 };
  });
}

test("one-finger swipes over text, images and shapes navigate without changing their geometry", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "実タッチの操作");
  const cdp = await open(page);
  const before = (await saved(page)).slides;
  for (const selector of [".slide-image", ".slide-text", "svg"]) {
    const node = page
      .locator(`.editor-page-current .element ${selector}`)
      .first();
    const b = (await node.boundingBox())!;
    await gesture(
      page,
      cdp,
      { id: 1, x: b.x + b.width * 0.6, y: b.y + b.height * 0.5 },
      -95,
      0,
    );
    await expect(title(page)).toHaveValue("1.2");
    expect((await saved(page)).slides).toEqual(before);
    await swipe(page, cdp, 95, 0);
    await expect(title(page)).toHaveValue("1.1");
  }
});

test("pages follow the finger, stay still while held, and return when the finger returns", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "実タッチの操作");
  const cdp = await open(page);
  const b = (await canvas(page).boundingBox())!;
  const start = { id: 1, x: b.x + b.width * 0.6, y: b.y + b.height * 0.8 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  await move(cdp, start, -95, 0);
  await expect(pager(page)).toHaveAttribute("data-pan-phase", "dragging");
  await expect.poll(() => offset(page)).toEqual({ x: -95, y: 0 });
  await expect(page.locator(".editor-page-preview")).toBeVisible();
  await expect(title(page)).toHaveValue("1.1");
  // Holding a finger never triggers the trackpad's idle timer.
  await page.waitForTimeout(300);
  expect(await offset(page)).toEqual({ x: -95, y: 0 });
  await move(cdp, start, -30, 0);
  await expect.poll(() => offset(page)).toEqual({ x: -30, y: 0 });
  await move(cdp, start, 0, 0);
  await expect.poll(() => offset(page)).toEqual({ x: 0, y: 0 });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await idle(page);
  await expect(title(page)).toHaveValue("1.1");
  await expect(page.locator(".editor-page-preview")).toHaveCount(0);
  expect((await saved(page)).slides).toEqual(fixture.slides);
});

test("four directions obey row choices and linked rows; edges and cancelled gestures bounce back", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "実タッチの操作");
  const cdp = await open(page);
  await swipe(page, cdp, -95, 0);
  await expect(title(page)).toHaveValue("1.2");
  await swipe(page, cdp, 0, -95);
  await expect(title(page)).toHaveValue("2.3");
  await swipe(page, cdp, 0, 95);
  await expect(title(page)).toHaveValue("1.2");
  await page.getByRole("switch", { name: "縦の連動" }).click();
  await swipe(page, cdp, 0, -95);
  await expect(title(page)).toHaveValue("2.2");
  await swipe(page, cdp, 0, 95);
  await swipe(page, cdp, 95, 0);
  await expect(title(page)).toHaveValue("1.1");
  await swipe(page, cdp, 95, 0);
  await swipe(page, cdp, 0, 95);
  await expect(title(page)).toHaveValue("1.1");
  const b = (await canvas(page).boundingBox())!;
  const start = { id: 1, x: b.x + b.width * 0.6, y: b.y + b.height * 0.8 };
  await gesture(page, cdp, start, -95, 0, true);
  await gesture(page, cdp, start, -12, 0);
  await gesture(page, cdp, start, -60, -60);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  const pair = [start, { ...start, id: 2, x: start.x + 60 }];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: pair,
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: pair.map((point, i) => ({
      ...point,
      x: point.x - 95 + i * 60,
    })),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await idle(page);
  await expect(title(page)).toHaveValue("1.1");
  expect((await saved(page)).slides).toEqual(fixture.slides);
});

test("touch taps edit text, borders move and handles resize, and swiping an active textbox preserves its text", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "実タッチの操作");
  const cdp = await open(page);
  await page.locator(".editor-page-current .element").nth(1).tap();
  const input = page.getByRole("textbox", {
    name: "スライド内の文字",
    exact: true,
  });
  await expect(input).toBeFocused();
  await input.fill("入力を残す");
  const b = (await input.boundingBox())!;
  await gesture(
    page,
    cdp,
    { id: 1, x: b.x + b.width * 0.7, y: b.y + b.height / 2 },
    -95,
    0,
  );
  await expect(title(page)).toHaveValue("1.2");
  expect((await saved(page)).slides[0].elements[1].text).toBe("入力を残す");
  await swipe(page, cdp, 95, 0);
  await page.locator(".editor-page-current .element").first().tap();
  const handle = (await page
    .locator(".editor-page-current .element")
    .first()
    .locator(".border-top")
    .boundingBox())!;
  await gesture(
    page,
    cdp,
    { id: 1, x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    40,
    0,
  );
  await expect(title(page)).toHaveValue("1.1");
  await expect
    .poll(async () => (await saved(page)).slides[0].elements[0].x)
    .toBeGreaterThan(340);
  const resize = (await page
    .getByRole("button", { name: "要素のサイズを変更" })
    .boundingBox())!;
  await gesture(
    page,
    cdp,
    { id: 1, x: resize.x + resize.width / 2, y: resize.y + resize.height / 2 },
    30,
    20,
  );
  await expect
    .poll(async () => (await saved(page)).slides[0].elements[0].w)
    .toBeGreaterThan(280);
  await expect(title(page)).toHaveValue("1.1");
});

test("trackpad wheel gestures follow both axes, reverse, settle once, and keep small pinch gestures separate", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "ノートPCのタッチパッド操作");
  await open(page);
  const b = (await canvas(page).boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
  await page.mouse.wheel(45, 0);
  await expect
    .poll(() => offset(page), { intervals: [16, 16, 32] })
    .toEqual({ x: -45, y: 0 });
  await page.mouse.wheel(-45, 0);
  await idle(page);
  await expect(title(page)).toHaveValue("1.1");
  await page.waitForTimeout(210);
  await page.mouse.wheel(95, 0);
  await expect(pager(page)).toHaveAttribute("data-pan-phase", "settling");
  // Momentum arriving during settling must not queue another page change.
  await page.mouse.wheel(100, 0);
  await page.mouse.wheel(50, 0);
  await idle(page);
  await expect(title(page)).toHaveValue("1.2");
  await page.waitForTimeout(210);
  await page.mouse.wheel(0, 95);
  await expect(title(page)).toHaveValue("2.3");
  await page.waitForTimeout(210);
  await page.mouse.wheel(0, -95);
  await expect(title(page)).toHaveValue("1.2");
  await canvas(page).evaluate((node) =>
    node.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: 1,
      }),
    ),
  );
  await idle(page);
  await expect(title(page)).toHaveValue("1.2");
  expect((await saved(page)).slides).toEqual(fixture.slides);
});

for (const streamKind of ["decaying", "steady"] as const) {
  test(`long ${streamKind} Windows-style wheel inertia does not delay paging or swallow the next stroke`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "ノートPCのタッチパッド操作");
    await open(page);
    await pager(page).evaluate((node, streamKind) => {
      const probe = {
        sent: 0,
        done: false,
        beforeReverse: "",
        firstNavigationMs: 0,
      };
      (window as any).__wheelProbe = probe;
      const started = performance.now();
      // Precision touchpads can emit small momentum events for well over a second.
      const deltas =
        streamKind === "steady" ? [8] : [42, 34, 26, 18, 12, 8, 5, 3, 2, 1];
      const stream = setInterval(() => {
        if (
          !probe.firstNavigationMs &&
          document.querySelector<HTMLInputElement>(
            '[aria-label="ページの名前"]',
          )!.value === "1.2"
        )
          probe.firstNavigationMs = performance.now() - started;
        node.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaX: deltas[Math.min(probe.sent, deltas.length - 1)],
            deltaMode: 0,
          }),
        );
        if (++probe.sent === 90) {
          clearInterval(stream);
          probe.beforeReverse = document.querySelector<HTMLInputElement>(
            '[aria-label="ページの名前"]',
          )!.value;
          // A fresh reverse stroke must work immediately, even before a quiet gap.
          // Some Windows drivers report wheel distances in lines rather than pixels.
          node.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaX: -6,
              deltaMode: 1,
            }),
          );
          probe.done = true;
        }
      }, 16);
    }, streamKind);
    await expect(title(page)).toHaveValue("1.2", { timeout: 650 });
    const early = await page.evaluate(() => (window as any).__wheelProbe);
    expect(early.done).toBe(false);
    await expect
      .poll(() => page.evaluate(() => (window as any).__wheelProbe.done))
      .toBe(true);
    const result = await page.evaluate(() => (window as any).__wheelProbe);
    expect(result.beforeReverse).toBe("1.2");
    expect(result.firstNavigationMs).toBeGreaterThan(0);
    expect(result.firstNavigationMs).toBeLessThan(650);
    await expect(title(page)).toHaveValue("1.1");
    await idle(page);
    expect((await saved(page)).slides).toEqual(fixture.slides);
  });
}

for (const edge of [
  { name: "left", page: "1.1", dx: -24, dy: 0 },
  { name: "top", page: "1.1", dx: 0, dy: -24 },
  { name: "right", page: "3.3", dx: 24, dy: 0 },
  { name: "bottom", page: "3.3", dx: 0, dy: 24 },
]) {
  test(`the ${edge.name} edge returns promptly while outward wheel momentum continues`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "タッチパッドの慣性操作");
    await open(page, edge.page);
    await pager(page).evaluate((node, edge) => {
      const probe = { sent: 0, done: false, returnedMs: 0 };
      (window as any).__edgeProbe = probe;
      const started = performance.now();
      const outward = () =>
        node.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaX: edge.dx,
            deltaY: edge.dy,
          }),
        );
      outward();
      const stream = setInterval(() => {
        const elapsed = performance.now() - started;
        if (
          elapsed >= 100 &&
          !probe.returnedMs &&
          node.getAttribute("data-pan-phase") === "idle"
        )
          probe.returnedMs = elapsed;
        outward();
        if (++probe.sent === 60) {
          clearInterval(stream);
          probe.done = true;
        }
      }, 16);
    }, edge);
    await expect
      .poll(() => page.evaluate(() => (window as any).__edgeProbe.sent), {
        intervals: [16, 16, 32],
      })
      .toBeGreaterThanOrEqual(8);
    await expect(pager(page)).toHaveAttribute("data-pan-phase", "idle", {
      timeout: 300,
    });
    expect(await offset(page)).toEqual({ x: 0, y: 0 });
    expect(await page.evaluate(() => (window as any).__edgeProbe.done)).toBe(
      false,
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).__edgeProbe.done))
      .toBe(true);
    const probe = await page.evaluate(() => (window as any).__edgeProbe);
    expect(probe.returnedMs).toBeGreaterThan(0);
    expect(probe.returnedMs).toBeLessThan(350);
    await idle(page);
    await expect(title(page)).toHaveValue(edge.page);
    expect((await saved(page)).slides).toEqual(fixture.slides);
  });
}

test("an inward wheel gesture interrupts the edge return without being cleared by the old timer", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "タッチパッドの操作");
  await open(page);
  await pager(page).evaluate((node) => {
    const probe = { reversedDuringReturn: false, duration: "" };
    (window as any).__returnProbe = probe;
    const observer = new MutationObserver(() => {
      if (node.getAttribute("data-pan-phase") !== "settling") return;
      observer.disconnect();
      probe.reversedDuringReturn = true;
      probe.duration = getComputedStyle(node).getPropertyValue(
        "--page-settle-duration",
      );
      node.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: 100,
        }),
      );
    });
    observer.observe(node, {
      attributes: true,
      attributeFilter: ["data-pan-phase"],
    });
    node.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: -100,
      }),
    );
  });
  await expect(title(page)).toHaveValue("1.2");
  await idle(page);
  const probe = await page.evaluate(() => (window as any).__returnProbe);
  expect(probe.reversedDuringReturn).toBe(true);
  expect(parseFloat(probe.duration)).toBeLessThanOrEqual(100);
  expect((await saved(page)).slides).toEqual(fixture.slides);
});

test("a new finger swipe can start during the edge return", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "実タッチの操作");
  const cdp = await open(page);
  const b = (await canvas(page).boundingBox())!;
  const start = { id: 1, x: b.x + b.width * 0.5, y: b.y + b.height * 0.8 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  await move(cdp, start, 95, 0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(pager(page)).toHaveAttribute("data-pan-phase", "settling");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  await move(cdp, start, -95, 0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(title(page)).toHaveValue("1.2");
  await idle(page);
  expect((await saved(page)).slides).toEqual(fixture.slides);
});

test("Chromebook layouts devote at most 104 pixels to the header and tools", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Chromebookの画面サイズ");
  await page.setViewportSize({ width: 1366, height: 768 });
  await open(page);
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    const layout = (await page.locator(".editor-layout").boundingBox())!;
    expect(layout.y).toBeLessThanOrEqual(104);
    const sheetBar = (await page.locator(".sheet-bar").boundingBox())!;
    // The editor shares the viewport with the existing sheet tabs below it.
    expect(layout.height).toBeGreaterThanOrEqual(
      size.height - 104 - sheetBar.height,
    );
    expect(Math.abs(layout.y + layout.height - sheetBar.y)).toBeLessThanOrEqual(
      1,
    );
    expect(layout.y + layout.height).toBeLessThanOrEqual(size.height);
    await expect(
      page.getByRole("button", { name: "もとに戻す", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "全体マップへ", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "文字", exact: true }),
    ).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath("compact-editor.png") });
});
