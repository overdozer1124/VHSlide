import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { blank } from "../../src/model";
const headers = { Origin: "http://127.0.0.1:3187" };
async function signIn(page: Page, name: string) {
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential },
      })
    ).status(),
  ).toBe(200);
}

test("double-clicking a slide image crops it in place by its edges", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "image-crop-host");
  const slide = blank(0, 0);
  slide.elements.push({
    id: "photo",
    type: "image",
    x: 100,
    y: 60,
    w: 400,
    h: 300,
    src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=",
  });
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "その場で切り抜き", slides: [slide] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const savedPhoto = async () => {
    const body = await (
      await page.request.get(`/api/decks/${id}/backup`)
    ).json();
    return body.deck.slides[0].elements.find(
      (e: { id: string }) => e.id === "photo",
    );
  };
  await page.goto(`/?room=${id}`);
  await page.locator(".thumbnail").first().click();
  const photo = page.locator('.slide-canvas.editable > .element[data-element-id="photo"]');
  await expect(photo).toBeVisible();
  // Double-click enters crop mode: the full picture ghosts out around
  // the window, with a frame whose edges can be dragged.
  await photo.dblclick();
  await expect(page.locator(".crop-ghost")).toBeVisible();
  const frame = page.locator(".crop-frame");
  await expect(frame).toBeVisible();
  // Drag the right edge's round mark inward.
  const edge = frame.locator(".crop-point-e");
  const edgeBox = await edge.boundingBox();
  expect(edgeBox).not.toBeNull();
  const cx = edgeBox!.x + edgeBox!.width / 2,
    cy = edgeBox!.y + edgeBox!.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("button", { name: "切り抜きを完了" }).click();
  await expect(page.locator(".crop-frame")).toHaveCount(0);
  await expect
    .poll(
      async () => {
        const el = await savedPhoto();
        return el?.crop ? `w=${el.crop.w.toFixed(2)} box=${el.w}` : "none";
      },
      { timeout: 20_000 },
    )
    .toMatch(/^w=0\.[3-9]\d* box=/);
  const afterCrop = await savedPhoto();
  expect(afterCrop.w).toBeLessThan(400);
  expect(afterCrop.crop.x).toBe(0);
  // A second crop round cancelled with Escape changes nothing.
  await photo.dblclick();
  await expect(frame).toBeVisible();
  const south = frame.locator(".crop-edge-s");
  const southBox = await south.boundingBox();
  const sx = southBox!.x + southBox!.width / 2,
    sy = southBox!.y + southBox!.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy - 60, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await expect(page.locator(".crop-frame")).toHaveCount(0);
  const afterCancel = await savedPhoto();
  expect(afterCancel.crop).toEqual(afterCrop.crop);
  expect(afterCancel.h).toBe(afterCrop.h);
});
