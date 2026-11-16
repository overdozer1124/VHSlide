import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { blank } from "../../src/model";
const headers = { Origin: "http://127.0.0.1:3187" };

const shape = (id: string, x: number, y: number, w: number, h: number) => ({
  id,
  type: "shape",
  shape: "rect",
  x,
  y,
  w,
  h,
  fill: "#ffffff",
  stroke: "#173d38",
  text: id,
  fontSize: 24,
  color: "#173d38",
});

async function openEditor(
  page: Page,
  name: string,
  title: string,
  elements: ReturnType<typeof shape>[],
) {
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential: name },
      })
    ).status(),
  ).toBe(200);
  const slide = { ...blank(0, 0), title, elements };
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title, slides: [slide] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await page
    .getByRole("button", { name: `${title}を編集`, exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
}

const target = (page: Page) =>
  page.locator('.editor-page-current .element[data-element-id="target"]');

test("moving an object snaps its edge onto another object's edge", async ({
  page,
}) => {
  await openEditor(page, "snap-move-host", "移動の吸着", [
    shape("reference", 100, 100, 200, 120),
    shape("target", 500, 300, 100, 60),
  ]);
  const box = await target(page).boundingBox();
  if (!box) throw new Error("target not rendered");
  const scale = box.width / 100;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Aim the left edge at x=304 — 4 units past the reference's right edge
  // (300). Without snapping it would land on 304.
  await page.mouse.move(cx - 196 * scale, cy, { steps: 12 });
  await expect(page.locator(".guide.vertical")).toBeVisible();
  await page.mouse.up();
  await expect(target(page)).toHaveCSS("left", "300px");
});

test("resizing an object snaps the dragged edge onto another object's edge", async ({
  page,
}) => {
  await openEditor(page, "snap-resize-host", "サイズ変更の吸着", [
    shape("reference", 400, 100, 200, 120),
    shape("target", 60, 300, 100, 60),
  ]);
  await target(page).click();
  const handle = page.locator(
    ".editor-page-current .resize-handle.resize-e",
  );
  const box = await handle.boundingBox();
  if (!box) throw new Error("east handle not rendered");
  const scale = (await target(page).boundingBox())!.width / 100;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Aim the right edge at x=396 — 4 units short of the reference's left
  // edge (400). Snapping pulls it to exactly 400, so width becomes 340.
  await page.mouse.move(cx + 236 * scale, cy, { steps: 12 });
  await expect(page.locator(".guide.vertical")).toBeVisible();
  await page.mouse.up();
  await expect(target(page)).toHaveCSS("width", "340px");
});
