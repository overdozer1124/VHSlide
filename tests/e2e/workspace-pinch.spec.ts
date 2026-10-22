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
async function wheel(surface: Locator, deltaY: number) {
  await surface.evaluate((node, deltaY) => {
    const b = node.getBoundingClientRect();
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
  }, deltaY);
}
async function noFlight(page: Page) {
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
}

test("pinch follows the fingers, reverses, opens the focused slide, and returns without changing content", async ({
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
  // Holding and reversing must not switch views or leave the map enlarged.
  await page.waitForTimeout(160);
  await expect(page.locator(".editor-pager")).toHaveCount(0);
  await points(cdp, "touchMove", x, y, 35);
  await points(cdp, "touchEnd", x, y, 0);
  await expect(
    page.getByRole("button", { name: "表示サイズを80%に戻す", exact: true }),
  ).toHaveText("80%");
  const b2 = (await tile.boundingBox())!;
  const x2 = b2.x + b2.width / 2,
    y2 = b2.y + b2.height / 2;
  await points(cdp, "touchStart", x2, y2, 35);
  await points(cdp, "touchMove", x2, y2, 75);
  await points(cdp, "touchEnd", x2, y2, 0);
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("自然がいっぱい");
  await noFlight(page);
  const pager = page.locator(".editor-pager");
  const e = (await pager.boundingBox())!;
  const ex = e.x + e.width / 2,
    ey = e.y + e.height / 2;
  await points(cdp, "touchStart", ex, ey, 100);
  await points(cdp, "touchMove", ex, ey, 70);
  await expect
    .poll(async () => (await pager.boundingBox())!.width)
    .toBeLessThan(e.width * 0.8);
  await points(cdp, "touchMove", ex, ey, 100);
  await points(cdp, "touchEnd", ex, ey, 0);
  await expect
    .poll(async () => (await pager.boundingBox())!.width)
    .toBeCloseTo(e.width, 0);
  await points(cdp, "touchStart", ex, ey, 100);
  await points(cdp, "touchMove", ex, ey, 50);
  await points(cdp, "touchEnd", ex, ey, 0);
  await expect(page.locator(".map-scroll")).toBeVisible();
  await noFlight(page);
  await expect(tile).toHaveAttribute("aria-current", "page");
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
  await wheel(first, -100);
  await expect(page.locator(".editor-pager")).toBeVisible();
  await noFlight(page);
  await wheel(page.locator(".editor-pager"), 70);
  await expect(page.locator(".map-scroll")).toBeVisible();
  await noFlight(page);
  const reset = page.getByRole("button", {
    name: "表示サイズを80%に戻す",
    exact: true,
  });
  for (let i = 0; i < 9; i++)
    await page
      .getByRole("button", { name: "マップを縮小", exact: true })
      .click();
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

test("map pinch cancels safely and one finger still scrolls the large map", async ({
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
  await points(cdp, "touchMove", x, y, 60);
  await points(cdp, "touchCancel", x, y, 0);
  await expect(
    page.getByRole("button", { name: "表示サイズを80%に戻す", exact: true }),
  ).toHaveText("80%");
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
