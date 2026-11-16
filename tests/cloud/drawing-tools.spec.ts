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

async function savedValue(page: Page, id: string, fieldId: string) {
  const data = await (
    await page.request.get(`/api/decks/${id}/worksheets`)
  ).json();
  return data.worksheets[0].own?.values[fieldId] as string | undefined;
}

test("drawing tools live behind one toggle so the canvas keeps its space", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "drawing-tools-host");
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
  expect(created.status()).toBe(200);
  const sheet = (await created.json()).worksheets[0];
  expect(
    (
      await page.request.post(`/api/decks/${id}/worksheets/${sheet.id}/status`, {
        headers,
        data: { status: "open" },
      })
    ).status(),
  ).toBe(200);

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
  const toggle = drawing.getByRole("button", { name: /ツール/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // The function buttons stay out of the way until the toggle opens them.
  await expect(
    drawing.getByRole("button", { name: "ペン", exact: true }),
  ).toBeHidden();
  await expect(
    drawing.getByRole("button", { name: "消去", exact: true }),
  ).toBeHidden();
  // The bar is a single row, and the canvas is right below it.
  const bar = drawing.locator(".worksheet-drawing-toolbar");
  const barBox = (await bar.boundingBox())!;
  expect(barBox.height).toBeLessThan(60);
  const canvas = drawing.locator(".worksheet-drawing-base");
  await expect(canvas).toBeVisible();
  const canvasBox = (await canvas.boundingBox())!;
  expect(canvasBox.y - barBox.y).toBeLessThan(80);

  // Open the tools, switch to the eraser: the panel closes and the
  // toggle shows the now-current tool.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    drawing.getByRole("button", { name: "ペン", exact: true }),
  ).toBeVisible();
  await drawing
    .getByRole("button", { name: "消しゴム", exact: true })
    .click();
  await expect(
    drawing.getByRole("button", { name: "ペン", exact: true }),
  ).toBeHidden();
  await expect(
    drawing.getByRole("button", { name: /ツール：消しゴム/ }),
  ).toBeVisible();

  // Back to the pen through the panel, draw, and finish as before.
  await toggle.click();
  await drawing.getByRole("button", { name: "ペン", exact: true }).click();
  const stroke = drawing.locator(".worksheet-drawing-stroke");
  const box = (await stroke.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(() => savedValue(page, id, fieldId), { timeout: 15_000 })
    .toBeTruthy();
  await drawing.getByRole("button", { name: "完了", exact: true }).click();
  await expect(
    modal(page).getByRole("button", {
      name: "自分の絵の画像・手描きを編集",
    }),
  ).toBeVisible();
});
