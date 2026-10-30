import { test, expect, type Page } from "@playwright/test";
import { blank } from "../../src/model";
import { scopeBook } from "../support/scopeBook";
const source = scopeBook();
const card = (page: Page, id: string) =>
  page.locator(`.slide-card[data-page-id="${id}"] .thumbnail`);
const selected = (page: Page) =>
  page.locator('.slide-card[data-multi-selected="true"]');
const data = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
const ids = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!)
      .slides.filter(
        (s: { sheetId?: string }) => (s.sheetId ?? "main") === "main",
      )
      .map((s: { id: string }) => s.id)
      .sort(),
  );
test.beforeEach(async ({ page }) => {
  await page.route("**/api/config", (r) =>
    r.fulfill({ json: { clientId: "", notice: "" } }),
  );
  await page.route("**/api/session", (r) =>
    r.fulfill({ json: { user: null } }),
  );
  await page.addInitScript((book) => {
    if (!localStorage.getItem("vhslide-deck-v1"))
      localStorage.setItem("vhslide-deck-v1", JSON.stringify(book));
  }, source);
  await page.goto("/");
});
async function batch(
  page: Page,
  axis: "rows" | "columns",
  action: "add" | "delete",
  start: number,
  count: number,
) {
  await page
    .getByRole("button", { name: "行・列を一括操作", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "行・列の一括操作",
    exact: true,
  });
  await panel.getByLabel("操作する軸", { exact: true }).selectOption(axis);
  await panel.getByLabel("一括操作", { exact: true }).selectOption(action);
  await panel
    .getByLabel("一括操作の開始番号", { exact: true })
    .fill(String(start));
  await panel.getByLabel("一括操作の数", { exact: true }).fill(String(count));
  return panel;
}
test("bulk insert/delete rows and columns preserves axes, pages, other sheets and one-step Undo", async ({
  page,
}, info) => {
  const before = await data(page);
  let p = await batch(page, "rows", "add", 2, 2);
  await expect(p).toContainText("6ページを追加");
  await page.screenshot({ path: info.outputPath("map-batch-panel.png") });
  await p.getByRole("button", { name: "まとめて追加", exact: true }).click();
  await expect(page.locator(".slide-card")).toHaveCount(15);
  let d = await data(page);
  expect(d.slides.find((s: { id: string }) => s.id === "p01").y).toBe(3);
  expect(d.sheets[0].rowLabels[3]).toBe("B班");
  expect(d.slides.find((s: { id: string }) => s.id === "q00")).toEqual(
    before.slides.find((s: { id: string }) => s.id === "q00"),
  );
  await page.keyboard.press("Control+z");
  await expect(page.locator(".slide-card")).toHaveCount(9);
  expect(await ids(page)).toEqual(
    before.slides
      .filter((s: { sheetId?: string }) => (s.sheetId ?? "main") === "main")
      .map((s: { id: string }) => s.id)
      .sort(),
  );
  p = await batch(page, "columns", "add", 2, 2);
  await p.getByRole("button", { name: "まとめて追加", exact: true }).click();
  await expect(page.locator(".slide-card")).toHaveCount(15);
  d = await data(page);
  expect(d.slides.find((s: { id: string }) => s.id === "p10").x).toBe(3);
  expect(d.sheets[0].columnLabels[3]).toBe("理由");
  p = await batch(page, "columns", "delete", 2, 2);
  await expect(p).toContainText("6ページを削除");
  await p.getByRole("button", { name: "この範囲を削除", exact: true }).click();
  await expect(page.locator(".slide-card")).toHaveCount(9);
  expect(
    (await data(page)).slides.find((s: { id: string }) => s.id === "p10").x,
  ).toBe(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".slide-card")).toHaveCount(15);
});
test("invalid ranges are disabled, deleting every row leaves an empty page and Undo restores all contents", async ({
  page,
}) => {
  const p = await batch(page, "rows", "add", 1, 100);
  await expect(
    p.getByRole("button", { name: "まとめて追加", exact: true }),
  ).toBeDisabled();
  await p.getByLabel("一括操作", { exact: true }).selectOption("delete");
  await p.getByLabel("一括操作の開始番号").fill("1");
  await p.getByLabel("一括操作の数").fill("3");
  await p.getByRole("button", { name: "この範囲を削除", exact: true }).click();
  await expect(page.locator(".slide-card")).toHaveCount(1);
  const d = await data(page);
  expect(
    d.slides.find((s: { sheetId?: string }) => (s.sheetId ?? "main") === "main")
      .elements,
  ).toEqual([]);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".slide-card")).toHaveCount(9);
  expect(await ids(page)).toContain("p22");
});
test("Ctrl and Shift select actual pages, filter those IDs in a balanced grid and retain editor filtering", async ({
  page,
}) => {
  await card(page, "p00").click({ modifiers: ["Control"] });
  await expect(selected(page)).toHaveCount(1);
  await card(page, "p11").click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(4);
  await card(page, "p00").click({ modifiers: ["Control"] });
  await expect(selected(page)).toHaveCount(3);
  await card(page, "p00").click({ modifiers: ["Control"] });
  await expect(selected(page)).toHaveCount(4);
  await page
    .getByRole("button", { name: "選択したページでフィルタ", exact: true })
    .click();
  await expect(page.locator(".slide-card")).toHaveCount(4);
  expect(
    await page
      .locator(".slide-card")
      .evaluateAll((n) =>
        n
          .map(
            (e) =>
              `${(e as HTMLElement).dataset.x},${(e as HTMLElement).dataset.y}`,
          )
          .sort(),
      ),
  ).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  await card(page, "p11").click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("ページ2.2");
});
test("marquee selects pages without moving them; delete requires confirmation and Undo restores the selection contents", async ({
  page,
}, info) => {
  await page
    .getByRole("button", { name: "スライドを複数選択", exact: true })
    .click();
  const a = (await card(page, "p00").boundingBox())!,
    b = (await card(page, "p11").boundingBox())!;
  if (info.project.name === "touch") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x: a.x + 5, y: a.y + 5 }],
    });
    for (let i = 1; i <= 8; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            id: 1,
            x: a.x + 5 + ((b.x + b.width - 5 - a.x - 5) * i) / 8,
            y: a.y + 5 + ((b.y + b.height - 5 - a.y - 5) * i) / 8,
          },
        ],
      });
    await expect(page.locator(".map-selection-box")).toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(a.x + 5, a.y + 5);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 5, b.y + b.height - 5, { steps: 8 });
    await expect(page.locator(".map-selection-box")).toBeVisible();
    await page.mouse.up();
  }
  await expect(selected(page)).toHaveCount(4);
  expect(
    (await data(page)).slides.find((s: { id: string }) => s.id === "p11").x,
  ).toBe(1);
  await page.screenshot({ path: info.outputPath("map-selection.png") });
  await page.keyboard.press("Delete");
  await expect(
    page.getByRole("button", { name: "この4ページを削除する", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".slide-card")).toHaveCount(9);
  await page.getByRole("button", { name: "取り消す", exact: true }).click();
  await expect(selected(page)).toHaveCount(4);
  await page
    .getByRole("button", { name: "選択したページを削除", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この4ページを削除する", exact: true })
    .click();
  await expect(page.locator(".slide-card")).toHaveCount(6);
  const d = await data(page);
  expect(d.slides.find((s: { id: string }) => s.id === "p22").x).toBe(2);
  expect(d.slides.find((s: { id: string }) => s.id === "p22").y).toBe(2);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".slide-card")).toHaveCount(9);
  expect(await ids(page)).toContain("p11");
});
test("selection supports keyboard toggling and touch taps without entering the editor", async ({
  page,
}, info) => {
  await page
    .getByRole("button", { name: "スライドを複数選択", exact: true })
    .click();
  if (info.project.name === "touch") {
    await card(page, "p10").tap();
    await expect(selected(page)).toHaveCount(1);
    await card(page, "p11").tap();
    await expect(selected(page)).toHaveCount(2);
    await card(page, "p11").tap();
    await expect(selected(page)).toHaveCount(1);
  } else {
    await card(page, "p10").focus();
    await page.keyboard.press("Space");
    await expect(selected(page)).toHaveCount(1);
  }
  await expect(page.locator(".editor-main")).toHaveCount(0);
  await page.keyboard.press("Control+a");
  await expect(selected(page)).toHaveCount(9);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "スライドを複数選択", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await card(page, "p10").click();
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("ページ1.2");
});

test("bulk add accounts for pages in other sheets before enabling the operation", async ({
  page,
}) => {
  const book = {
    ...source,
    slides: [
      ...source.slides.filter((s) => (s.sheetId ?? "main") === "main"),
      ...Array.from({ length: 991 }, (_, i) => ({
        ...blank(i % 100, Math.floor(i / 100)),
        id: `other-${i}`,
        sheetId: "other",
      })),
    ],
  };
  await page.evaluate(
    (book) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(book)),
    book,
  );
  await page.reload();
  const p = await batch(page, "rows", "add", 4, 1);
  await expect(p).toContainText("あと0ページ");
  await expect(
    p.getByRole("button", { name: "まとめて追加", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".slide-card")).toHaveCount(9);
});
