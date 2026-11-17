import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { sample } from "../../src/model";
import { worksheetTemplate } from "../../src/worksheetTemplates";
const headers = { Origin: "http://127.0.0.1:3187" };
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
const modal = (page: Page) =>
  page.getByRole("dialog", { name: "ワークシート", exact: true });
const WHITE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);

// Regression test: the 「画像を追加」 label must open the file
// chooser. Pressing the label shifts focus out of the field, and the
// editor used to close on that blur before the click — so nothing
// responded at all. The other drawing specs set files on the hidden
// input directly and cannot see this failure.
test("the 画像を追加 label opens a chooser and adds the image", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "upload-label-host");
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
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await page.getByRole("tab", { name: "ワークシート", exact: true }).click();
  await modal(page)
    .getByRole("button", { name: "自分で入力", exact: true })
    .click();
  await modal(page)
    .getByRole("button", { name: "自分の絵の画像・手描きを編集" })
    .click();
  const drawing = modal(page).locator(".worksheet-drawing");
  await expect(drawing).toBeVisible();

  // Open the tools panel and click the upload label.
  await drawing.locator(".worksheet-drawing-toolbar button").first().click();
  const label = drawing.locator("label.worksheet-drawing-upload");
  await expect(label).toBeVisible();
  const chooserPromise = page.waitForEvent("filechooser", {
    timeout: 10_000,
  });
  await label.click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "one.png",
    mimeType: "image/png",
    buffer: WHITE_PNG,
  });
  // The image object should be saved into the worksheet value.
  await expect
    .poll(
      async () => {
        const data = await (
          await page.request.get(`/api/decks/${id}/worksheets`)
        ).json();
        const raw = data.worksheets[0].own?.values[fieldId] as
          | string
          | undefined;
        if (!raw || !raw.startsWith("{")) return 0;
        return (JSON.parse(raw) as { objects: unknown[] }).objects.length;
      },
      { timeout: 15_000 },
    )
    .toBe(1);
});
