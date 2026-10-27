import { test, expect } from "@playwright/test";

test("pinch preserves horizontal and vertical spacing until the layout settles", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/");
  const cards = page.locator(".grid-row").first().locator(".slide-card");
  await expect(cards.nth(1)).toBeVisible();
  const result = await page.evaluate(async () => {
    const grid = document.querySelector<HTMLElement>(".map-grid")!;
    const rows = [...grid.querySelectorAll(".grid-row")];
    const a = rows[0].querySelectorAll(".slide-card");
    const b = rows[1].querySelectorAll(".slide-card");
    const gap = () => {
      const r0 = a[0].getBoundingClientRect(),
        r1 = a[1].getBoundingClientRect(),
        r2 = b[0].getBoundingClientRect();
      return { x: r1.left - r0.right, y: r2.top - r0.bottom };
    };
    const before = gap();
    const box = a[0].getBoundingClientRect();
    a[0].dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: 30,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height / 2,
      }),
    );
    const preview = gap();
    await new Promise((r) => setTimeout(r, 160));
    const release = gap();
    await new Promise((r) => setTimeout(r, 600));
    return { before, preview, release, after: gap() };
  });
  for (const phase of ["preview", "release", "after"] as const) {
    expect(
      Math.abs(result[phase].x - result.before.x),
      `${phase} horizontal`,
    ).toBeLessThan(2);
    expect(
      Math.abs(result[phase].y - result.before.y),
      `${phase} vertical`,
    ).toBeLessThan(2);
  }
});

test("thumbnail positions remain continuous when the pinch settles", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("public/samples/vhslide-10x40.json");
  await expect(page.locator(".slide-card")).toHaveCount(400);
  const r = await page.evaluate(async () => {
    const grid = document.querySelector<HTMLElement>(".map-grid")!;
    const rows = [...grid.querySelectorAll(".grid-row")];
    const card = rows[3].querySelectorAll<HTMLElement>(".thumbnail")[2];
    card.scrollIntoView({ block: "center", inline: "center" });
    const rect = card.getBoundingClientRect();
    card.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: 30,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      }),
    );
    const anim = grid.getAnimations()[0];
    if (!anim) throw new Error("pinch animation missing");
    anim.pause();
    anim.currentTime =
      Number((anim.effect as KeyframeEffect).getTiming().duration) - 1;
    const before = card.getBoundingClientRect().y;
    anim.finish();
    await new Promise((r) => setTimeout(r, 50));
    return { before, after: card.getBoundingClientRect().y };
  });
  expect(Math.abs(r.after - r.before)).toBeLessThan(3);
});
