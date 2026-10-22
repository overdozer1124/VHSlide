import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const handle = (page: Page) =>
  page.getByRole("separator", { name: "サムネイルバーの幅", exact: true });
async function open(page: Page) {
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
}
async function drag(page: Page, dx: number) {
  const box = (await handle(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
}
async function width(page: Page) {
  return (await page.locator(".two-d-rail").boundingBox())!.width;
}

test("dragging the rail boundary scales previews, clamps width, and persists without editing slides", async ({
  page,
}) => {
  await page.goto("/");
  const slides = await page.evaluate(
    () => JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides,
  );
  await open(page);
  const standard = await width(page);
  const preview = page.locator(".rail-preview").first();
  const initialPreview = (await preview.boundingBox())!.width;
  // Open a row overlay before resizing: it must close rather than block the drag.
  await page
    .getByRole("button", { name: "1段目の横のページをひらく", exact: true })
    .click();
  await expect(page.locator(".row-flyout")).toBeVisible();
  await drag(page, standard * 0.4);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "140");
  await expect(page.locator(".row-flyout")).toHaveCount(0);
  expect(await width(page)).toBeCloseTo(standard * 1.4, 0);
  await expect
    .poll(async () => (await preview.boundingBox())!.width)
    .toBeGreaterThan(initialPreview + 20);
  await expect
    .poll(async () => {
      const a = (await preview.boundingBox())!,
        b = (await preview.locator(".canvas-scale").boundingBox())!;
      return Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
    })
    .toBeLessThan(2);
  await drag(page, 400);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "150");
  expect(await width(page)).toBeCloseTo(standard * 1.5, 0);
  await drag(page, -500);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "80");
  expect(await width(page)).toBeCloseTo(standard * 0.8, 0);
  await page
    .getByRole("button", { name: "サムネイルバーをたたむ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "サムネイルバーを表示", exact: true })
    .click();
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "80");
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await page.reload();
  await open(page);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "80");
  expect(await width(page)).toBeCloseTo(standard * 0.8, 0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides,
    ),
  ).toEqual(slides);
  await expect(
    page.getByRole("button", { name: "もとに戻す", exact: true }),
  ).toBeDisabled();
  await handle(page).dblclick();
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "100");
  expect(await width(page)).toBeCloseTo(standard, 0);
});

test("the resize boundary supports keyboard limits and adapts to a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto("/");
  await open(page);
  const standard = await width(page);
  await handle(page).focus();
  await page.keyboard.press("End");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "150");
  expect(await width(page)).toBeCloseTo(standard * 1.5, 0);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "85");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "80");
  expect(await width(page)).toBeCloseTo(standard * 0.8, 0);
  const rail = (await page.locator(".two-d-rail").boundingBox())!,
    workspace = (await page.locator(".editor-workspace").boundingBox())!;
  expect(workspace.x).toBeCloseTo(rail.x + rail.width, 0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(600);
});
