import { test, expect } from "@playwright/test";

test("editable map headings stay readable and meet the scrollport without gaps at 300%", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("public/samples/vhslide-10x40.json");
  const column = page.getByRole("textbox", {
    name: "列2の見出し",
    exact: true,
  });
  const row = page.getByRole("textbox", { name: "行8の見出し", exact: true });
  await expect(column).toHaveCSS("font-size", "16px");
  await column.fill("自然と公園");
  await column.press("Enter");
  await column.fill("取り消す名前");
  await column.press("Escape");
  await expect(column).toHaveValue("自然と公園");
  await row.fill("8班の調査");
  await row.press("Enter");
  await expect(row).toHaveCSS("writing-mode", "vertical-rl");
  const rowGeometry = await row.evaluate((node) => {
    const field = node.getBoundingClientRect();
    const axis = node.closest(".row-axis")!.getBoundingClientRect();
    return {
      width: axis.width,
      centerOffset: field.x + field.width / 2 - (axis.x + axis.width / 2),
    };
  });
  expect(rowGeometry.width).toBe(56);
  expect(Math.abs(rowGeometry.centerOffset)).toBeLessThan(1);
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
  expect((await saved()).sheets[0]).toMatchObject({
    columnLabels: { 1: "自然と公園" },
    rowLabels: { 7: "8班の調査" },
  });
  await page.reload();
  await expect(column).toHaveValue("自然と公園");
  await expect(row).toHaveValue("8班の調査");
  await page
    .getByRole("button", { name: "マップの倍率を設定", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "倍率のステップ（%）", exact: true })
    .fill("100, 300");
  await page
    .getByRole("button", { name: "この倍率で使う", exact: true })
    .click();
  await page.getByRole("button", { name: "マップを拡大", exact: true }).click();
  const scroll = page.locator(".map-scroll");
  await scroll.evaluate((node) => {
    node.scrollLeft = 860;
    node.scrollTop = 3500;
  });
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(3500);
  const geometry = await scroll.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const corner = document
      .querySelector(".map-axis-corner")!
      .getBoundingClientRect();
    const heading = document
      .querySelector(".column-heading")!
      .getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      cornerX: corner.x,
      cornerY: corner.y,
      headingY: heading.y,
      topHit: !!document
        .elementFromPoint(r.x + 120, r.y + 2)
        ?.closest(".column-heading"),
      leftHit: !!document
        .elementFromPoint(r.x + 2, r.y + 140)
        ?.closest(".row-axis"),
      padding: getComputedStyle(node).padding,
    };
  });
  expect(geometry.cornerX).toBeCloseTo(geometry.x, 0);
  expect(geometry.cornerY).toBeCloseTo(geometry.y, 0);
  expect(geometry.headingY).toBeCloseTo(geometry.y, 0);
  expect(geometry.topHit).toBe(true);
  expect(geometry.leftHit).toBe(true);
  expect(geometry.padding).toBe("0px");
  await page.screenshot({
    path: info.outputPath("map-readable-headers-300.png"),
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});
