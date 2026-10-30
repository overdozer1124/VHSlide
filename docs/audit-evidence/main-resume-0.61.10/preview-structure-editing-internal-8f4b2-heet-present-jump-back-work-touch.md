# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: structure-editing.spec.ts >> internal links select another sheet, present jump/back work
- Location: tests/e2e/structure-editing.spec.ts:290:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.present-mode').locator('.element[data-element-id="object-3"]')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('.present-mode').locator('.element[data-element-id="object-3"]') with timeout 5000ms
  - waiting for locator('.present-mode').locator('.element[data-element-id="object-3"]')

```

```yaml
- text: VHSlide / 構造テスト 基本・全体・2ページ · 対象外のリンク先
- button "発表者用ノートを開く":
  - img
  - text: 発表者ノート
- button "全画面切り替え":
  - img
- button "リンク元へ戻る"
- button "発表をおわる":
  - img
  - text: 発表をおわる
- text: 発表対象外 · 1行 / 1列 別シートの目的地 マウスを上下の端へ · タッチは画面をタップ
- button "上のページ" [disabled]:
  - img
- button "前の話題" [disabled]:
  - img
- button "下のページ" [disabled]:
  - img
- button "次の話題" [disabled]:
  - img
```

# Test source

```ts
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
  265 |   await page.getByRole("button", { name: "ファイル", exact: true }).click();
  266 |   await page.getByRole("menuitem", { name: /^PDFで保存/ }).click();
  267 |   await page.getByRole("button", { name: "選択を解除", exact: true }).click();
  268 |   await page
  269 |     .getByLabel("対象スライド")
  270 |     .locator('[data-choice="start"]')
  271 |     .getByRole("checkbox")
  272 |     .check();
  273 |   await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  274 |   await expect(
  275 |     page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  276 |   ).toBeEnabled();
  277 |   await expect(page.locator(".print-export .chart-graphic")).toHaveCount(1);
  278 |   const pdf = await page.pdf({
  279 |     path: test.info().outputPath("chart.pdf"),
  280 |     printBackground: true,
  281 |     preferCSSPageSize: true,
  282 |   });
  283 |   expect([
  284 |     ...pdf.toString("latin1").matchAll(/\/Type\s*\/Page\b/g),
  285 |   ]).toHaveLength(1);
  286 |   await test
  287 |     .info()
  288 |     .attach("グラフPDF", { body: pdf, contentType: "application/pdf" });
  289 | });
  290 | test("internal links select another sheet, present jump/back work", async ({
  291 |   page,
  292 | }) => {
  293 |   const node = es.find((e) => e.type === "shape")!;
  294 |   await object(page, node.id).dblclick();
  295 |   await object(page, node.id).getByRole("textbox").press("Escape");
  296 |   await page.getByRole("tab", { name: "リンク", exact: true }).click();
  297 |   await page.getByRole("button", { name: "移動先を選ぶ", exact: true }).click();
  298 |   const dialog = page.getByRole("dialog", { name: "リンク先のページを選ぶ" });
  299 |   await dialog
  300 |     .getByLabel("リンク先のシート", { exact: true })
  301 |     .selectOption("second");
  302 |   await dialog
  303 |     .getByRole("button", { name: "1.1 別シートの目的地にリンク", exact: true })
  304 |     .click();
  305 |   await expect
  306 |     .poll(
  307 |       async () =>
  308 |         (await saved(page)).slides
  309 |           .find((s: any) => s.id === "start")
  310 |           .elements.find((e: any) => e.id === node.id).link?.slideId,
  311 |     )
  312 |     .toBe("cross");
  313 |   await page.getByRole("button", { name: "発表する", exact: true }).click();
  314 |   await page
  315 |     .locator(".present-mode")
  316 |     .locator(`.element[data-element-id="${node.id}"]`)
  317 |     .click({ position: { x: 12, y: 12 } });
  318 |   const confirmation = page.getByRole("dialog", {
  319 |     name: "発表対象外のリンク",
  320 |     exact: true,
  321 |   });
  322 |   await expect(confirmation).toBeVisible();
  323 |   await confirmation
  324 |     .getByRole("button", { name: "リンク先を開く", exact: true })
  325 |     .click();
  326 |   await expect(confirmation).toHaveCount(0);
  327 |   await expect(page.locator(".present-caption")).toContainText(
  328 |     "別シートの目的地",
  329 |   );
  330 |   await page.locator(".present-mode").hover();
  331 |   await page
  332 |     .getByRole("button", { name: "リンク元へ戻る", exact: true })
  333 |     .click({ force: true });
  334 |   await expect(
  335 |     page
  336 |       .locator(".present-mode")
  337 |       .locator(`.element[data-element-id="${node.id}"]`),
> 338 |   ).toBeVisible();
      |     ^ Error: expect(locator).toBeVisible() failed
  339 |   await page.keyboard.press("Escape");
  340 |   await expect(
  341 |     page.getByRole("textbox", { name: "ページの名前", exact: true }),
  342 |   ).toHaveValue("構造テスト");
  343 |   await expect(page.locator(".workspace-flight")).toHaveCount(0);
  344 |   await canvas(page)
  345 |     .locator(`.element[data-element-id="${node.id}"]`)
  346 |     .click({ modifiers: ["Control"], position: { x: 12, y: 12 } });
  347 |   await expect(
  348 |     page.getByRole("textbox", { name: "ページの名前", exact: true }),
  349 |   ).toHaveValue("別シートの目的地");
  350 | });
  351 | test("structure palette remains usable in Chromebook and narrow layouts", async ({
  352 |   page,
  353 | }) => {
  354 |   for (const viewport of [
  355 |     { width: 1366, height: 610 },
  356 |     { width: 1024, height: 640 },
  357 |     { width: 390, height: 844 },
  358 |   ]) {
  359 |     await page.setViewportSize(viewport);
  360 |     const b = page.getByRole("button", {
  361 |       name: "もっと見る（図解・グラフ）",
  362 |       exact: true,
  363 |     });
  364 |     await b.scrollIntoViewIfNeeded();
  365 |     await b.click();
  366 |     const card = page.getByRole("button", {
  367 |       name: "比較の図解を追加",
  368 |       exact: true,
  369 |     });
  370 |     const r = await card.boundingBox();
  371 |     expect(r!.x).toBeGreaterThanOrEqual(0);
  372 |     expect(r!.y).toBeGreaterThanOrEqual(0);
  373 |     expect(r!.x + r!.width).toBeLessThanOrEqual(viewport.width);
  374 |     expect(r!.y + r!.height).toBeLessThanOrEqual(viewport.height);
  375 |     await expect(card).toBeInViewport();
  376 |     if (viewport.width === 1366)
  377 |       await test.info().attach("図解パレット", {
  378 |         body: await page.screenshot({
  379 |           path: test.info().outputPath("palette.png"),
  380 |         }),
  381 |         contentType: "image/png",
  382 |       });
  383 |     await card.click();
  384 |     await expect(canvas(page).locator(".element.selected-element")).toHaveCount(
  385 |       7,
  386 |     );
  387 |   }
  388 | });
  389 |
  390 | test("a deleted destination never opens another room or loses the current page", async ({
  391 |   page,
  392 | }) => {
  393 |   const d = await saved(page);
  394 |   const source = d.slides.find((s: any) => s.id === "start");
  395 |   source.elements[0].link = { slideId: "deleted-page" };
  396 |   await page.evaluate(
  397 |     (d) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(d)),
  398 |     d,
  399 |   );
  400 |   await page.reload();
  401 |   await page
  402 |     .getByRole("button", { name: "構造テストを編集", exact: true })
  403 |     .click();
  404 |   await expect(page.locator(".workspace-flight")).toHaveCount(0);
  405 |   await canvas(page)
  406 |     .locator('.element[data-object-link="true"]')
  407 |     .first()
  408 |     .click({ modifiers: ["Control"], position: { x: 12, y: 12 } });
  409 |   await expect(
  410 |     page.getByText("リンク先のページが見つかりません。", { exact: true }),
  411 |   ).toBeVisible();
  412 |   await expect(
  413 |     page.getByRole("textbox", { name: "ページの名前", exact: true }),
  414 |   ).toHaveValue("構造テスト");
  415 |   expect(new URL(page.url()).searchParams.get("room")).toBeNull();
  416 | });
  417 |
```
