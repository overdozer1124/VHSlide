# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor-inspector-ux.spec.ts >> cell scrollbars are hidden; empty space focuses input, long text stays editable and fixed in the table
- Location: tests/e2e/editor-inspector-ux.spec.ts:76:1

# Error details

```
Error: expect(locator).toBeFocused() failed

Locator:  getByRole('textbox', { name: '表 3行 3列', exact: true })
Expected: focused
Received: inactive
Timeout:  5000ms

Call log:
  - Expect "toBeFocused" getByRole('textbox', { name: '表 3行 3列', exact: true }) with timeout 5000ms
  - waiting for getByRole('textbox', { name: '表 3行 3列', exact: true })
    14 × locator resolved to <textarea maxlength="2000" spellcheck="true" aria-label="表 3行 3列" aria-selected="false" data-cell="cell-3:cell-6"></textarea>
       - unexpected value "inactive"

```

```yaml
- textbox "表 3行 3列"
```

# Test source

```ts
  1   | import { test, expect, type Page } from "@playwright/test";
  2   | import { blank, type Deck } from "../../src/model";
  3   | import { createTable } from "../../src/tableData";
  4   | let n = 0;
  5   | const deck: Deck = {
  6   |   version: 1,
  7   |   title: "設定の使い勝手",
  8   |   slides: [
  9   |     {
  10  |       ...blank(0, 0),
  11  |       id: "ux",
  12  |       title: "設定の使い勝手",
  13  |       elements: [
  14  |         {
  15  |           id: "table",
  16  |           type: "table",
  17  |           x: 60,
  18  |           y: 170,
  19  |           w: 570,
  20  |           h: 300,
  21  |           table: createTable(3, 3, () => `cell-${++n}`),
  22  |           fontSize: 24,
  23  |           color: "#173d38",
  24  |           fill: "#ffffff",
  25  |           stroke: "#729276",
  26  |         },
  27  |         {
  28  |           id: "shape",
  29  |           type: "shape",
  30  |           shape: "rect",
  31  |           x: 700,
  32  |           y: 200,
  33  |           w: 130,
  34  |           h: 120,
  35  |           fill: "#b8d394",
  36  |           stroke: "#173d38",
  37  |         },
  38  |         {
  39  |           id: "text",
  40  |           type: "text",
  41  |           x: 80,
  42  |           y: 40,
  43  |           w: 700,
  44  |           h: 80,
  45  |           text: "ここにことばを入力",
  46  |           fontSize: 32,
  47  |           color: "#173d38",
  48  |         },
  49  |       ],
  50  |     },
  51  |   ],
  52  | };
  53  | const cell = (p: Page, r = 1, c = 1) =>
  54  |   p.getByRole("textbox", { name: `表 ${r}行 ${c}列`, exact: true });
  55  | const object = (p: Page, id: string) =>
  56  |   p.locator(`.editor-page-current .element[data-element-id="${id}"]`);
  57  | const saved = (p: Page) =>
  58  |   p.evaluate(
  59  |     () =>
  60  |       JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0].elements,
  61  |   );
  62  | test.beforeEach(async ({ page }) => {
  63  |   await page.route("**/api/config", (r) =>
  64  |     r.fulfill({ json: { clientId: "", notice: "" } }),
  65  |   );
  66  |   await page.addInitScript((d) => {
  67  |     if (!localStorage.getItem("vhslide-deck-v1"))
  68  |       localStorage.setItem("vhslide-deck-v1", JSON.stringify(d));
  69  |   }, deck);
  70  |   await page.goto("/");
  71  |   await page
  72  |     .getByRole("button", { name: "設定の使い勝手を編集", exact: true })
  73  |     .click();
  74  |   await expect(page.locator(".workspace-flight")).toHaveCount(0);
  75  | });
  76  | test("cell scrollbars are hidden; empty space focuses input, long text stays editable and fixed in the table", async ({
  77  |   page,
  78  | }, info) => {
  79  |   await cell(page).click();
  80  |   await cell(page).fill("ああああ");
  81  |   await cell(page, 1, 2).fill("いいい");
  82  |   await cell(page, 2, 2).fill("ううう");
  83  |   const content = object(page, "table")
  84  |       .locator("td")
  85  |       .last()
  86  |       .locator(".table-cell-content"),
  87  |     r = await content.boundingBox();
  88  |   if (info.project.name === "touch")
  89  |     await page.touchscreen.tap(r!.x + r!.width / 2, r!.y + r!.height - 5);
  90  |   else await page.mouse.click(r!.x + r!.width / 2, r!.y + r!.height - 5);
> 91  |   await expect(cell(page, 3, 3)).toBeFocused();
      |                                  ^ Error: expect(locator).toBeFocused() failed
  92  |   await cell(page, 3, 3).fill("長い文\n".repeat(40));
  93  |   await cell(page, 3, 3).press("End");
  94  |   await cell(page, 3, 3).press("!");
  95  |   await expect(cell(page, 3, 3)).toHaveValue(/!/);
  96  |   for (const field of await object(page, "table").locator("textarea").all()) {
  97  |     expect(
  98  |       await field.evaluate((e) => getComputedStyle(e).scrollbarWidth),
  99  |     ).toBe("none");
  100 |     expect(
  101 |       await field.evaluate(
  102 |         (e) => getComputedStyle(e, "::-webkit-scrollbar").display,
  103 |       ),
  104 |     ).toBe("none");
  105 |   }
  106 |   const before = await saved(page);
  107 |   expect(before[0].x).toBe(60);
  108 |   expect(before[0].h).toBe(300);
  109 |   await page.screenshot({ path: info.outputPath("table-clean-input.png") });
  110 | });
  111 | test("sidebar retains the chosen section across selection; keyboard tabs and insertion defaults work", async ({
  112 |   page,
  113 | }, info) => {
  114 |   await object(page, "shape").click();
  115 |   const tabs = page.getByRole("tablist", { name: "編集設定", exact: true });
  116 |   await expect(
  117 |     tabs.getByRole("tab", { name: "見た目", exact: true }),
  118 |   ).toHaveAttribute("aria-selected", "true");
  119 |   await expect(page.getByLabel("図形の塗り色", { exact: true })).toBeVisible();
  120 |   await expect(
  121 |     page.getByRole("button", { name: "最背面へ", exact: true }),
  122 |   ).toHaveCount(0);
  123 |   await tabs.getByRole("tab", { name: "見た目", exact: true }).focus();
  124 |   await page.keyboard.press("ArrowRight");
  125 |   await expect(
  126 |     tabs.getByRole("tab", { name: "配置", exact: true }),
  127 |   ).toBeFocused();
  128 |   await expect(
  129 |     page.getByRole("button", { name: "最背面へ", exact: true }),
  130 |   ).toBeVisible();
  131 |   await page.keyboard.press("End");
  132 |   await expect(
  133 |     page.getByRole("button", { name: "移動先を選ぶ", exact: true }),
  134 |   ).toBeVisible();
  135 |   await page.keyboard.press("Home");
  136 |   await expect(page.getByLabel("図形の塗り色", { exact: true })).toBeVisible();
  137 |   await tabs.getByRole("tab", { name: "配置", exact: true }).click();
  138 |   await object(page, "text").click();
  139 |   await expect(
  140 |     tabs.getByRole("tab", { name: "配置", exact: true }),
  141 |   ).toHaveAttribute("aria-selected", "true");
  142 |   await expect(
  143 |     page.getByRole("heading", { name: "文字", exact: true }),
  144 |   ).toBeVisible();
  145 |   await expect(
  146 |     page
  147 |       .locator(".inspector-quick-actions")
  148 |       .getByRole("button", { name: "複製", exact: true }),
  149 |   ).toBeVisible();
  150 |   await page
  151 |     .locator(".editor-toolbar")
  152 |     .getByRole("button", { name: "文字", exact: true })
  153 |     .click();
  154 |   await expect(
  155 |     tabs.getByRole("tab", { name: "見た目", exact: true }),
  156 |   ).toHaveAttribute("aria-selected", "true");
  157 |   await page.screenshot({ path: info.outputPath("contextual-inspector.png") });
  158 | });
  159 | 
  160 | test("mixed cell formats are explicit and inspecting them never applies the first cell's values", async ({
  161 |   page,
  162 | }) => {
  163 |   await cell(page).click();
  164 |   await page.getByLabel("セルの文字の大きさ", { exact: true }).fill("20");
  165 |   await page.getByLabel("セルの文字の大きさ", { exact: true }).press("Tab");
  166 |   await page
  167 |     .getByLabel("セルの左右揃え", { exact: true })
  168 |     .selectOption("center");
  169 |   await cell(page, 2, 2).click();
  170 |   await page.getByLabel("セルの文字の大きさ", { exact: true }).fill("32");
  171 |   await page.getByLabel("セルの文字の大きさ", { exact: true }).press("Tab");
  172 |   await page
  173 |     .getByRole("button", { name: "セルの範囲を選ぶ", exact: true })
  174 |     .click();
  175 |   await cell(page).click();
  176 |   await cell(page, 2, 2).click();
  177 |   const size = page.getByLabel("セルの文字の大きさ", { exact: true });
  178 |   await expect(size).toHaveValue("");
  179 |   await expect(size).toHaveAttribute("placeholder", "混在");
  180 |   await expect(
  181 |     page.getByRole("button", { name: "セルを太字", exact: true }),
  182 |   ).toHaveAttribute("aria-pressed", "mixed");
  183 |   await expect(page.getByLabel("セルの左右揃え", { exact: true })).toHaveValue(
  184 |     "mixed",
  185 |   );
  186 |   const before = await saved(page);
  187 |   await size.focus();
  188 |   await size.press("Tab");
  189 |   await page.evaluate(
  190 |     () =>
  191 |       new Promise<void>((r) =>
```