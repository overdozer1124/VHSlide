import { test, expect } from "@playwright/test";
import type { CDPSession, Locator, Page } from "@playwright/test";

async function points(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
  x: number,
  y: number,
  spread: number,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints:
      type === "touchEnd" || type === "touchCancel"
        ? []
        : [
            { x: x - spread, y, id: 1 },
            { x: x + spread, y, id: 2 },
          ],
  });
}
async function wheel(surface: Locator, deltas: number | number[]) {
  await surface.evaluate((node, deltas) => {
    const b = node.getBoundingClientRect();
    for (const deltaY of Array.isArray(deltas) ? deltas : [deltas])
      node.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY,
          clientX: b.x + b.width / 2,
          clientY: b.y + b.height / 2,
        }),
      );
  }, deltas);
}
async function noFlight(page: Page) {
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
}

test("a pinch completes its initial direction even after reversing or interruption, without changing slide content", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "実際の2本指タッチ");
  await page.goto("/");
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides,
  );
  const cdp = await page.context().newCDPSession(page);
  const tile = page.getByRole("button", {
    name: "自然がいっぱいを編集",
    exact: true,
  });
  const b = (await tile.boundingBox())!;
  const x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  await points(cdp, "touchStart", x, y, 35);
  await points(cdp, "touchMove", x, y, 55);
  await expect
    .poll(async () => (await tile.boundingBox())!.width)
    .toBeGreaterThan(b.width * 1.4);
  const enlarged = (await tile.boundingBox())!.width;
  await points(cdp, "touchMove", x, y, 35);
  await expect
    .poll(async () => (await tile.boundingBox())!.width)
    .toBeCloseTo(enlarged, 0);
  await points(cdp, "touchEnd", x, y, 0);
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("自然がいっぱい");
  await noFlight(page);
  const pager = page.locator(".editor-pager");
  const e = (await pager.boundingBox())!;
  const ex = e.x + e.width / 2,
    ey = e.y + e.height / 2;
  await points(cdp, "touchStart", ex, ey, 100);
  // A short pinch-in also commits; returning the fingers is not cancellation.
  await points(cdp, "touchMove", ex, ey, 90);
  const shrunk = (await pager.boundingBox())!.width;
  expect(shrunk).toBeLessThan(e.width);
  await points(cdp, "touchMove", ex, ey, 110);
  await expect
    .poll(async () => (await pager.boundingBox())!.width)
    .toBeCloseTo(shrunk, 0);
  await points(cdp, "touchCancel", ex, ey, 0);
  await expect(page.locator(".map-scroll")).toBeVisible();
  await noFlight(page);
  await expect(tile).toHaveAttribute("aria-current", "page");
  await expect
    .poll(async () => (await tile.boundingBox())!.width)
    .toBeCloseTo(b.width, 0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides,
    ),
  ).toEqual(before);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  await tile.tap();
  await expect(page.locator(".editor-pager")).toBeVisible();
});

test("trackpad pinch navigates both ways; numbered overview finds page 40.10 and preserves upper buttons", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "タッチパッドと400枚の番号一覧");
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("public/samples/vhslide-10x40.json");
  const first = page.getByRole("button", {
    name: "1.1 まちの紹介｜はじめにを編集",
    exact: true,
  });
  await wheel(first, [-8, 16]);
  await expect(page.locator(".editor-pager")).toBeVisible();
  await noFlight(page);
  await wheel(page.locator(".editor-pager"), [8, -16]);
  await expect(page.locator(".map-scroll")).toBeVisible();
  await noFlight(page);
  const reset = page.getByRole("button", {
    name: "表示サイズを100%に戻す",
    exact: true,
  });
  await page.getByRole("button", { name: "マップを縮小", exact: true }).click();
  await expect(reset).toHaveText("60%");
  await page.getByRole("button", { name: "マップを縮小", exact: true }).click();
  await expect(reset).toHaveText("番号");
  await expect(page.locator(".number-tile")).toHaveCount(400);
  await expect(page.locator(".map-grid .slide-canvas")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "ページ番号で探す", exact: true })
    .fill("40.10");
  await page
    .getByRole("button", { name: "番号のページを探す", exact: true })
    .click();
  const selected = page.getByRole("button", {
    name: "40.10 まとめ｜おわりにを編集",
    exact: true,
  });
  await expect(selected).toHaveAttribute("aria-current", "page");
  await expect(selected).toBeInViewport();
  await page.screenshot({ path: info.outputPath("number-overview.png") });
  await selected.click();
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("40.10 まとめ｜おわりに");
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await expect(reset).toHaveText("番号");
  await page.getByRole("button", { name: "ページを編集", exact: true }).click();
  await expect(page.locator(".editor-pager")).toBeVisible();
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await noFlight(page);
  await page.locator(".map-scroll").evaluate((node) => {
    node.scrollTop = 0;
    node.scrollLeft = 0;
  });
  await wheel(first, -40);
  await expect(page.locator(".map-grid")).toHaveAttribute(
    "data-numbers",
    "false",
  );
  // Expanding another part of the map must stay there, rather than jumping back
  // to the current page at the bottom of the map.
  await expect(first).toBeInViewport();
  await expect(selected).toHaveAttribute("aria-current", "page");
});

