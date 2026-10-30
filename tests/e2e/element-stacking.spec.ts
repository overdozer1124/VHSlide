import { test, expect } from "@playwright/test";
import { blank, uid } from "../../src/model";
import type { Deck, Element } from "../../src/model";
import { createTable } from "../../src/tableData";
for (const kind of ["text", "table"] as const) {
  test(`front shape wins over rear ${kind} content, frames and resize controls, including after layer reorder`, async ({
    page,
  }, info) => {
    const back: Element =
      kind === "text"
        ? {
            id: "back",
            type: "text",
            x: 120,
            y: 100,
            w: 400,
            h: 240,
            text: "背面の文字",
            fontSize: 24,
            color: "#173d38",
          }
        : {
            id: "back",
            type: "table",
            x: 120,
            y: 100,
            w: 400,
            h: 240,
            table: createTable(3, 3, uid),
            fontSize: 20,
            color: "#173d38",
            fill: "#ffffff",
            stroke: "#79958b",
          };
    const front: Element = {
      id: "front",
      type: "shape",
      shape: "rect",
      x: 180,
      y: 60,
      w: 480,
      h: 360,
      fill: "#b8d394",
      stroke: "#173d38",
    };
    const deck: Deck = {
      version: 1,
      title: "重なり順",
      slides: [{ ...blank(0, 0), title: "重なり順", elements: [back, front] }],
    };
    await page.addInitScript(
      (d) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(d)),
      deck,
    );
    await page.goto("/");
    await page
      .getByRole("button", { name: "重なり順を編集", exact: true })
      .click();
    await expect(page.locator(".workspace-flight")).toHaveCount(0);
    const canvas = page.locator(".editor-page-current .slide-canvas"),
      elements = canvas.locator(":scope > .element");
    const workspace = (await page.locator(".editor-workspace").boundingBox())!;
    await expect
      .poll(async () => (await canvas.boundingBox())!.width)
      .toBeCloseTo(
        Math.max(
          0.1,
          Math.min((workspace.width - 48) / 960, (workspace.height - 85) / 540),
        ) * 960,
        0,
      );
    const click = async (x: number, y: number) =>
      info.project.name === "touch"
        ? page.touchscreen.tap(x, y)
        : page.mouse.click(x, y);
    const rect = (await canvas.boundingBox())!,
      scale = rect.width / 960;
    const point = (x: number, y: number) => ({
      x: rect.x + x * scale,
      y: rect.y + y * scale,
    });
    const exposed = point(140, 180);

    for (const [x, y] of [
      [320, 100],
      [520, 340],
      [320, 200],
    ]) {
      await click(exposed.x, exposed.y);
      await expect(elements.nth(0)).toHaveClass(/selected-element/);
      const p = point(x, y);
      await expect
        .poll(() =>
          elements
            .nth(1)
            .evaluate(
              (node, p) =>
                document.elementFromPoint(p.x, p.y)?.closest(".element") ===
                node,
              p,
            ),
        )
        .toBe(true);
      await click(p.x, p.y);
      await expect(elements.nth(1)).toHaveClass(/selected-element/);
      await expect(elements.nth(0)).not.toHaveClass(/selected-element/);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const active = document.activeElement;
            return (
              !(active instanceof HTMLElement) ||
              !active.closest(".element:not(.selected-element)") ||
              !active.matches("textarea,[contenteditable=true]")
            );
          }),
        )
        .toBe(true);
    }
    // Sending the front shape backwards must change both rendering and hit testing.
    await page.getByRole("tab", { name: "配置", exact: true }).click();
    await page.getByRole("button", { name: "最背面へ", exact: true }).click();
    const p = point(320, 200);
    await expect
      .poll(() =>
        elements
          .nth(1)
          .evaluate(
            (node, p) =>
              document.elementFromPoint(p.x, p.y)?.closest(".element") === node,
            p,
          ),
      )
      .toBe(true);
    await click(p.x, p.y);
    await expect(elements.nth(1)).toHaveClass(/selected-element/);
    await page.getByRole("tab", { name: "配置", exact: true }).click();
    await page.getByRole("button", { name: "最背面へ", exact: true }).click();
    await click(p.x, p.y);
    await expect(elements.nth(1)).toHaveClass(/selected-element/);
    const order = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("vhslide-deck-v1")!,
      ).slides[0].elements.map((e: any) => e.id),
    );
    expect(order).toEqual(["back", "front"]);
    await page.screenshot({ path: info.outputPath(`stacking-${kind}.png`) });
    await page.reload();
    await page
      .getByRole("button", { name: "重なり順を編集", exact: true })
      .click();
    await expect
      .poll(() =>
        elements.nth(1).evaluate((node) => {
          const r = node.getBoundingClientRect();
          return (
            document
              .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
              ?.closest(".element") === node
          );
        }),
      )
      .toBe(true);
  });
}
