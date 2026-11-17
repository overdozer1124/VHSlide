import { test, expect } from "@playwright/test";
import { sample, serializeDeck } from "../../src/model";

// Regression (0.138.2): opening the editor for a work that is NOT saved to
// the cloud crashed to a white screen. The editor's sidebar binding check
// compared an absent element binding against an absent cloud deck id
// (undefined === undefined) and then dereferenced the missing element.
// Every existing editor spec runs on a cloud work, so this went unnoticed.
test("the editor opens for a local work that was never saved to the cloud", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".slide-card").first()).toBeVisible();
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".editor-pager")).toBeVisible();
  await expect(page.locator(".editor-pager .canvas-scale")).toBeVisible();
});

test("the editor opens for a work loaded from a file and not saved to the cloud", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".slide-card").first()).toBeVisible();
  const deck = sample();
  deck.title = "ファイルから開いた作品";
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "local-work.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeDeck(deck)),
    });
  await expect(page.locator(".toast")).toContainText("ファイルを開きました");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".editor-pager")).toBeVisible();
  await expect(page.locator(".editor-pager .canvas-scale")).toBeVisible();
});