test("two-finger jitter does not zoom and one finger still scrolls the large map", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "タッチスクロールとの共存");
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("public/samples/vhslide-10x40.json");
  const cdp = await page.context().newCDPSession(page);
  const tile = page.locator(".thumbnail").first();
  const b = (await tile.boundingBox())!;
  const x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  await points(cdp, "touchStart", x, y, 30);
  await points(cdp, "touchMove", x, y, 30.3);
  await points(cdp, "touchCancel", x, y, 0);
  await expect(
    page.getByRole("button", { name: "表示サイズを100%に戻す", exact: true }),
  ).toHaveText("100%");
  await expect
    .poll(async () => (await tile.boundingBox())!.width)
    .toBeCloseTo(b.width, 0);
  const map = (await page.locator(".map-scroll").boundingBox())!;
  const start = {
    id: 1,
    x: map.x + map.width * 0.7,
    y: map.y + map.height * 0.8,
  };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  for (let i = 1; i <= 6; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...start, y: start.y - (180 * i) / 6 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => page.locator(".map-scroll").evaluate((node) => node.scrollTop))
    .toBeGreaterThan(60);
});

test("pinching the map switches between standard, smaller, and numbered views without intermediate thumbnail sizes", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "ピンチの3段階切り替え");
  await page.goto("/");
  const cdp = await page.context().newCDPSession(page);
  const reset = page.getByRole("button", {
    name: "表示サイズを100%に戻す",
    exact: true,
  });
  const first = page.locator(".thumbnail").first();
  for (const [ratio, expected] of [
    [0.65, "60%"],
    [0.65, "番号"],
    [1.35, "60%"],
    [1.35, "100%"],
  ] as const) {
    const box = (await first.boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    const radius = Math.min(35, box.width * 0.3);
    await points(cdp, "touchStart", x, y, radius);
    await points(cdp, "touchMove", x, y, radius * ratio);
    await points(cdp, "touchEnd", x, y, 0);
    await expect(reset).toHaveText(expected);
    await expect(page.locator(".editor-pager")).toHaveCount(0);
  }
});

test("pinching back to the map centers an interior thumbnail and clamps edge thumbnails to the map", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "ピンチ復帰時の中央表示");
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("public/samples/vhslide-10x40.json");
  await expect(page.locator(".slide-card")).toHaveCount(400);
  const cdp = await page.context().newCDPSession(page);
  const map = page.locator(".map-scroll");
  for (const number of ["20.6", "1.1", "40.10"]) {
    const [row, column] = number.split(".").map(Number);
    const card = page
      .locator(`.grid-row`)
      .nth(row - 1)
      .locator(".slide-card")
      .nth(column - 1);
    await card.locator(".thumbnail").click();
    await noFlight(page);
    const box = (await page.locator(".editor-pager").boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await points(cdp, "touchStart", x, y, 90);
    await points(cdp, "touchMove", x, y, 83);
    await points(cdp, "touchMove", x, y, 95);
    await points(cdp, "touchEnd", x, y, 0);
    await expect(map).toBeVisible();
    await noFlight(page);
    await expect(card.locator(".slide-canvas")).toHaveCount(1);
    const position = await card.locator(".thumbnail").evaluate((node) => {
      const viewport = document.querySelector<HTMLElement>(".map-scroll")!;
      const v = viewport.getBoundingClientRect(),
        b = node.getBoundingClientRect();
      return {
        dx:
          b.x +
          b.width / 2 -
          v.x -
          viewport.clientLeft -
          viewport.clientWidth / 2,
        dy:
          b.y +
          b.height / 2 -
          v.y -
          viewport.clientTop -
          viewport.clientHeight / 2,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
        maxLeft: viewport.scrollWidth - viewport.clientWidth,
        maxTop: viewport.scrollHeight - viewport.clientHeight,
      };
    });
    if (number === "20.6") {
      expect(Math.abs(position.dx)).toBeLessThanOrEqual(2);
      expect(Math.abs(position.dy)).toBeLessThanOrEqual(2);
    } else if (number === "1.1") {
      expect(position.left).toBeLessThanOrEqual(1);
      expect(position.top).toBeLessThanOrEqual(1);
    } else {
      expect(position.maxLeft - position.left).toBeLessThanOrEqual(1);
      expect(position.maxTop - position.top).toBeLessThanOrEqual(1);
    }
  }
});

