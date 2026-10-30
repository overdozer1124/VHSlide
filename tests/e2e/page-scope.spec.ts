import { test, expect, type Page, type Locator } from "@playwright/test";
import { scopeBook } from "../support/scopeBook";
import { blank } from "../../src/model";
const source = scopeBook();
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
    document.documentElement.requestFullscreen = () =>
      Promise.reject(new Error("local fullscreen denial"));
  }, source);
  await page.goto("/");
});
async function filterIds(page: Page, positions: [number, number][]) {
  await page
    .getByRole("button", { name: "マップをフィルタ", exact: true })
    .click();
  for (const [x, y] of positions)
    await page
      .getByRole("button", {
        name: `フィルタ選択: ${y + 1}.${x + 1} ページ${y + 1}.${x + 1}`,
        exact: true,
      })
      .click();
  await page
    .getByRole("button", { name: "フィルタを適用", exact: true })
    .click();
}
async function tool(page: Page, name: "比較" | "PDFで保存") {
  if (name === "比較") {
    const select = page.getByRole("button", {
      name: "スライドを複数選択",
      exact: true,
    });
    if ((await select.getAttribute("aria-pressed")) !== "true")
      await select.click();
    await page
      .getByRole("region", { name: "選択したスライドの操作", exact: true })
      .getByRole("button", { name: "選択を解除", exact: true })
      .click();
    await page.locator(".slide-card .thumbnail").nth(0).click();
    await page
      .locator(".slide-card .thumbnail")
      .nth(1)
      .click({ modifiers: ["Control"] });
    await page.getByRole("button", { name: "比較", exact: true }).click();
    await page
      .getByRole("button", { name: "スライドを選び直す", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "スライドを比較", exact: true })
      .getByRole("button", { name: "選択を解除", exact: true })
      .click();
    return;
  }
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  await page.getByRole("menuitem", { name: /PDFで保存/ }).click();
}
const current = (page: Page) => page.locator(".present-slide .slide-canvas");
async function pinch(
  page: Page,
  target: Locator,
  out: boolean,
  touch: boolean,
) {
  const box = (await target.boundingBox())!,
    x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  if (!touch) {
    await target.evaluate(
      (node, { x, y, out }) =>
        node.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: out ? -15 : 15,
            clientX: x,
            clientY: y,
          }),
        ),
      { x, y, out },
    );
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  for (const [type, spread] of [
    ["touchStart", out ? 30 : 55],
    ["touchMove", out ? 55 : 30],
    ["touchEnd", 0],
  ] as const)
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd"
          ? []
          : [
              { id: 1, x: x - spread, y },
              { id: 2, x: x + spread, y },
            ],
    });
  await cdp.detach();
}
test("filtered presentation starts in scope, keeps vertical navigation and restores the map position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 610 });
  await page
    .getByRole("button", { name: "マップをフィルタ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "フィルタする列2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "フィルタを適用", exact: true })
    .click();
  await expect(
    page.locator('.slide-card[data-page-id="p10"] .start-badge'),
  ).toHaveText("発表の先頭");
  const scroll = page.locator(".map-scroll");
  await scroll.evaluate((e) => (e.scrollTop = 120));
  const before = await scroll.evaluate((e) => e.scrollTop);
  await page
    .getByRole("button", { name: "この3ページを発表", exact: true })
    .click();
  await expect(current(page)).toContainText("S1.2");
  await expect(page.locator(".minimap .occupied")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "次の話題", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("ArrowDown");
  await expect(current(page)).toContainText("S2.2");
  await page.keyboard.press("ArrowUp");
  await expect(current(page)).toContainText("S1.2");
  await page.keyboard.press("ArrowRight");
  await expect(current(page)).toContainText("S1.2");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => scroll.evaluate((e) => e.scrollTop))
    .toBeCloseTo(before, 0);
  await expect(page.locator(".slide-card")).toHaveCount(3);
  await page
    .getByRole("button", { name: "発表方法を選ぶ", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /シート全体を縦横に発表/ }).click();
  await expect(current(page)).toContainText("S1.1");
  await page.keyboard.press("Escape");
  await expect(page.locator(".slide-card")).toHaveCount(3);
});
test("four filtered cards stay in a balanced grid with origin labels, zoom and pinch editing", async ({
  page,
}, info) => {
  await filterIds(page, [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ]);
  const positions = await page
    .locator(".slide-card")
    .evaluateAll((nodes) =>
      nodes
        .map(
          (n) =>
            `${(n as HTMLElement).dataset.x},${(n as HTMLElement).dataset.y}`,
        )
        .sort(),
    );
  expect(positions).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  await expect(
    page.locator('[data-page-id="p11"] .filtered-origin'),
  ).toHaveText("2行：B班 / 2列：理由");
  await page.getByRole("button", { name: "マップを縮小", exact: true }).click();
  await page.getByRole("button", { name: "マップを縮小", exact: true }).click();
  await expect(page.locator(".number-tile")).toHaveCount(4);
  await page
    .getByRole("button", { name: "表示サイズを100%に戻す", exact: true })
    .click();
  await pinch(
    page,
    page.locator('[data-page-id="p11"] .thumbnail'),
    true,
    info.project.name === "touch",
  );
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("ページ2.2");
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await pinch(
    page,
    page.locator(".editor-pager"),
    false,
    info.project.name === "touch",
  );
  await expect(page.locator(".map-scroll")).toBeVisible();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await expect(page.locator(".slide-card")).toHaveCount(4);
  const slides = await page.evaluate(
    () => JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides,
  );
  // mergeSheet may group other-sheet pages first; IDs and full serialized contents must be identical.
  const byId = (a: { id: string }, b: { id: string }) =>
    a.id.localeCompare(b.id);
  expect(slides.sort(byId)).toEqual(
    JSON.parse(JSON.stringify(source.slides)).sort(byId),
  );
  await page.screenshot({ path: info.outputPath("scope-grid-origins.png") });
});
test("comparison candidates and PDF defaults share the visible scope and never keep hidden selected pages", async ({
  page,
}) => {
  await filterIds(page, [
    [1, 0],
    [1, 1],
  ]);
  await tool(page, "比較");
  const picker = page.getByLabel("対象スライド"),
    scope = page.getByRole("combobox", { name: "対象範囲", exact: true });
  await expect(picker.getByRole("checkbox")).toHaveCount(2);
  await expect(picker.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await picker.getByRole("checkbox").nth(0).check();
  await picker.getByRole("checkbox").nth(1).check();
  await scope.selectOption("book");
  await picker.getByRole("checkbox").last().check();
  await scope.selectOption("filter");
  await expect(picker.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await page
    .getByRole("button", {
      name: "選んだスライドを比較（最大4枚）",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("スライドの比較").locator(".slide-canvas"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await tool(page, "PDFで保存");
  await expect(picker.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await scope.selectOption("sheet");
  await expect(picker.getByRole("checkbox", { checked: true })).toHaveCount(9);
  await scope.selectOption("filter");
  await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".print-export .print-page")).toHaveCount(2);
});
test("current-page and saved-route presentations return to the original filtered editor", async ({
  page,
}) => {
  await filterIds(page, [
    [1, 0],
    [1, 1],
    [1, 2],
  ]);
  await page
    .getByRole("button", { name: "ページ2.2を編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page
    .getByRole("button", { name: "発表方法を選ぶ", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: /現在のページから縦横に発表/ })
    .click();
  await expect(current(page)).toContainText("S2.2");
  await page.keyboard.press("ArrowDown");
  await expect(current(page)).toContainText("S3.2");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("ページ2.2");
  await page
    .getByRole("button", { name: "発表方法を選ぶ", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /保存済みの発表で発表/ }).click();
  await expect(current(page)).toContainText("S3.3");
  await page.keyboard.press("ArrowRight");
  await expect(current(page)).toContainText("OTHER");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("ページ2.2");
  await expect(
    page.getByRole("button", { name: "この3ページを発表", exact: true }),
  ).toBeVisible();
});
test("an editor showing all pages does not inherit the hidden map filter for PDF or presentation", async ({
  page,
}) => {
  await filterIds(page, [
    [1, 0],
    [1, 1],
  ]);
  await page
    .getByRole("button", { name: "ページ1.2を編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page
    .getByRole("button", { name: "編集画面にもフィルタを適用", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "発表する", exact: true }),
  ).toBeVisible();
  await tool(page, "PDFで保存");
  await expect(
    page.getByLabel("対象スライド").getByRole("checkbox", { checked: true }),
  ).toHaveCount(9);
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  await expect(current(page)).toContainText("S1.1");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("ページ1.2");
  await expect(
    page.getByRole("button", {
      name: "編集画面にもフィルタを適用",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "false");
});
test("an outside link requires an explicit action and never expands the presentation scope", async ({
  page,
}) => {
  await filterIds(page, [
    [0, 0],
    [0, 1],
  ]);
  await page
    .getByRole("button", { name: "この2ページを発表", exact: true })
    .click();
  await page.locator('.present-mode .element[data-object-link="true"]').click();
  await expect(
    page.getByRole("dialog", { name: "発表対象外のリンク", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "リンク先を開く", exact: true })
    .focus();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "発表対象外のリンク", exact: true }),
  ).toHaveCount(0);
  await expect(current(page)).toContainText("S1.1");
  await page.locator('.present-mode .element[data-object-link="true"]').click();
  await page
    .getByRole("button", { name: "リンク先を開く", exact: true })
    .click();
  await expect(current(page)).toContainText("OTHER");
  await expect(page.getByLabel("発表対象", { exact: true })).toContainText(
    "2ページ",
  );
  await expect(
    page.getByRole("button", { name: "次の話題", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(current(page)).toContainText("OTHER");
  await page.mouse.move(15, 5);
  await page
    .getByRole("button", { name: "リンク元へ戻る", exact: true })
    .click();
  await expect(current(page)).toContainText("S1.1");
  await page.keyboard.press("ArrowDown");
  await expect(current(page)).toContainText("S2.1");
});
test("a large comparison scope remains a candidate set rather than silently selecting four pages", async ({
  page,
}) => {
  const book = {
    ...source,
    title: "400ページ",
    sheets: [source.sheets![0]],
    routes: [],
    slides: Array.from({ length: 400 }, (_, i) => ({
      ...blank(i % 10, Math.floor(i / 10)),
      id: `large-${i}`,
    })),
  };
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "large.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(book)),
    });
  await expect(page.locator(".deck-title")).toHaveValue("400ページ");
  await tool(page, "比較");
  const boxes = page.getByLabel("対象スライド").getByRole("checkbox");
  await expect(boxes).toHaveCount(400);
  await expect(
    page.getByLabel("対象スライド").getByRole("checkbox", { checked: true }),
  ).toHaveCount(0);
  for (let i = 0; i < 4; i++) await boxes.nth(i).check();
  await expect(boxes.nth(4)).toBeDisabled();
  await boxes.nth(0).uncheck();
  await expect(boxes.nth(4)).toBeEnabled();
});
