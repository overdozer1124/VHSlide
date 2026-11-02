import { test, expect } from "@playwright/test";
import { sample } from "../../src/model";
import { worksheetTemplate } from "../../src/worksheetTemplates";
test("worksheet entry explains accounts and returns keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".slide-card")).toHaveCount(5);
  const launch = page.getByRole("button", {
    name: "ワークシート",
    exact: true,
  });
  await launch.click();
  const dialog = page.getByRole("dialog", {
    name: "ワークシート",
    exact: true,
  });
  await expect(dialog).toContainText("クラウドの共有作品で利用できます");
  await expect(
    dialog.getByRole("button", { name: "新しいワークシート" }),
  ).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "ワークシートを閉じる" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("tab", { name: "ワークシート", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "ワークシートを閉じる" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(launch).toBeFocused();
});
test("portable worksheet definitions render without reading the source accounts", async ({
  page,
}, info) => {
  const book = sample();
  book.slides = [book.slides[0]];
  book.slides[0].elements = [
    {
      id: "worksheet",
      type: "shape",
      shape: "rounded",
      x: 20,
      y: 15,
      w: 920,
      h: 510,
      fill: "#ffffff",
      stroke: "#dc8945",
      worksheet: {
        ...worksheetTemplate("plan"),
        deckId: "11111111-1111-1111-1111-111111111111",
        worksheetId: "22222222-2222-2222-2222-222222222222",
      },
    },
  ];
  let requests = 0;
  await page.route("**/api/decks/*/worksheets**", async (route) => {
    requests++;
    await route.fulfill({ status: 403, json: { error: "denied" } });
  });
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "worksheet.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(book)),
    });
  await expect(page.locator(".slide-card .slide-worksheet")).toHaveCount(1);
  await page.locator(".thumbnail").first().click();
  const card = page.locator(".editor-workspace .slide-worksheet");
  await expect(card).toContainText("私の食生活改善プラン");
  await expect(
    card.getByRole("textbox", { name: "今の自分の課題", exact: true }),
  ).toBeDisabled();
  await expect(card).toContainText("元の共有作品");
  expect(requests).toBe(0);
  await page.screenshot({
    path: info.outputPath("worksheet-preview.png"),
    fullPage: true,
  });
});
