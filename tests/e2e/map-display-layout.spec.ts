import { test, expect } from "@playwright/test";
import { scopeBook } from "../support/scopeBook";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (book) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(book)),
    scopeBook(),
  );
  await page.goto("/");
});

test("map display settings contain form input, stay in view as they expand and discard unapplied edits", async ({
  page,
}, info) => {
  const trigger = page.getByRole("button", {
    name: "マップの表示設定",
    exact: true,
  });
  const panel = page.getByRole("dialog", {
    name: "マップの表示設定",
    exact: true,
  });
  const before = await page.evaluate(() =>
    localStorage.getItem("vhslide-deck-v1"),
  );
  await expect(
    page
      .getByRole("group", { name: "マップの表示サイズ", exact: true })
      .getByRole("button"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "番号だけの一覧", exact: true }),
  ).toHaveCount(0);
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1024, height: 600 },
    { width: 390, height: 640 },
  ]) {
    await page.setViewportSize(size);
    await trigger.click();
    await panel
      .getByRole("button", { name: "マップの倍率を設定", exact: true })
      .click();
    const input = panel.getByRole("textbox", {
      name: "倍率のステップ（%）",
      exact: true,
    });
    await expect(input).toBeFocused();
    await input.fill("100, 301");
    await panel
      .getByRole("button", { name: "この倍率で使う", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("10〜300");
    await expect
      .poll(async () => {
        const r = (await panel.boundingBox())!;
        return (
          r.x >= 0 &&
          r.y >= 0 &&
          r.x + r.width <= size.width + 1 &&
          r.y + r.height <= size.height + 1
        );
      })
      .toBe(true);
    await page.screenshot({
      path: info.outputPath(`display-${size.width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await trigger.click();
  await panel
    .getByRole("button", { name: "マップの倍率を設定", exact: true })
    .click();
  await expect(
    panel.getByRole("textbox", { name: "倍率のステップ（%）", exact: true }),
  ).toHaveValue("60, 100");
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() => localStorage.getItem("vhslide-deck-v1")),
  ).toBe(before);
});

test("display actions retain numbers, fit and current-page behavior without clearing selected slides", async ({
  page,
}) => {
  const trigger = page.getByRole("button", {
    name: "マップの表示設定",
    exact: true,
  });
  await page
    .getByRole("button", { name: "スライドを複数選択", exact: true })
    .click();
  await page.locator('[data-page-id="p00"] .thumbnail').click();
  await page
    .locator('[data-page-id="p11"] .thumbnail')
    .click({ modifiers: ["Control"] });
  await trigger.click();
  await page
    .getByRole("button", { name: "番号だけの一覧", exact: true })
    .click();
  await expect(page.locator(".map-scale-reset")).toHaveText("番号");
  await expect(page.locator('[data-multi-selected="true"]')).toHaveCount(2);
  await trigger.click();
  await expect(
    page.getByRole("button", { name: "番号だけの一覧", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "番号だけの一覧", exact: true })
    .click();
  await expect(page.locator(".map-scale-reset")).toHaveText("60%");
  await trigger.click();
  await page.getByRole("button", { name: "横をおさめる", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "マップの表示設定", exact: true }),
  ).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page
    .getByRole("button", { name: "いまのページを表示", exact: true })
    .click();
  await expect(page.locator('[data-page-id="p00"]')).toBeInViewport();
  await expect(page.locator('[data-multi-selected="true"]')).toHaveCount(2);
});

test("display popup closes when leaving the map through keyboard navigation", async ({
  page,
}) => {
  const trigger = page.getByRole("button", {
    name: "マップの表示設定",
    exact: true,
  });
  await trigger.click();
  await page.getByRole("button", { name: "ページを編集", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".editor-layout")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "マップの表示設定", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await expect(trigger).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "マップの表示設定", exact: true }),
  ).toHaveCount(0);
});

test("display popup closes when a trackpad pinch opens the editor", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "トラックパッド相当の操作");
  await page
    .getByRole("button", { name: "マップの表示設定", exact: true })
    .click();
  await page
    .locator(".thumbnail")
    .first()
    .evaluate((node) => {
      const b = node.getBoundingClientRect();
      node.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -90,
          clientX: b.x + b.width / 2,
          clientY: b.y + b.height / 2,
        }),
      );
    });
  await expect(page.locator(".editor-layout")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "マップの表示設定", exact: true }),
  ).toHaveCount(0);
});
