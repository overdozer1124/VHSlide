import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
async function configure(page: Page, text: string) {
  await page
    .getByRole("button", { name: "マップの表示設定", exact: true })
    .click();
  await page
    .getByRole("button", { name: "マップの倍率を設定", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "倍率のステップ（%）", exact: true })
    .fill(text);
  await page
    .getByRole("button", { name: "この倍率で使う", exact: true })
    .click();
}
async function noFlight(page: Page) {
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
}
const saved = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));

test("custom zoom steps support the requested profiles, a 300% limit, validation, and persistence", async ({
  page,
}) => {
  await page.goto("/");
  const before = (await saved(page)).slides;
  const scale = page.locator(".map-scale-reset");
  const up = page.getByRole("button", { name: "マップを拡大", exact: true });
  const down = page.getByRole("button", { name: "マップを縮小", exact: true });
  await configure(page, "120, 30, 80, 80");
  await expect(scale).toHaveText("80%");
  await up.click();
  await expect(scale).toHaveText("120%");
  await expect(up).toBeDisabled();
  for (const expected of ["80%", "30%", "番号"]) {
    await down.click();
    await expect(scale).toHaveText(expected);
  }
  await expect(down).toBeDisabled();
  await configure(page, "80, 100");
  for (const expected of ["80%", "100%"]) {
    await up.click();
    await expect(scale).toHaveText(expected);
  }
  await configure(page, "80 100 200 300");
  await up.click();
  await expect(scale).toHaveText("200%");
  await up.click();
  await expect(scale).toHaveText("300%");
  await expect(up).toBeDisabled();
  expect(
    (await page.locator(".slide-card").first().boundingBox())!.width,
  ).toBeCloseTo(728, 0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await configure(page, "100, 301");
  await expect(page.getByRole("alert")).toContainText("10〜300");
  await expect(scale).toHaveText("300%");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(scale).toHaveText("100%");
  await up.click();
  await expect(scale).toHaveText("200%");
  await up.click();
  await expect(scale).toHaveText("300%");
  expect((await saved(page)).slides).toEqual(before);
});

test("pinch uses configured steps before opening the editor", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "タッチパッドの倍率ステップ");
  await page.goto("/");
  await configure(page, "30, 80, 120");
  const tile = page.locator(".thumbnail").first();
  async function pinchOut() {
    await tile.evaluate((node) => {
      const b = node.getBoundingClientRect();
      node.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -12,
          clientX: b.x + b.width / 2,
          clientY: b.y + b.height / 2,
        }),
      );
    });
  }
  await pinchOut();
  await expect(page.locator(".map-scale-reset")).toHaveText("120%");
  await expect(page.locator(".editor-pager")).toHaveCount(0);
  await pinchOut();
  await expect(page.locator(".editor-pager")).toBeVisible();
  await noFlight(page);
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await expect(page.locator(".map-scale-reset")).toHaveText("120%");
});

test("both editor panels fold independently, enlarge the canvas, and retain their preferences", async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === "touch"
      ? { width: 600, height: 900 }
      : { width: 1440, height: 1000 },
  );
  await page.goto("/");
  const before = (await saved(page)).slides;
  const open = () =>
    page
      .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
      .click();
  await open();
  await noFlight(page);
  const canvas = page.locator(".editor-pager");
  const width = (await canvas.boundingBox())!.width;
  await page
    .getByRole("button", { name: "サムネイルバーをたたむ", exact: true })
    .click();
  await expect(page.locator(".two-d-rail")).toHaveCount(0);
  await expect(page.locator(".inspector")).toBeVisible();
  await page
    .getByRole("button", { name: "右のサイドバーをたたむ", exact: true })
    .click();
  await expect(page.locator(".inspector")).toHaveCount(0);
  await expect
    .poll(async () => (await canvas.boundingBox())!.width)
    .toBeGreaterThan(width + 25);
  await page.screenshot({ path: info.outputPath("expanded-editor.png") });
  if (info.project.name === "desktop") {
    await page.setViewportSize({ width: 1366, height: 600 });
    await expect
      .poll(async () => {
        const title = (await page.locator(".canvas-title").boundingBox())!,
          slide = (await canvas.boundingBox())!;
        return title.y + title.height - slide.y;
      })
      .toBeLessThanOrEqual(1);
  }
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await page.reload();
  await open();
  await noFlight(page);
  await expect(page.locator(".two-d-rail")).toHaveCount(0);
  await expect(page.locator(".inspector")).toHaveCount(0);
  await page
    .getByRole("button", { name: "サムネイルバーを表示", exact: true })
    .click();
  await expect(page.locator(".two-d-rail")).toBeVisible();
  await page
    .getByRole("button", { name: "右のサイドバーを表示", exact: true })
    .click();
  await expect(page.locator(".inspector")).toBeVisible();
  expect((await saved(page)).slides).toEqual(before);
});

