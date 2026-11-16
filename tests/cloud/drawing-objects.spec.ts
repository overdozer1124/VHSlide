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

interface Scene {
  flat: string;
  objects: { id: string; x: number; y: number; w: number; h: number }[];
  strokes: string;
}

async function savedScene(
  page: Page,
  id: string,
  fieldId: string,
): Promise<Scene | null> {
  const data = await (
    await page.request.get(`/api/decks/${id}/worksheets`)
  ).json();
  const raw = data.worksheets[0].own?.values[fieldId] as string | undefined;
  if (!raw || !raw.startsWith("{")) return null;
  return JSON.parse(raw) as Scene;
}

test("placed images are movable, resizable objects that survive reopening", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "objects-host");
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
  const fileInput = drawing.locator('input[type="file"]');

  // Add two images: each becomes an object, not a full-frame fill.
  await fileInput.setInputFiles({
    name: "one.png",
    mimeType: "image/png",
    buffer: WHITE_PNG,
  });
  await expect
    .poll(async () => (await savedScene(page, id, fieldId))?.objects.length, {
      timeout: 15_000,
    })
    .toBe(1);
  const one = (await savedScene(page, id, fieldId))!;
  expect(one.objects[0].w).toBeLessThan(0.9);
  expect(one.flat).toMatch(/^data:image\/jpeg;base64,/);
  await fileInput.setInputFiles({
    name: "two.png",
    mimeType: "image/png",
    buffer: WHITE_PNG,
  });
  await expect
    .poll(async () => (await savedScene(page, id, fieldId))?.objects.length, {
      timeout: 15_000,
    })
    .toBe(2);
  const two = (await savedScene(page, id, fieldId))!;
  expect(two.objects[1].x).not.toBeCloseTo(two.objects[0].x, 5);

  // The newest object is selected; drag it to a new place.
  const selection = drawing.locator(".worksheet-drawing-selection");
  await expect(selection).toBeVisible();
  await selection.scrollIntoViewIfNeeded();
  const selBox = (await selection.boundingBox())!;
  await page.mouse.move(
    selBox.x + selBox.width / 2,
    selBox.y + selBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    selBox.x + selBox.width / 2 - 110,
    selBox.y + selBox.height / 2 - 25,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(
      async () => (await savedScene(page, id, fieldId))?.objects[1].x,
      { timeout: 15_000 },
    )
    .toBeLessThan(two.objects[1].x - 0.05);

  // Resize it from the south-east handle.
  const beforeResize = (await savedScene(page, id, fieldId))!;
  const handle = drawing.locator(".worksheet-drawing-handle.is-se");
  await handle.scrollIntoViewIfNeeded();
  const handleBox = (await handle.boundingBox())!;
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 70,
    handleBox.y + handleBox.height / 2 + 40,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(
      async () => (await savedScene(page, id, fieldId))?.objects[1].w,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(beforeResize.objects[1].w + 0.03);

  // Handwriting still lands on its own layer above the images.
  await drawing.getByRole("button", { name: /ツール/ }).click();
  await drawing.getByRole("button", { name: "ペン", exact: true }).click();
  const stage = drawing.locator(".worksheet-drawing-stage");
  await stage.scrollIntoViewIfNeeded();
  const stageBox = (await stage.boundingBox())!;
  await page.mouse.move(
    stageBox.x + stageBox.width * 0.15,
    stageBox.y + stageBox.height * 0.8,
  );
  await page.mouse.down();
  await page.mouse.move(
    stageBox.x + stageBox.width * 0.35,
    stageBox.y + stageBox.height * 0.85,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(
      async () => (await savedScene(page, id, fieldId))?.strokes.length ?? 0,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(100);

  // Finish and reopen: the objects are still objects at the same places.
  await drawing.getByRole("button", { name: "完了", exact: true }).click();
  await expect(view.locator("img")).toBeVisible();
  const settled = (await savedScene(page, id, fieldId))!;
  await view.click();
  const reopenedStage = drawing.locator(".worksheet-drawing-stage");
  const reopenedBox = (await reopenedStage.boundingBox())!;
  const target = settled.objects[1];
  await page.mouse.click(
    reopenedBox.x + (target.x + target.w / 2) * reopenedBox.width,
    reopenedBox.y + (target.y + target.h / 2) * reopenedBox.height,
  );
  await expect(
    drawing.locator(".worksheet-drawing-selection"),
  ).toBeVisible();

  // Delete just that object; the other image and the strokes remain.
  await drawing.getByRole("button", { name: /ツール/ }).click();
  await drawing
    .getByRole("button", { name: "選んだ画像を削除", exact: true })
    .click();
  await expect
    .poll(async () => (await savedScene(page, id, fieldId))?.objects.length, {
      timeout: 15_000,
    })
    .toBe(1);
  const afterDelete = (await savedScene(page, id, fieldId))!;
  expect(afterDelete.objects[0].id).toBe(settled.objects[0].id);
  expect(afterDelete.strokes.length).toBeGreaterThan(100);
});

test("a placed image is actually visible in the editor", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "objects-visible-host");
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
  // Add a solid red picture through the file input.
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
    .poll(async () => (await savedScene(page, id, fieldId))?.objects.length, {
      timeout: 15_000,
    })
    .toBe(1);
  // The handwriting layer above the picture must be transparent,
  // otherwise it hides the picture behind a white sheet.
  const strokeBackground = await drawing
    .locator(".worksheet-drawing-stroke")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(strokeBackground).toBe("rgba(0, 0, 0, 0)");
  // And the composited stage really shows the red picture.
  const scene = (await savedScene(page, id, fieldId))!;
  const object = scene.objects[0];
  const stage = drawing.locator(".worksheet-drawing-stage");
  await stage.scrollIntoViewIfNeeded();
  const shot = await stage.screenshot();
  const mean = await page.evaluate(
    async ({ data, rect }) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = `data:image/png;base64,${data}`;
      });
      const off = document.createElement("canvas");
      off.width = image.width;
      off.height = image.height;
      const ctx = off.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const cx = (rect.x + rect.w / 2) * image.width;
      const cy = (rect.y + rect.h / 2) * image.height;
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let dy = -8; dy <= 8; dy += 4)
        for (let dx = -8; dx <= 8; dx += 4) {
          const pixel = ctx.getImageData(
            Math.round(cx + dx),
            Math.round(cy + dy),
            1,
            1,
          ).data;
          r += pixel[0];
          g += pixel[1];
          b += pixel[2];
          n++;
        }
      return { r: r / n, g: g / n, b: b / n };
    },
    {
      data: shot.toString("base64"),
      rect: { x: object.x, y: object.y, w: object.w, h: object.h },
    },
  );
  expect(mean.r).toBeGreaterThan(150);
  expect(mean.g).toBeLessThan(110);
  expect(mean.b).toBeLessThan(110);
});
