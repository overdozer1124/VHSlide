# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: page-scope.spec.ts >> an outside link requires an explicit action and never expands the presentation scope
- Location: tests/e2e/page-scope.spec.ts:331:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'リンク先のページへ', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic "発表の操作":
    - generic:
      - text: VHSlide
      - generic: / 範囲の検証
      - generic "発表対象": 学級の比較・絞り込み・2ページ
    - generic:
      - button "発表者用ノートを開く": 発表者ノート
      - button "全画面切り替え"
      - button "発表をおわる"
  - generic [ref=e2]: S1.1
  - generic:
    - generic "現在地マップ":
      - generic "ページ1.1"
      - generic "ページ2.1"
      - generic: 1.1 現在地
    - generic:
      - text: ページ1.1
      - generic: マウスを上下の端へ · タッチは画面をタップ
    - generic:
      - button "上のページ" [disabled]
      - generic:
        - button "前の話題" [disabled]
        - button "下のページ"
        - button "次の話題" [disabled]
```

# Test source

```ts
  243 |   ).toHaveCount(2);
  244 |   await page.getByRole("button", { name: "閉じる", exact: true }).click();
  245 |   await tool(page, "PDFで保存");
  246 |   await expect(picker.getByRole("checkbox", { checked: true })).toHaveCount(2);
  247 |   await scope.selectOption("sheet");
  248 |   await expect(picker.getByRole("checkbox", { checked: true })).toHaveCount(9);
  249 |   await scope.selectOption("filter");
  250 |   await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  251 |   await expect(
  252 |     page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  253 |   ).toBeEnabled();
  254 |   await expect(page.locator(".print-export .print-page")).toHaveCount(2);
  255 | });
  256 | test("current-page and saved-route presentations return to the original filtered editor", async ({
  257 |   page,
  258 | }) => {
  259 |   await filterIds(page, [
  260 |     [1, 0],
  261 |     [1, 1],
  262 |     [1, 2],
  263 |   ]);
  264 |   await page
  265 |     .getByRole("button", { name: "ページ2.2を編集", exact: true })
  266 |     .click();
  267 |   await expect(page.locator(".workspace-flight")).toHaveCount(0);
  268 |   await page
  269 |     .getByRole("button", { name: "発表方法を選ぶ", exact: true })
  270 |     .click();
  271 |   await page
  272 |     .getByRole("menuitem", { name: /現在のページから縦横に発表/ })
  273 |     .click();
  274 |   await expect(current(page)).toContainText("S2.2");
  275 |   await page.keyboard.press("ArrowDown");
  276 |   await expect(current(page)).toContainText("S3.2");
  277 |   await page.keyboard.press("Escape");
  278 |   await expect(
  279 |     page.getByRole("textbox", { name: "ページの名前", exact: true }),
  280 |   ).toHaveValue("ページ2.2");
  281 |   await page
  282 |     .getByRole("button", { name: "発表方法を選ぶ", exact: true })
  283 |     .click();
  284 |   await page.getByRole("menuitem", { name: /保存済みの発表で発表/ }).click();
  285 |   await expect(current(page)).toContainText("S3.3");
  286 |   await page.keyboard.press("ArrowRight");
  287 |   await expect(current(page)).toContainText("OTHER");
  288 |   await page.keyboard.press("Escape");
  289 |   await expect(
  290 |     page.getByRole("textbox", { name: "ページの名前", exact: true }),
  291 |   ).toHaveValue("ページ2.2");
  292 |   await expect(
  293 |     page.getByRole("button", { name: "この3ページを発表", exact: true }),
  294 |   ).toBeVisible();
  295 | });
  296 | test("an editor showing all pages does not inherit the hidden map filter for PDF or presentation", async ({
  297 |   page,
  298 | }) => {
  299 |   await filterIds(page, [
  300 |     [1, 0],
  301 |     [1, 1],
  302 |   ]);
  303 |   await page
  304 |     .getByRole("button", { name: "ページ1.2を編集", exact: true })
  305 |     .click();
  306 |   await expect(page.locator(".workspace-flight")).toHaveCount(0);
  307 |   await page
  308 |     .getByRole("button", { name: "編集画面にもフィルタを適用", exact: true })
  309 |     .click();
  310 |   await expect(
  311 |     page.getByRole("button", { name: "発表する", exact: true }),
  312 |   ).toBeVisible();
  313 |   await tool(page, "PDFで保存");
  314 |   await expect(
  315 |     page.getByLabel("対象スライド").getByRole("checkbox", { checked: true }),
  316 |   ).toHaveCount(9);
  317 |   await page.getByRole("button", { name: "閉じる", exact: true }).click();
  318 |   await page.getByRole("button", { name: "発表する", exact: true }).click();
  319 |   await expect(current(page)).toContainText("S1.1");
  320 |   await page.keyboard.press("Escape");
  321 |   await expect(
  322 |     page.getByRole("textbox", { name: "ページの名前", exact: true }),
  323 |   ).toHaveValue("ページ1.2");
  324 |   await expect(
  325 |     page.getByRole("button", {
  326 |       name: "編集画面にもフィルタを適用",
  327 |       exact: true,
  328 |     }),
  329 |   ).toHaveAttribute("aria-pressed", "false");
  330 | });
  331 | test("an outside link requires an explicit action and never expands the presentation scope", async ({
  332 |   page,
  333 | }) => {
  334 |   await filterIds(page, [
  335 |     [0, 0],
  336 |     [0, 1],
  337 |   ]);
  338 |   await page
  339 |     .getByRole("button", { name: "この2ページを発表", exact: true })
  340 |     .click();
  341 |   await page
  342 |     .getByRole("button", { name: "リンク先のページへ", exact: true })
> 343 |     .click();
      |      ^ Error: locator.click: Test timeout of 30000ms exceeded.
  344 |   await expect(
  345 |     page.getByRole("dialog", { name: "発表対象外のリンク", exact: true }),
  346 |   ).toBeVisible();
  347 |   await page.keyboard.press("Escape");
  348 |   await expect(current(page)).toContainText("S1.1");
  349 |   await page
  350 |     .getByRole("button", { name: "リンク先のページへ", exact: true })
  351 |     .click();
  352 |   await page
  353 |     .getByRole("button", { name: "リンク先を開く", exact: true })
  354 |     .click();
  355 |   await expect(current(page)).toContainText("OTHER");
  356 |   await expect(page.getByLabel("発表対象", { exact: true })).toContainText(
  357 |     "2ページ",
  358 |   );
  359 |   await expect(
  360 |     page.getByRole("button", { name: "次の話題", exact: true }),
  361 |   ).toBeDisabled();
  362 |   await page.keyboard.press("ArrowRight");
  363 |   await expect(current(page)).toContainText("OTHER");
  364 |   await page.mouse.move(15, 5);
  365 |   await page
  366 |     .getByRole("button", { name: "リンク元へ戻る", exact: true })
  367 |     .click();
  368 |   await expect(current(page)).toContainText("S1.1");
  369 |   await page.keyboard.press("ArrowDown");
  370 |   await expect(current(page)).toContainText("S2.1");
  371 | });
  372 | test("a large comparison scope remains a candidate set rather than silently selecting four pages", async ({
  373 |   page,
  374 | }) => {
  375 |   const book = {
  376 |     ...source,
  377 |     title: "400ページ",
  378 |     sheets: [source.sheets![0]],
  379 |     routes: [],
  380 |     slides: Array.from({ length: 400 }, (_, i) => ({
  381 |       ...blank(i % 10, Math.floor(i / 10)),
  382 |       id: `large-${i}`,
  383 |     })),
  384 |   };
  385 |   await page
  386 |     .locator('input[type=file][accept=".json,application/json"]')
  387 |     .setInputFiles({
  388 |       name: "large.json",
  389 |       mimeType: "application/json",
  390 |       buffer: Buffer.from(JSON.stringify(book)),
  391 |     });
  392 |   await expect(page.locator(".deck-title")).toHaveValue("400ページ");
  393 |   await tool(page, "比較");
  394 |   const boxes = page.getByLabel("対象スライド").getByRole("checkbox");
  395 |   await expect(boxes).toHaveCount(400);
  396 |   await expect(
  397 |     page.getByLabel("対象スライド").getByRole("checkbox", { checked: true }),
  398 |   ).toHaveCount(0);
  399 |   for (let i = 0; i < 4; i++) await boxes.nth(i).check();
  400 |   await expect(boxes.nth(4)).toBeDisabled();
  401 |   await boxes.nth(0).uncheck();
  402 |   await expect(boxes.nth(4)).toBeEnabled();
  403 | });
  404 | 
```