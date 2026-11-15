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

// 1x1 white PNG.
const WHITE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);

async function savedValue(page: Page, id: string, fieldId: string) {
  const data = await (
    await page.request.get(`/api/decks/${id}/worksheets`)
  ).json();
  return data.worksheets[0].own?.values[fieldId] as string | undefined;
}

test("reopening a drawing field shows the placed image and drawing on it does not turn black", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "reopen-host");
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
  await page
    .getByRole("button", { name: "フォーム", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "ワークシート", exact: true })
    .click();
  await modal(page)
    .getByRole("button", { name: "自分で入力", exact: true })
    .click();
  const view = modal(page).getByRole("button", {
    name: "自分の絵の画像・手描きを編集",
  });
  await view.click();
  const drawing = modal(page).locator(".worksheet-drawing");
  await drawing.locator('input[type="file"]').setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: WHITE_PNG,
  });
  await expect
    .poll(() => savedValue(page, id, fieldId), { timeout: 15_000 })
    .toMatch(/^\{/);
  const first = await savedValue(page, id, fieldId);
  await drawing.getByRole("button", { name: "完了", exact: true }).click();
  await expect(view.locator("img")).toBeVisible();

  // Reopen: the editor's base canvas must show the placed picture again
  // (an unpainted canvas is fully transparent; the picture is opaque).
  await view.click();
  const canvas = modal(page).locator(".worksheet-drawing-base");
  await expect(canvas).toBeVisible();
  await expect
    .poll(
      () =>
        canvas.evaluate((node: HTMLCanvasElement) => {
          const ctx = node.getContext("2d")!;
          const data = ctx.getImageData(0, 0, node.width, node.height).data;
          let alpha = 0,
            bright = 0,
            n = 0;
          for (let i = 0; i < data.length; i += 4 * 613) {
            alpha += data[i + 3];
            bright += (data[i] + data[i + 1] + data[i + 2]) / 3;
            n++;
          }
          return { alpha: alpha / n, bright: bright / n };
        }),
      { timeout: 10_000 },
    )
    .toEqual({ alpha: 255, bright: expect.closeTo(255, 0) });

  // Draw on the reopened picture and finish: the saved image keeps its
  // white ground (never black) with the stroke on top.
  await modal(page)
    .getByRole("button", { name: "ペン", exact: true })
    .click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 80,
    box.y + box.height / 2 + 30,
    { steps: 5 },
  );
  await page.mouse.up();
  await modal(page)
    .getByRole("button", { name: "完了", exact: true })
    .click();
  await expect
    .poll(() => savedValue(page, id, fieldId), { timeout: 15_000 })
    .not.toBe(first);
  const second = JSON.parse((await savedValue(page, id, fieldId))!).flat as string;
  const stats = await page.evaluate(async (src) => {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = src;
    });
    const off = document.createElement("canvas");
    off.width = image.width;
    off.height = image.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, off.width, off.height).data;
    const corner = (x: number, y: number) => {
      const i = (y * off.width + x) * 4;
      return (data[i] + data[i + 1] + data[i + 2]) / 3;
    };
    let darkest = 255;
    for (let i = 0; i < data.length; i += 4 * 401)
      darkest = Math.min(
        darkest,
        (data[i] + data[i + 1] + data[i + 2]) / 3,
      );
    return {
      corner: Math.min(
        corner(4, 4),
        corner(off.width - 5, 4),
        corner(4, off.height - 5),
        corner(off.width - 5, off.height - 5),
      ),
      darkest,
    };
  }, second!);
  expect(stats.corner).toBeGreaterThan(180);
  expect(stats.darkest).toBeLessThan(120);
});
