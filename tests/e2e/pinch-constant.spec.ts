import { test, expect } from "@playwright/test";
test("one trackpad gesture starts one constant speed transition", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/");
  const state = await page
    .locator(".thumbnail")
    .first()
    .evaluate(async (node) => {
      const grid = document.querySelector<HTMLElement>(".map-grid")!,
        b = node.getBoundingClientRect();
      function wheel(d: number) {
        node.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: d,
            clientX: b.x + b.width / 2,
            clientY: b.y + b.height / 2,
          }),
        );
      }
      wheel(30);
      const anim = grid.getAnimations()[0];
      if (!anim) throw Error("no animation");
      const frames = (anim.effect as KeyframeEffect)
        .getKeyframes()
        .map((k) => k.transform);
      wheel(90);
      wheel(-100);
      return {
        duration: (anim.effect as KeyframeEffect).getTiming().duration,
        frames,
        animations: grid.getAnimations().length,
      };
    });
  expect(state.duration).toBe(250);
  expect(state.animations).toBe(1);
  expect(state.frames[0]).toContain("scale(1)");
  expect(state.frames.at(-1)).toContain("scale(0.6)");
  await expect(page.locator(".map-scale-reset")).toHaveText("60%");
});