test("pinching back to a last-row page reached in the editor scrolls the map to its bottom edge", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "タッチ用の大きい追加ボタン");
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("public/samples/vhslide-10x40.json");
  await expect(page.locator(".slide-card")).toHaveCount(400);
  const cdp = await page.context().newCDPSession(page);
  const map = page.locator(".map-scroll");
  await page.locator(".thumbnail").first().click();
  await noFlight(page);
  // The hidden map stays at the top, so the last row is not yet drawn in
  // detail when the map scrolls down to it.
  for (let i = 0; i < 39; i++) await page.keyboard.press("ArrowDown");
  const box = (await page.locator(".editor-pager").boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await points(cdp, "touchStart", x, y, 90);
  await points(cdp, "touchMove", x, y, 83);
  await points(cdp, "touchMove", x, y, 95);
  await points(cdp, "touchEnd", x, y, 0);
  await expect(map).toBeVisible();
  await noFlight(page);
  const card = page.locator(".grid-row").nth(39).locator(".slide-card").first();
  await expect(card.locator(".thumbnail")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(card.locator(".slide-canvas")).toHaveCount(1);
  expect(
    await map.evaluate(
      (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
    ),
  ).toBeLessThanOrEqual(1);
});

type Release = { label: string; computed: string; keyframes: string[] };
type Trackpad = {
  /** Pinch once at a point and return the preview it draws. */
  pinchAt(x: number, y: number, deltaY: number): string;
  /** Resolves in the frame where the latest pinch starts its release animation. */
  released: Promise<Release>;
};
/** Lets one evaluate pinch, wait for the release, and act within its frames. */
function installTrackpad(page: Page) {
  return page.addInitScript(() => {
    const pad = window as unknown as Trackpad;
    pad.pinchAt = (x, y, deltaY) => {
      const grid = document.querySelector<HTMLElement>(".map-grid")!;
      document.elementFromPoint(x, y)!.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY,
          clientX: x,
          clientY: y,
        }),
      );
      // Watch only after the pinch has completed any snap still running.
      pad.released = new Promise((resolve) =>
        (function wait() {
          const [animation] = grid.getAnimations();
          if (!animation) return requestAnimationFrame(wait);
          resolve({
            label: document.querySelector(".map-scale-reset")!.textContent!,
            computed: getComputedStyle(grid).transform,
            keyframes: (animation.effect as KeyframeEffect)
              .getKeyframes()
              .map((frame) => String(frame.transform)),
          });
        })(),
      );
      return grid.style.transform;
    };
  });
}
const previewScale = (transform: string) =>
  Number(transform.match(/scale\(([\d.e-]+)\)/)?.[1]);
async function settledMap(page: Page) {
  const grid = page.locator(".map-grid");
  await expect
    .poll(() => grid.evaluate((n) => n.getAnimations().length))
    .toBe(0);
  expect(await grid.evaluate((n) => n.style.transform)).toBe("");
  await expect(grid).not.toHaveAttribute("data-pinching");
}