test("presentation fills the available 16:9 area and reveals controls at the screen edges", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "マウスでの発表操作");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  const mode = page.locator(".present-mode");
  await expect(mode).toBeVisible();
  await expect
    .poll(async () => {
      const a = (await mode.boundingBox())!,
        b = (await page
          .locator(".present-slide > .canvas-scale")
          .boundingBox())!;
      return Math.abs(b.width - Math.min(a.width, (a.height * 16) / 9));
    })
    .toBeLessThan(2);
  const bounds = (await mode.boundingBox())!;
  await page.mouse.move(bounds.width / 2, bounds.height / 2);
  await expect(mode).toHaveAttribute("data-controls-visible", "false");
  await expect
    .poll(() =>
      page
        .locator(".present-top")
        .evaluate((node) => getComputedStyle(node).opacity),
    )
    .toBe("0");
  await page.screenshot({
    path: info.outputPath("presentation-slide-only.png"),
  });
  await page.mouse.move(30, 5);
  await expect(mode).toHaveAttribute("data-controls-visible", "true");
  await expect
    .poll(() =>
      page
        .locator(".present-top")
        .evaluate((node) => getComputedStyle(node).opacity),
    )
    .toBe("1");
  await page.mouse.move(bounds.width / 2, bounds.height / 2);
  await expect(mode).toHaveAttribute("data-controls-visible", "false");
  await page.mouse.move(bounds.width - 40, bounds.height - 20);
  await expect(mode).toHaveAttribute("data-controls-visible", "true");
  await page.getByRole("button", { name: "次の話題", exact: true }).click();
  await expect(page.locator(".minimap-caption")).toHaveText("1.2 現在地");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".minimap-caption")).toHaveText("2.2 現在地");
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      page
        .locator(".present-top")
        .evaluate((node) => getComputedStyle(node).opacity),
    )
    .toBe("1");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "全体マップ", exact: true }),
  ).toBeVisible();
});

test("touch presentation can reveal hidden controls with a tap and still swipe between pages", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "タッチ端末の発表操作");
  await page.goto("/");
  await page.getByRole("button", { name: "発表する", exact: true }).tap();
  const mode = page.locator(".present-mode");
  await expect(mode).toHaveAttribute("data-controls-visible", "false");
  await mode.tap();
  await expect(mode).toHaveAttribute("data-controls-visible", "true");
  await page.getByRole("button", { name: "次の話題", exact: true }).tap();
  await expect(page.locator(".minimap-caption")).toHaveText("1.2 現在地");
  const cdp = await page.context().newCDPSession(page),
    b = (await mode.boundingBox())!;
  const start = { id: 1, x: b.width / 2, y: b.height * 0.7 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...start, y: start.y - 100 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".minimap-caption")).toHaveText("2.2 現在地");
  await expect(mode).toHaveAttribute("data-controls-visible", "false");
  await mode.tap();
  await page.getByRole("button", { name: "発表をおわる", exact: true }).tap();
  await expect(mode).toHaveCount(0);
});
