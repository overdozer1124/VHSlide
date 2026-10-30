import { test, expect, type Page } from "@playwright/test";
import { blank, type Deck, type Element } from "../../src/model";
const table: Element = {
  id: "table",
  type: "table",
  x: 100,
  y: 100,
  w: 700,
  h: 240,
  fontSize: 24,
  color: "#173d38",
  fill: "#ffffff",
  stroke: "#173d38",
  table: {
    rows: ["r0", "r1", "r2"],
    columns: ["c0", "c1", "c2"],
    header: true,
    cells: {
      "r0:c0": Array.from({ length: 30 }, (_, i) => `説明${i}`).join("\n"),
      "r1:c1": "ABCDEFGHIJ".repeat(18),
      "r2:c2": "短文",
    },
  },
};
const chart: Element = {
  id: "chart",
  type: "chart",
  x: 20,
  y: 25,
  w: 900,
  h: 480,
  chart: {
    kind: "bar",
    title: "比較するグラフ",
    showLegend: false,
    showValues: true,
    series: Array.from({ length: 12 }, (_, i) => ({
      id: `v${i}`,
      label: "地域や季節によって変わる長い名称の比較".repeat(4).slice(0, 60),
      value: i % 2 ? i : -i,
      color: "#587d59",
    })),
  },
};
const source: Deck = {
  version: 1,
  title: "表示確認",
  sheets: [{ id: "main", name: "比較" }],
  activeSheetId: "main",
  slides: [
    {
      ...blank(0, 0),
      id: "table-page",
      title: "表のページ",
      elements: [table],
    },
    {
      ...blank(1, 0),
      id: "chart-page",
      title: "グラフのページ",
      elements: [chart],
    },
    { ...blank(2, 0), id: "clean-page", title: "空白ページ" },
  ],
};
const data = (p: Page) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
async function pdf(p: Page) {
  await button(p, "ファイル").click();
  await p.getByRole("menuitem", { name: /PDFで保存/ }).click();
}
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
      Promise.reject(new Error("local denial"));
  }, source);
  await page.goto("/");
});
test("table measurement ignores caret scroll, preserves all text, and removes a warning when the cell fits", async ({
  page,
}, info) => {
  await button(page, "表のページを編集").click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  const cell = page.locator(
      '.editor-workspace td[data-cell="r0:c0"],.editor-workspace th[data-cell="r0:c0"]',
    ),
    input = cell.locator("textarea");
  await expect(cell.locator(".cell-overflow-flag")).toBeVisible();
  await input.click();
  await expect(
    page.getByRole("region", { name: "表示の見切れ", exact: true }),
  ).toContainText("1行1列");
  await input.evaluate((n) => (n.scrollTop = n.scrollHeight));
  await expect(cell.locator(".cell-overflow-flag")).toBeVisible();
  expect((await data(page)).slides[0].elements[0].table.cells["r0:c0"]).toBe(
    table.table!.cells["r0:c0"],
  );
  await input.fill("短文");
  await expect(cell.locator(".cell-overflow-flag")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("table-fit.png") });
});
test("chart labels use numbered names with legend off, stay inside the chart, and keep full original data", async ({
  page,
}) => {
  await button(page, "グラフのページを編集").click();
  const svg = page.locator(".editor-page-current .chart-graphic");
  await expect(svg).toHaveAttribute("data-chart-numbered", "true");
  await expect(svg.locator(".chart-name-entry")).toHaveCount(12);
  await expect(svg.locator(".chart-name-line")).toContainText(
    Array(24).fill(/地域|名称|季節|比較|変わる|によって|長い|の|…/),
  );
  const outside = await svg.evaluate((n) => {
    const b = (n as unknown as SVGSVGElement).viewBox.baseVal;
    return [...n.querySelectorAll("text")]
      .filter((t) => {
        const r = (t as SVGGraphicsElement).getBBox();
        return (
          r.x < -0.5 ||
          r.y < -0.5 ||
          r.x + r.width > b.width + 0.5 ||
          r.y + r.height > b.height + 0.5
        );
      })
      .map((t) => t.textContent);
  });
  expect(outside).toEqual([]);
  // The fixture enters the app through JSON, which canonicalizes -0 to 0.
  expect((await data(page)).slides[1].elements[0].chart).toEqual(
    JSON.parse(JSON.stringify(chart.chart)),
  );
});
test("presentation checks only filtered targets, supports cancel, and excludes editor warning marks", async ({
  page,
}) => {
  await button(page, "マップをフィルタ").click();
  await page.getByRole("button", { name: /フィルタ選択: 1.2 グラフ/ }).click();
  await button(page, "フィルタを適用").click();
  await button(page, "この1ページを発表").click();
  const review = page.getByRole("dialog", {
    name: "表示チェック",
    exact: true,
  });
  await expect(review).toContainText("項目名の一部が省略");
  await expect(review).not.toContainText("1行1列");
  await review.getByRole("button", { name: "取り消す", exact: true }).click();
  await expect(page.locator(".present-mode")).toHaveCount(0);
  await button(page, "この1ページを発表").click();
  await button(page, "このまま進む").click();
  await expect(page.locator(".present-slide .chart-graphic")).toBeVisible();
  await expect(page.locator(".present-mode .cell-overflow-flag")).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".slide-card")).toHaveCount(1);
});
test("PDF fix and resume keeps the exact chosen IDs and rechecks edited cells before output", async ({
  page,
}) => {
  await pdf(page);
  const picker = page.getByLabel("対象スライド");
  await picker.getByRole("checkbox").nth(1).uncheck();
  await picker.getByRole("checkbox").nth(2).uncheck();
  await button(page, "PDFの準備").click();
  const review = page.getByRole("dialog", {
    name: "表示チェック",
    exact: true,
  });
  await expect(review).toContainText("1行1列");
  await review
    .getByRole("button", { name: "内容を確認・修正", exact: true })
    .first()
    .click();
  await expect(page.locator(".editor-main")).toBeVisible();
  for (const cell of await page
    .locator(".editor-workspace .slide-table textarea")
    .all())
    await cell.fill("短文");
  await expect(
    page.locator(".editor-workspace .cell-overflow-flag"),
  ).toHaveCount(0);
  await button(page, "PDFの準備を再開").click();
  await expect(
    page.getByLabel("対象スライド").getByRole("checkbox", { checked: true }),
  ).toHaveCount(1);
  await button(page, "PDFの準備").click();
  await expect(button(page, "印刷・PDFに保存")).toBeEnabled();
  await expect(page.locator(".print-page")).toHaveCount(1);
  await expect(page.locator(".print-export .cell-overflow-flag")).toHaveCount(
    0,
  );
});
test("acknowledged warnings stay out of print and do not bypass failed image decoding", async ({
  page,
}) => {
  const before = (await data(page)).slides;
  await pdf(page);
  await button(page, "PDFの準備").click();
  await button(page, "このまま進む").click();
  await expect(button(page, "印刷・PDFに保存")).toBeEnabled();
  await expect(page.locator(".print-page")).toHaveCount(3);
  await expect(page.locator(".print-export .cell-overflow-flag")).toHaveCount(
    0,
  );
  expect((await data(page)).slides).toEqual(before);
});
