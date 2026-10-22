import { test, expect } from "@playwright/test";
import { blank } from "../../src/model.ts";

test("imports 400 sample pages, selects the last thumbnail, and restores the deck", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "desktop")
    await page.setViewportSize({ width: 1280, height: 720 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles("public/samples/vhslide-10x40.json");
  await expect(page.locator(".slide-card")).toHaveCount(400);
  await page
    .getByRole("button", {
      name: "1.1 まちの紹介｜はじめにを編集",
      exact: true,
    })
    .click();
  await expect(page.locator(".rail-trigger")).toHaveCount(40);
  const row = page.getByRole("button", {
    name: "40段目の横のページをひらく",
    exact: true,
  });
  if (testInfo.project.name === "touch") await row.tap();
  else await row.click();
  const popup = page.getByRole("region", { name: "40段目の横のページ一覧" });
  await expect(popup.locator(".row-page")).toHaveCount(10);
  const last = popup.getByRole("button", {
    name: "40.10 40.10 まとめ｜おわりにを編集",
    exact: true,
  });
  if (testInfo.project.name === "touch") await last.tap();
  else await last.click();
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "40.10 まとめ｜おわりに",
  );
  await expect(
    page.locator(".rail-trigger.rail-active .rail-coordinate > span").first(),
  ).toHaveText("40.10");
  await page.reload();
  await expect(page.locator(".slide-card")).toHaveCount(400);
  await page
    .getByRole("button", {
      name: "1.1 まちの紹介｜はじめにを編集",
      exact: true,
    })
    .click();
  await expect(page.locator(".rail-trigger").last()).toContainText("40.10");
  expect(errors).toEqual([]);
});

test("adds page 1000, blocks page 1001, and restores the complete deck", async ({
  page,
}) => {
  test.setTimeout(60000);
  const deck = {
    version: 1,
    title: "1000枚の作品",
    slides: Array.from({ length: 999 }, (_, i) => ({
      ...blank(i % 20, Math.floor(i / 20)),
      title: `ページ${i + 1}`,
    })),
  };
  await page.goto("/");
  const input = page.locator("input[type=file]").first();
  await input.setInputFiles({
    name: "999-pages.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(deck)),
  });
  await expect(page.locator(".slide-card")).toHaveCount(999);
  const add = page.getByRole("button", {
    name: "ページ1の右に次の話題を追加",
    exact: true,
  });
  await add.click();
  await expect(page.locator(".slide-card")).toHaveCount(1000);
  await add.click();
  await expect(page.getByRole("status")).toHaveText("ページは1000枚までです。");
  await expect(page.locator(".slide-card")).toHaveCount(1000);
  await page.reload();
  await expect(page.locator(".slide-card")).toHaveCount(1000);
  const full = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  );
  await input.setInputFiles({
    name: "1001-pages.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        ...full,
        title: "読み込めない作品",
        slides: [...full.slides, blank(99, 99)],
      }),
    ),
  });
  await expect(page.getByRole("status")).toHaveText(
    "対応するVHSlideファイルではありません。",
  );
  await expect(
    page.getByRole("textbox", { name: "作品のタイトル" }),
  ).toHaveValue("1000枚の作品");
  await expect(page.locator(".slide-card")).toHaveCount(1000);
});
