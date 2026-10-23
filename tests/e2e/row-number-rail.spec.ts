import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
const title = (p: Page) =>
  p.getByRole("textbox", { name: "ページの名前", exact: true });
async function start(page: Page) {
  await page.setViewportSize({ width: 1366, height: 660 });
  await page.addInitScript(() => {
    if (!localStorage.getItem("vhslide-deck-v1"))
      localStorage.setItem(
        "vhslide-deck-v1",
        JSON.stringify({
          version: 1,
          title: "行ジャンプ",
          rowSelections: ["s-119"],
          slides: Array.from({ length: 120 }, (_, i) => ({
            id: `s-${i}`,
            x: i % 3,
            y: Math.floor(i / 3),
            title: `ページ${Math.floor(i / 3) + 1}.${(i % 3) + 1}`,
            background: "#e5f0dc",
            elements: [],
          })),
        }),
      );
  });
  await page.goto("/");
}
async function open(page: Page) {
  await button(page, "ページ1.1を編集").click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await button(page, "行番号一覧").click();
}

test("compact row grid jumps on click or tap, keeps remembered pages and restores thumbnails and preference", async ({
  page,
}, testInfo) => {
  await start(page);
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides,
  );
  await open(page);
  await expect(button(page, "行番号一覧")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".rail-row-number")).toHaveCount(40);
  await expect(page.locator(".rail-preview")).toHaveCount(0);
  const first = (await button(page, "1行目へ移動").boundingBox())!;
  const second = (await button(page, "2行目へ移動").boundingBox())!;
  expect(second.x).toBeGreaterThan(first.x);
  expect(second.y).toBe(first.y);
  const last = (await button(page, "40行目へ移動").boundingBox())!;
  const pane = (await page.locator(".rail-scroll").boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(pane.y + pane.height);
  if (testInfo.project.name === "touch")
    await button(page, "40行目へ移動").tap();
  else await button(page, "40行目へ移動").click();
  await expect(title(page)).toHaveValue("ページ40.3");
  await expect(button(page, "40行目へ移動")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await button(page, "12行目へ移動").focus();
  await page.keyboard.press("Enter");
  await expect(title(page)).toHaveValue("ページ12.1");
  await button(page, "40行目へ移動").click();
  await button(page, "行番号一覧").click();
  await expect(page.locator(".rail-number-grid")).toHaveCount(0);
  const selected = (await button(
    page,
    "40段目の横のページをひらく",
  ).boundingBox())!;
  const viewport = (await page.locator(".rail-scroll").boundingBox())!;
  expect(selected.y).toBeGreaterThanOrEqual(viewport.y - 1);
  expect(selected.y + selected.height).toBeLessThanOrEqual(
    viewport.y + viewport.height + 1,
  );
  const preview = page.locator(".rail-active .rail-preview");
  const canvas = preview.locator(".canvas-scale");
  await expect
    .poll(async () =>
      Math.abs(
        (await preview.boundingBox())!.width -
          (await canvas.boundingBox())!.width,
      ),
    )
    .toBeLessThan(2);
  await button(page, "行番号一覧").click();
  await page.reload();
  await button(page, "ページ1.1を編集").click();
  await expect(button(page, "行番号一覧")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides,
    ),
  ).toEqual(before);
});

test("filtered row grid preserves original row numbers and only jumps to eligible pages", async ({
  page,
}) => {
  await start(page);
  await button(page, "マップをフィルタ").click();
  await button(page, "フィルタする行2").click();
  await button(page, "フィルタする行40").click();
  await button(page, "フィルタを適用").click();
  await button(page, "ページ2.1を編集").click();
  await button(page, "行番号一覧").click();
  await expect(page.locator(".rail-row-number")).toHaveText(["2", "40"]);
  await button(page, "40行目へ移動").click();
  await expect(title(page)).toHaveValue("ページ40.3");
  await button(page, "行番号一覧").click();
  await expect(page.locator(".rail-trigger")).toHaveCount(2);
});
