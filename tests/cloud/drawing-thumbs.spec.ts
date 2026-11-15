import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { sample } from "../../src/model";
import { worksheetTemplate } from "../../src/worksheetTemplates";
const headers = { Origin: "http://127.0.0.1:3187" };
const modal = (page: Page) =>
  page.getByRole("dialog", { name: "ワークシート", exact: true });

async function signIn(page: Page, name: string) {
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential: name },
      })
    ).status(),
  ).toBe(200);
}

async function expectLoadedImage(locator: ReturnType<Page["locator"]>) {
  await expect(locator).toBeVisible({ timeout: 15_000 });
  expect(
    await locator.evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
}

test("drawing answers show in slide thumbnails (map and editor rail)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, "thumbs-host");
  const { id } = await (
    await page.request.post("/api/decks", { headers, data: sample() })
  ).json();
  const template = worksheetTemplate("blank");
  template.fields[0].kind = "drawing";
  template.fields[0].label = "自分の絵";
  const fieldId = template.fields[0].id;
  const created = await page.request.post(`/api/decks/${id}/worksheets`, {
    headers,
    data: template,
  });
  const sheet = (await created.json()).worksheets[0];
  await page.request.post(`/api/decks/${id}/worksheets/${sheet.id}/status`, {
    headers,
    data: { status: "open" },
  });
  await page.goto(`/?room=${id}`);
  // Answer in the dialog with a red picture.
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await page
    .getByRole("tab", { name: "ワークシート", exact: true })
    .click();
  await modal(page)
    .getByRole("button", { name: "自分で入力", exact: true })
    .click();
  await modal(page)
    .getByRole("button", { name: "自分の絵の画像・手描きを編集" })
    .click();
  const drawing = modal(page).locator(".worksheet-drawing");
  await drawing.evaluate(async (section) => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 150;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#d42a1e";
    ctx.fillRect(0, 0, 200, 150);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const input = section.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob!], "red.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
        ).worksheets[0].own?.values[fieldId],
      { timeout: 15_000 },
    )
    .toContain('"flat"');
  await modal(page)
    .getByRole("button", { name: "完了", exact: true })
    .click();
  await page.locator(".activity-panel header button").click();
  await expect(page.locator(".activity-panel")).toBeHidden();
  // Place the worksheet on the first slide.
  await page.locator(".thumbnail").first().click();
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await page
    .getByRole("tab", { name: "ワークシート", exact: true })
    .click();
  await modal(page)
    .getByRole("button", { name: "このワークシートをスライドに配置" })
    .click();
  await expect(page.locator(".slide-worksheet.is-interactive")).toBeVisible();
  // The overall map thumbnail shows the picture.
  await page
    .getByRole("button", { name: "全体マップへ", exact: true })
    .click();
  await expectLoadedImage(
    page.locator(".slide-card .worksheet-drawing-image").first(),
  );
  // Convert to an individual response field; its map thumbnail shows it too.
  await page.locator(".slide-card").first().click();
  await page
    .locator(".editor-workspace .slide-worksheet header h3")
    .click();
  await page
    .getByRole("button", { name: "入力欄を個別に配置" })
    .click();
  await expect(page.locator(".editor-workspace .response-field")).toHaveCount(
    1,
  );
  await page
    .getByRole("button", { name: "全体マップへ", exact: true })
    .click();
  await expectLoadedImage(
    page.locator(".slide-card .worksheet-drawing-image").first(),
  );
});
