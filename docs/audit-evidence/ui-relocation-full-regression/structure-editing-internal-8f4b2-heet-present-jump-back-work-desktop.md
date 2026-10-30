# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: structure-editing.spec.ts >> internal links select another sheet, present jump/back work
- Location: tests/e2e/structure-editing.spec.ts:292:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('.present-mode').getByRole('button', { name: 'リンク先のページへ', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic "発表の操作":
    - generic:
      - text: VHSlide
      - generic: / 構造テスト
      - generic "発表対象": 基本・全体・2ページ
    - generic:
      - button "発表者用ノートを開く": 発表者ノート
      - button "全画面切り替え"
      - button "発表をおわる"
  - generic [ref=e4]:
    - generic [ref=e5]: 順番にまとめよう
    - generic [ref=e15] [cursor=pointer]: はじめ
    - generic [ref=e21]: 途中
    - generic [ref=e27]: まとめ
  - generic:
    - generic "現在地マップ":
      - generic "構造テスト"
      - generic "到着ページ"
      - generic: 1.1 現在地
    - generic:
      - text: 構造テスト
      - generic: マウスを上下の端へ · タッチは画面をタップ
    - generic:
      - button "上のページ" [disabled]
      - generic:
        - button "前の話題" [disabled]
        - button "下のページ" [disabled]
        - button "次の話題"
```

# Test source

```ts
  219 | test("chart data and type persist, render in presentation and print", async ({
  220 |   page,
  221 | }) => {
  222 |   await page
  223 |     .getByRole("button", { name: "もっと見る（図解・グラフ）", exact: true })
  224 |     .click();
  225 |   await page.getByRole("button", { name: "グラフ", exact: true }).click();
  226 |   await page
  227 |     .getByRole("button", { name: "棒グラフを追加", exact: true })
  228 |     .click();
  229 |   await page
  230 |     .getByLabel("グラフのタイトル", { exact: true })
  231 |     .fill("みんなの意見");
  232 |   const v = page.getByRole("spinbutton", {
  233 |     name: "グラフ項目1の値",
  234 |     exact: true,
  235 |   });
  236 |   await v.fill("55");
  237 |   await v.press("Tab");
  238 |   await page.getByLabel("グラフの種類", { exact: true }).selectOption("pie");
  239 |   await expect(
  240 |     canvas(page).getByRole("img", { name: "みんなの意見", exact: true }),
  241 |   ).toBeVisible();
  242 |   await expect
  243 |     .poll(
  244 |       async () =>
  245 |         (await saved(page)).slides
  246 |           .find((s: any) => s.id === "start")
  247 |           .elements.at(-1).chart.series[0].value,
  248 |     )
  249 |     .toBe(55);
  250 |   await page.reload();
  251 |   await page
  252 |     .getByRole("button", { name: "構造テストを編集", exact: true })
  253 |     .click();
  254 |   await expect(page.locator(".workspace-flight")).toHaveCount(0);
  255 |   await expect(
  256 |     canvas(page).getByRole("img", { name: "みんなの意見", exact: true }),
  257 |   ).toBeVisible();
  258 |   await page.getByRole("button", { name: "発表する", exact: true }).click();
  259 |   await expect(
  260 |     page
  261 |       .locator(".present-mode")
  262 |       .getByRole("img", { name: "みんなの意見", exact: true }),
  263 |   ).toBeVisible();
  264 |   await page.keyboard.press("Escape");
  265 |   await page
  266 |     .getByRole("button", { name: "保存方法を選ぶ", exact: true })
  267 |     .click();
  268 |   await page.getByRole("menuitem", { name: /^PDFで保存/ }).click();
  269 |   await page.getByRole("button", { name: "選択を解除", exact: true }).click();
  270 |   await page
  271 |     .getByLabel("対象スライド")
  272 |     .locator('[data-choice="start"]')
  273 |     .getByRole("checkbox")
  274 |     .check();
  275 |   await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  276 |   await expect(
  277 |     page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  278 |   ).toBeEnabled();
  279 |   await expect(page.locator(".print-export .chart-graphic")).toHaveCount(1);
  280 |   const pdf = await page.pdf({
  281 |     path: test.info().outputPath("chart.pdf"),
  282 |     printBackground: true,
  283 |     preferCSSPageSize: true,
  284 |   });
  285 |   expect([
  286 |     ...pdf.toString("latin1").matchAll(/\/Type\s*\/Page\b/g),
  287 |   ]).toHaveLength(1);
  288 |   await test
  289 |     .info()
  290 |     .attach("グラフPDF", { body: pdf, contentType: "application/pdf" });
  291 | });
  292 | test("internal links select another sheet, present jump/back work", async ({
  293 |   page,
  294 | }) => {
  295 |   const node = es.find((e) => e.type === "shape")!;
  296 |   await object(page, node.id).dblclick();
  297 |   await object(page, node.id).getByRole("textbox").press("Escape");
  298 |   await page.getByRole("tab", { name: "リンク", exact: true }).click();
  299 |   await page.getByRole("button", { name: "移動先を選ぶ", exact: true }).click();
  300 |   const dialog = page.getByRole("dialog", { name: "リンク先のページを選ぶ" });
  301 |   await dialog
  302 |     .getByLabel("リンク先のシート", { exact: true })
  303 |     .selectOption("second");
  304 |   await dialog
  305 |     .getByRole("button", { name: "1.1 別シートの目的地にリンク", exact: true })
  306 |     .click();
  307 |   await expect
  308 |     .poll(
  309 |       async () =>
  310 |         (await saved(page)).slides
  311 |           .find((s: any) => s.id === "start")
  312 |           .elements.find((e: any) => e.id === node.id).link?.slideId,
  313 |     )
  314 |     .toBe("cross");
  315 |   await page.getByRole("button", { name: "発表する", exact: true }).click();
  316 |   await page
  317 |     .locator(".present-mode")
  318 |     .getByRole("button", { name: "リンク先のページへ", exact: true })
> 319 |     .click();
      |      ^ Error: locator.click: Test timeout of 30000ms exceeded.
  320 |   await expect(page.locator(".present-mode")).toContainText("別シートの目的地");
  321 |   await page.locator(".present-mode").hover();
  322 |   await page
  323 |     .getByRole("button", { name: "リンク元へ戻る", exact: true })
  324 |     .click({ force: true });
  325 |   await expect(
  326 |     page
  327 |       .locator(".present-mode")
  328 |       .getByRole("button", { name: "リンク先のページへ", exact: true }),
  329 |   ).toBeVisible();
  330 |   await page.keyboard.press("Escape");
  331 |   await page
  332 |     .getByRole("button", { name: "構造テストを編集", exact: true })
  333 |     .click();
  334 |   await expect(page.locator(".workspace-flight")).toHaveCount(0);
  335 |   await canvas(page)
  336 |     .getByRole("button", { name: "リンク先のページへ", exact: true })
  337 |     .click();
  338 |   await expect(
  339 |     page.getByRole("textbox", { name: "ページの名前", exact: true }),
  340 |   ).toHaveValue("別シートの目的地");
  341 | });
  342 | test("structure palette remains usable in Chromebook and narrow layouts", async ({
  343 |   page,
  344 | }) => {
  345 |   for (const viewport of [
  346 |     { width: 1366, height: 610 },
  347 |     { width: 1024, height: 640 },
  348 |     { width: 390, height: 844 },
  349 |   ]) {
  350 |     await page.setViewportSize(viewport);
  351 |     const b = page.getByRole("button", {
  352 |       name: "もっと見る（図解・グラフ）",
  353 |       exact: true,
  354 |     });
  355 |     await b.scrollIntoViewIfNeeded();
  356 |     await b.click();
  357 |     const card = page.getByRole("button", {
  358 |       name: "比較の図解を追加",
  359 |       exact: true,
  360 |     });
  361 |     const r = await card.boundingBox();
  362 |     expect(r!.x).toBeGreaterThanOrEqual(0);
  363 |     expect(r!.y).toBeGreaterThanOrEqual(0);
  364 |     expect(r!.x + r!.width).toBeLessThanOrEqual(viewport.width);
  365 |     expect(r!.y + r!.height).toBeLessThanOrEqual(viewport.height);
  366 |     await expect(card).toBeInViewport();
  367 |     if (viewport.width === 1366)
  368 |       await test.info().attach("図解パレット", {
  369 |         body: await page.screenshot({
  370 |           path: test.info().outputPath("palette.png"),
  371 |         }),
  372 |         contentType: "image/png",
  373 |       });
  374 |     await card.click();
  375 |     await expect(canvas(page).locator(".element.selected-element")).toHaveCount(
  376 |       7,
  377 |     );
  378 |   }
  379 | });
  380 | 
  381 | test("a deleted destination never opens another room or loses the current page", async ({
  382 |   page,
  383 | }) => {
  384 |   const d = await saved(page);
  385 |   const source = d.slides.find((s: any) => s.id === "start");
  386 |   source.elements[0].link = { slideId: "deleted-page" };
  387 |   await page.evaluate(
  388 |     (d) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(d)),
  389 |     d,
  390 |   );
  391 |   await page.reload();
  392 |   await page
  393 |     .getByRole("button", { name: "構造テストを編集", exact: true })
  394 |     .click();
  395 |   await expect(page.locator(".workspace-flight")).toHaveCount(0);
  396 |   await canvas(page)
  397 |     .getByRole("button", { name: "リンク先のページへ", exact: true })
  398 |     .click();
  399 |   await expect(
  400 |     page.getByText("リンク先のページが見つかりません。", { exact: true }),
  401 |   ).toBeVisible();
  402 |   await expect(
  403 |     page.getByRole("textbox", { name: "ページの名前", exact: true }),
  404 |   ).toHaveValue("構造テスト");
  405 |   expect(new URL(page.url()).searchParams.get("room")).toBeNull();
  406 | });
  407 | 
```