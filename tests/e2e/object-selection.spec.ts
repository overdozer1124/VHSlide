import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("vhslide-deck-v1")) return;
    const element = (id: string, x: number, y: number) => ({
      id,
      type: "shape",
      shape: "rect",
      x,
      y,
      w: 100,
      h: 80,
      fill: "#aabbcc",
      stroke: "#173d38",
    });
    localStorage.setItem(
      "vhslide-deck-v1",
      JSON.stringify({
        version: 1,
        title: "selection",
        slides: [
          {
            id: "page",
            x: 0,
            y: 0,
            title: "selection",
            background: "#ffffff",
            elements: [
              element("a", 100, 100),
              {
                id: "b",
                type: "text",
                x: 300,
                y: 100,
                w: 100,
                h: 80,
                text: "文字の編集",
                fontSize: 24,
                color: "#173d38",
              },
              element("c", 500, 100),
              element("d", 500, 300),
            ],
          },
        ],
      }),
    );
  });
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
});
test("modifiers add and toggle selection without moving objects or entering text", async ({
  page,
}) => {
  const canvas = page.locator(".editor-workspace .slide-canvas");
  const object = (id: string) =>
    canvas.locator(`.element[data-element-id="${id}"]`);
  await object("a").click();
  await object("b").click({ modifiers: ["Shift"] });
  await object("c").click({ modifiers: ["Control"] });
  await expect(canvas.locator(".selected-element")).toHaveCount(3);
  await object("b").click({ modifiers: ["Shift"] });
  await expect(object("b")).not.toHaveClass(/selected-element/);
  await expect(canvas.locator(".selected-element")).toHaveCount(2);
  await object("c").click({ modifiers: ["Control"] });
  await expect(canvas.locator(".selected-element")).toHaveCount(1);
  const data = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0].elements,
  );
  expect(data.map((e: any) => [e.x, e.y])).toEqual([
    [100, 100],
    [300, 100],
    [500, 100],
    [500, 300],
  ]);
  await expect(canvas.locator(".inline-text-input")).toHaveCount(0);
});
test("blank-space drag selects, adds ranges, cancels safely and clears with a click", async ({
  page,
  hasTouch,
}) => {
  const canvas = page.locator(".editor-workspace .slide-canvas");
  const r = (await canvas.boundingBox())!,
    scale = r.width / 960;
  const move = (x: number, y: number) =>
    page.mouse.move(r.x + x * scale, r.y + y * scale);
  const select = async (
    x: number,
    y: number,
    ex: number,
    ey: number,
    add = false,
    cancel = false,
  ) => {
    if (add) await page.keyboard.down("Shift");
    await move(x, y);
    await page.mouse.down();
    await move(ex, ey);
    await expect(canvas.locator(".object-marquee")).toBeVisible();
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
    if (add) await page.keyboard.up("Shift");
    await expect(canvas.locator(".object-marquee")).toHaveCount(0);
  };
  if (!hasTouch)
    await expect(
      page.getByRole("button", { name: "まとめて選択", exact: true }),
    ).toBeHidden();
  await select(60, 60, 430, 220);
  await expect(canvas.locator(".selected-element")).toHaveCount(2);
  await expect(canvas.locator(".group-selection-box")).toBeVisible();
  await select(650, 450, 450, 250, true);
  await expect(canvas.locator(".selected-element")).toHaveCount(3);
  await select(30, 30, 700, 500, false, true);
  await expect(canvas.locator(".selected-element")).toHaveCount(3);
  await page.mouse.click(r.x + 30 * scale, r.y + 30 * scale);
  await expect(canvas.locator(".selected-element")).toHaveCount(0);
  await select(30, 30, 700, 500);
  await expect(canvas.locator(".selected-element")).toHaveCount(4);
  await page.keyboard.press("Delete");
  await expect(canvas.locator(".element")).toHaveCount(0);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect(canvas.locator(".element")).toHaveCount(4);
});
