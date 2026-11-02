import { test, expect } from "@playwright/test";
import { sample } from "../../src/model";
import { worksheetTemplate } from "../../src/worksheetTemplates";
test("worksheet entry explains accounts and returns keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".slide-card")).toHaveCount(5);
  const launch = page.getByRole("button", {
    name: "アンケート・ワークシート",
    exact: true,
  });
  await launch.click();
  await page.getByRole("tab", { name: "ワークシート", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "ワークシート",
    exact: true,
  });
  await expect(dialog).toContainText("クラウドの共有作品で利用できます");
  await expect(
    dialog.getByRole("button", { name: "新しいワークシート" }),
  ).toHaveCount(0);
  await dialog.focus();
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
  await launch.click();
  await expect(
    page.getByRole("tab", { name: "ワークシート", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("dialog")).toHaveCount(1);
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

test("response fields have a visible toolbar entry and a centered accessible creation dialog", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".slide-card")).toHaveCount(5);
  const mainLaunch = page.getByRole("button", {
    name: "アンケート・ワークシート",
    exact: true,
  });
  await mainLaunch.click();
  await page.getByRole("tab", { name: "回答欄を追加", exact: true }).click();
  const first = page.getByRole("dialog", { name: "回答欄の追加", exact: true });
  const sharedId = await first.getAttribute("id");
  await expect(
    first.getByRole("heading", {
      name: "アンケート・ワークシート",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(mainLaunch).toBeFocused();
  await page.locator(".thumbnail").first().click();
  const launch = page.getByRole("button", {
    name: "回答欄を追加",
    exact: true,
  });
  await expect(launch).toBeVisible();
  const image = page.getByRole("button", { name: "画像", exact: true });
  expect((await launch.boundingBox())!.x).toBeLessThan(
    (await image.boundingBox())!.x,
  );
  await launch.click();
  const dialog = page.getByRole("dialog", {
    name: "回答欄の追加",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("id", sharedId!);
  await expect(dialog).toContainText("クラウドの共有作品");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(
    dialog.getByRole("tab", { name: "回答欄を追加", exact: true }),
  ).toHaveAttribute("aria-selected", "true");

  await expect(
    dialog.getByRole("button", { name: "スライドに追加", exact: true }),
  ).toHaveCount(0);
  const box = (await dialog.boundingBox())!;
  const width = await page.evaluate(() => innerWidth);
  expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(launch).toBeFocused();
});
