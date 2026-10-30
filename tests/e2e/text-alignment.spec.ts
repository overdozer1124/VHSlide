import { saveJSON } from "../support/file-save";
import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const data = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
async function createText(page: Page) {
  await page.goto("/");
  await button(page, "わたしたちのまちを編集").click();
  await button(page, "文字").click();
  const input = page.getByRole("textbox", {
    name: "スライド内の文字",
    exact: true,
  });
  await input.fill("配置のテスト\n2行目");
  await input.press("Escape");
  return page.locator(".editor-workspace .selected-element");
}
async function position(layout: Locator) {
  return layout.evaluate((node) => {
    const content = node.querySelector<HTMLElement>(".slide-text")!;
    const text = content.querySelector(".ql-editor") ?? content;
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode()!;
    const range = document.createRange();
    range.selectNodeContents(first);
    const line = range.getClientRects()[0],
      box = node.getBoundingClientRect(),
      inner = content.getBoundingClientRect();
    return {
      x: (line.left - box.left) / (box.width - line.width),
      y: (inner.top - box.top) / (box.height - inner.height),
    };
  });
}
async function expectPosition(layout: Locator, x: number, y: number) {
  await expect
    .poll(async () => Math.abs((await position(layout)).x - x))
    .toBeLessThan(0.03);
  await expect
    .poll(async () => Math.abs((await position(layout)).y - y))
    .toBeLessThan(0.03);
}

test("all nine text positions match while reading and typing, without moving the box", async ({
  page,
}) => {
  const selected = await createText(page),
    layout = selected.locator(".text-layout");
  const original = (await data(page)).slides[0].elements.at(-1);
  for (const [labelX, x] of [
    ["左揃え", 0],
    ["中央揃え", 0.5],
    ["右揃え", 1],
  ] as const)
    for (const [labelY, y] of [
      ["上揃え", 0],
      ["上下中央揃え", 0.5],
      ["下揃え", 1],
    ] as const) {
      await button(page, `文字を${labelX}`).click();
      await button(page, `文字を${labelY}`).click();
      await expectPosition(layout, x, y);
      await expect(button(page, `文字を${labelX}`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(button(page, `文字を${labelY}`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
  const aligned = (await data(page)).slides[0].elements.at(-1);
  for (const field of ["x", "y", "w", "h", "text"])
    expect(aligned[field]).toEqual(original[field]);
  await selected.click();
  const input = page.getByRole("textbox", {
    name: "スライド内の文字",
    exact: true,
  });
  await expect(input).toBeFocused();
  await expectPosition(layout, 1, 1);
  await input.press("End");
  await page.keyboard.insertText(" 追記");
  await expect(input).toContainText("追記");
  await expectPosition(layout, 1, 1);
  // An empty editor must retain a visible line; overflowing content stays inside
  // the box and can be edited even with bottom alignment.
  await input.fill("");
  expect((await input.boundingBox())!.height).toBeGreaterThan(10);
  await input.fill(
    Array.from({ length: 20 }, (_, i) => `長い文章 ${i}`).join("\n"),
  );
  const box = (await layout.boundingBox())!,
    inner = (await input.boundingBox())!;
  expect(inner.y).toBeGreaterThanOrEqual(box.y - 1);
  expect(inner.height).toBeLessThanOrEqual(box.height + 1);
  await input.press("Escape");
  expect((await data(page)).slides[0].elements.at(-1).text).toContain(
    "長い文章 19",
  );
});

test("text alignment survives undo, JSON restoration, reload, thumbnails and presentation", async ({
  page,
}) => {
  const selected = await createText(page);
  await button(page, "文字を右揃え").click();
  await button(page, "文字を下揃え").click();
  await button(page, "もとに戻す").click();
  await expect(button(page, "文字を上揃え")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await button(page, "やり直す").click();
  await expectPosition(selected.locator(".text-layout"), 1, 1);
  const download = page.waitForEvent("download");
  await saveJSON(page);
  const file = await download,
    deck = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(deck.slides[0].elements.at(-1)).toMatchObject({
    textAlign: "right",
    verticalAlign: "bottom",
  });
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "alignment.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(deck)),
    });
  await page.reload();
  const preview = page
    .locator(".slide-card")
    .first()
    .locator(".text-layout")
    .filter({ hasText: "配置のテスト" });
  await expectPosition(preview, 1, 1);
  await button(page, "わたしたちのまちを編集").click();
  const restored = page
    .locator(".editor-workspace .text-layout")
    .filter({ hasText: "配置のテスト" });
  await expectPosition(restored, 1, 1);
  await button(page, "発表する").click();
  await expectPosition(
    page
      .locator(".present-slide .text-layout")
      .filter({ hasText: "配置のテスト" }),
    1,
    1,
  );
});
