import { test, expect } from "@playwright/test";

test("local survey entry explains sharing, traps focus and closes without changing the work", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".slide-card")).toHaveCount(5);
  const launch = page.getByRole("button", { name: "アンケート", exact: true });
  await launch.click();
  const dialog = page.getByRole("dialog", { name: "アンケート", exact: true });
  await expect(dialog).toContainText("アンケートはクラウドの作品で使えます");
  await expect(
    dialog.getByRole("button", { name: "新しいアンケート" }),
  ).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "アンケートを閉じる" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "アンケートを閉じる" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(launch).toBeFocused();
  await expect(page.locator(".slide-card")).toHaveCount(5);
});

test("portable survey cards render inside a slide without accessing another work's answers", async ({
  page,
}, info) => {
  const { sample } = await import("../../src/model");
  const deck = sample();
  deck.title = "スライド内アンケート";
  deck.slides = [deck.slides[0]];
  deck.slides[0].elements = [
    {
      id: "survey-choice",
      type: "shape",
      shape: "rounded",
      x: 20,
      y: 50,
      w: 440,
      h: 440,
      fill: "#ffffff",
      stroke: "#587d59",
      survey: {
        deckId: "11111111-1111-1111-1111-111111111111",
        surveyId: "22222222-2222-2222-2222-222222222222",
        question: "どの季節が好きですか？",
        kind: "single",
        options: ["春", "夏", "秋", "冬"],
      },
    },
    {
      id: "survey-text",
      type: "shape",
      shape: "rounded",
      x: 500,
      y: 50,
      w: 440,
      h: 440,
      fill: "#ffffff",
      stroke: "#587d59",
      survey: {
        deckId: "11111111-1111-1111-1111-111111111111",
        surveyId: "33333333-3333-3333-3333-333333333333",
        question: "今日の気づきを書いてください",
        kind: "text",
        options: [],
      },
    },
  ];
  let requests = 0;
  await page.route("**/api/decks/*/surveys**", async (route) => {
    requests++;
    await route.fulfill({ status: 403, json: { error: "Access denied" } });
  });
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "survey-cards.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(deck)),
    });
  await expect(page.locator(".slide-card .slide-survey")).toHaveCount(2);
  await expect(
    page.locator(
      ".slide-card .slide-survey input,.slide-card .slide-survey textarea",
    ),
  ).toHaveCount(0);
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await expect(page.locator(".editor-workspace .slide-survey")).toHaveCount(2);
  await expect(
    page.locator(".editor-workspace .slide-survey").first(),
  ).toContainText("どの季節が好きですか？");
  await expect(
    page.locator(".editor-workspace .slide-survey").last(),
  ).toContainText("今日の気づきを書いてください");
  await expect(
    page.locator(".editor-workspace .slide-survey form"),
  ).toHaveCount(0);
  await expect(
    page.locator(".editor-workspace .slide-survey").first(),
  ).toContainText("元のクラウド作品");
  expect(requests).toBe(0);
  await page.screenshot({
    path: info.outputPath("portable-survey-cards.png"),
    fullPage: true,
  });
});
