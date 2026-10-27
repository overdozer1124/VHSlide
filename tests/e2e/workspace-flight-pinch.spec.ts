import { test, expect } from "@playwright/test";
test("trackpad pinch-out enlarges the selected thumbnail into editor", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/");
  const thumb = page.locator(".map-grid .thumbnail").first();
  const before = (await thumb.boundingBox())!;
  await thumb.evaluate((node) => {
    const b = node.getBoundingClientRect();
    node.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -30,
        clientX: b.x + b.width / 2,
        clientY: b.y + b.height / 2,
      }),
    );
  });
  const flight = page.locator(".workspace-flight");
  await expect(flight).toBeVisible();
  const measurement = await flight.evaluate(async (node) => {
    await new Promise((r) => setTimeout(r, 80));
    const anim = node.getAnimations()[0];
    return {
      running: !!anim,
      from: anim && (anim.effect as KeyframeEffect).getKeyframes()[0].transform,
      to:
        anim &&
        (anim.effect as KeyframeEffect).getKeyframes().at(-1)?.transform,
      width: node.getBoundingClientRect().width,
    };
  });
  expect(measurement.running).toBe(true);
  expect(measurement.from).not.toBe(measurement.to);
  expect(measurement.width).toBeGreaterThan(before.width);
  await page
    .locator(".editor-pager")
    .dispatchEvent("pointerdown", { pointerType: "touch", bubbles: true });
  await expect(flight).toBeVisible();
  await expect(flight).toHaveCount(0);
  await expect(page.locator(".editor-pager")).toBeVisible();
});

test("from a 300% map, a trackpad pinch-out grows the slide straight to its editor size", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop");
  await page.addInitScript(() =>
    localStorage.setItem(
      "vhslide-workspace-preferences-v1",
      JSON.stringify({ zoomSteps: [100, 300] }),
    ),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "マップを拡大", exact: true }).click();
  await expect(page.locator(".map-scale-reset")).toHaveText("300%");
  const thumb = page.locator(".map-grid .thumbnail").first();
  const box = (await thumb.boundingBox())!;
  const widths = await page.evaluate(
    async ({ x, y }) => {
      const seen: { flight?: number; pager?: number }[] = [];
      let done = false;
      (function frame() {
        const flight = document.querySelector(".workspace-flight");
        const pager = document.querySelector(".editor-pager");
        seen.push({
          flight: flight?.getBoundingClientRect().width,
          pager: pager?.getBoundingClientRect().width,
        });
        if (!done) requestAnimationFrame(frame);
      })();
      for (let i = 0; i < 12; i++) {
        document.elementFromPoint(x, y)?.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: -6,
            clientX: x,
            clientY: y,
          }),
        );
        await new Promise((r) => setTimeout(r, 16));
      }
      await new Promise((r) => setTimeout(r, 900));
      done = true;
      return seen;
    },
    { x: box.x + 100, y: box.y + 100 },
  );
  const pager = widths.filter((w) => w.pager).map((w) => w.pager!);
  const flight = widths.filter((w) => w.flight).map((w) => w.flight!);
  // The editor shows its slide at its fitted size from its first frame.
  expect(Math.min(...pager)).toBeCloseTo(Math.max(...pager), 0);
  // The flying slide only grows, from the thumbnail to the editor's slide.
  expect(flight[0]).toBeCloseTo(box.width, 0);
  for (const [i, width] of flight.entries())
    if (i) expect(width).toBeGreaterThanOrEqual(flight[i - 1] - 0.5);
  expect(flight.at(-1)!).toBeCloseTo(pager.at(-1)!, 0);
});