test("a released trackpad pinch eases into the next step and keeps the slide under the pointer", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "トラックパッドのピンチ");
  await installTrackpad(page);
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("public/samples/vhslide-10x40.json");
  await expect(page.locator(".slide-card")).toHaveCount(400);
  const reset = page.getByRole("button", {
    name: "表示サイズを100%に戻す",
    exact: true,
  });
  const thumbnail = page
    .locator(".grid-row")
    .nth(19)
    .locator(".slide-card")
    .nth(4)
    .locator(".thumbnail");
  await thumbnail.evaluate((node) =>
    node.scrollIntoView({ block: "center", inline: "center" }),
  );
  const before = (await thumbnail.boundingBox())!;
  const x = before.x + before.width * 0.3,
    y = before.y + before.height * 0.4;
  const { preview, released } = await page.evaluate(
    async ({ x, y }) => {
      const pad = window as unknown as Trackpad;
      const preview = pad.pinchAt(x, y, 30);
      return { preview, released: await pad.released };
    },
    { x, y },
  );
  const pinched = previewScale(preview);
  expect(pinched).toBeCloseTo(Math.exp(-0.24), 3);
  // Released after the trackpad goes quiet: the preview is still drawn, and
  // eases from its size on screen into the 60% step.
  expect(released.label).toBe("100%");
  expect(released.computed).not.toBe("none");
  expect(previewScale(released.keyframes[0])).toBeCloseTo(pinched, 3);
  expect(previewScale(released.keyframes[1])).toBeCloseTo(0.6, 3);
  await expect(reset).toHaveText("60%");
  await settledMap(page);
  const after = (await thumbnail.boundingBox())!;
  expect(after.width).toBeCloseTo(before.width * 0.6, 0);
  expect(Math.abs(after.x + after.width * 0.3 - x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y + after.height * 0.4 - y)).toBeLessThanOrEqual(2);
});

test("a trackpad pinch resists past the next step, and pinching again mid-snap commits it once", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "トラックパッドのピンチ");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installTrackpad(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      "vhslide-workspace-preferences-v1",
      JSON.stringify({ zoomSteps: [30, 60, 100] }),
    ),
  );
  await page.goto("/");
  const reset = page.getByRole("button", {
    name: "表示サイズを100%に戻す",
    exact: true,
  });
  await expect(reset).toHaveText("100%");
  const box = (await page.locator(".thumbnail").first().boundingBox())!;
  const pinches = await page.evaluate(
    async ({ x, y }) => {
      const pad = window as unknown as Trackpad;
      const grid = document.querySelector<HTMLElement>(".map-grid")!;
      const resisted = pad.pinchAt(x, y, 200);
      await pad.released;
      // The next pinch starts while the first release is still easing.
      const easing = grid.getAnimations().length;
      const preview = pad.pinchAt(x, y, 30);
      return {
        resisted,
        easing,
        preview,
        label: document.querySelector(".map-scale-reset")!.textContent,
        animations: grid.getAnimations().length,
      };
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  // Pinching to 20% only reaches about 43%, so release does not leap back up.
  expect(previewScale(pinches.resisted)).toBeCloseTo(
    Math.exp(Math.log(0.6) + (-1.6 - Math.log(0.6)) * 0.3),
    3,
  );
  expect(pinches.easing).toBe(1);
  // The first step is committed before the second pinch takes over.
  expect(pinches.label).toBe("60%");
  expect(pinches.animations).toBe(0);
  expect(previewScale(pinches.preview)).toBeCloseTo(Math.exp(-0.24), 3);
  // The second pinch eases from 60% towards 30%, i.e. half its own start size.
  const released = await page.evaluate(
    () => (window as unknown as Trackpad).released,
  );
  expect(released.label).toBe("60%");
  expect(previewScale(released.keyframes[1])).toBeCloseTo(0.5, 3);
  await expect(reset).toHaveText("30%");
  await settledMap(page);
  // The interrupted snap must not commit a second time later on.
  await page.waitForTimeout(500);
  await expect(reset).toHaveText("30%");
  expect(errors).toEqual([]);
});

test("with reduced motion, a released trackpad pinch switches step at once", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "トラックパッドのピンチ");
  await installTrackpad(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const box = (await page.locator(".thumbnail").first().boundingBox())!;
  const animated = await page.evaluate(
    ({ x, y }) =>
      new Promise<boolean>((resolve) => {
        const grid = document.querySelector<HTMLElement>(".map-grid")!;
        const label = document.querySelector(".map-scale-reset")!;
        (window as unknown as Trackpad).pinchAt(x, y, 30);
        (function watch() {
          if (grid.getAnimations().length) return resolve(true);
          if (label.textContent === "60%") return resolve(false);
          requestAnimationFrame(watch);
        })();
      }),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(animated).toBe(false);
  await settledMap(page);
});
