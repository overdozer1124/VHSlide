import { test, expect } from "@playwright/test";
import { sample, serializeDeck } from "../../src/model";

test("adds a JSON work below the current sheet and can undo without replacing existing pages", async ({
  page,
}) => {
  await page.goto("/");
  const before = page.locator(".slide-card");
  await expect(before).toHaveCount(5);
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: /JSONを現在のシートに追加/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const source = sample();
  source.slides[0].title = "追加されたページ";
  await page
    .locator('input[type="file"]')
    .nth(2)
    .setInputFiles({
      name: "source.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeDeck(source)),
    });
  await expect(page.locator(".toast")).toContainText(
    "JSONの5ページを現在のシートの下に追加しました",
  );
  await expect(before).toHaveCount(10);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides.some(
          (s: { title: string }) => s.title === "追加されたページ",
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect(before).toHaveCount(5);
  await page
    .locator('input[type="file"]')
    .nth(2)
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("not json"),
    });
  await expect(before).toHaveCount(5);
});
