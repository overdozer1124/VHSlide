# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: structure-editing.spec.ts >> a deleted destination never opens another room or loses the current page
- Location: tests/e2e/structure-editing.spec.ts:381:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('.editor-page-current .slide-canvas').getByRole('button', { name: 'リンク先のページへ', exact: true })

```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - banner [ref=f1e4]:
    - link "VHSlide 全体マップ" [ref=f1e5] [cursor=pointer]:
      - /url: "#"
      - text: VH
      - generic [ref=f1e12]: Slide
    - generic [ref=f1e14]:
      - textbox "作品のタイトル" [ref=f1e15]: 構造テスト
      - status "この端末に保存済み · このブラウザの一時保存です。授業の終わりにファイルへ書き出してください。" [ref=f1e16]:
        - generic [ref=f1e19]: この端末に保存済み
    - generic [ref=f1e20]:
      - button "作品" [ref=f1e22] [cursor=pointer]
      - generic [ref=f1e28]:
        - button "ファイルに保存" [ref=f1e29] [cursor=pointer]
        - button "保存方法を選ぶ" [ref=f1e35] [cursor=pointer]
      - generic [ref=f1e38]:
        - button "発表する" [ref=f1e39] [cursor=pointer]
        - button "発表方法を選ぶ" [ref=f1e45] [cursor=pointer]
  - main [ref=f1e48]:
    - generic [ref=f1e49]:
      - button "全体マップへ" [ref=f1e50] [cursor=pointer]
      - button "文字" [ref=f1e54] [cursor=pointer]
      - button "画像" [ref=f1e57] [cursor=pointer]
      - button "手描き" [ref=f1e62] [cursor=pointer]
      - button "表を追加" [ref=f1e64] [cursor=pointer]: 表
      - button "図形を追加" [ref=f1e67] [cursor=pointer]: 図形
      - button "線を追加" [ref=f1e72] [cursor=pointer]: 線
      - button "もっと見る（図解・グラフ）" [ref=f1e76] [cursor=pointer]: もっと見る
      - button "スピーカーノート" [ref=f1e79] [cursor=pointer]: ノート
      - group "編集画面の表示" [ref=f1e83]:
        - button "表示の設定" [ref=f1e84] [cursor=pointer]: 表示
        - button "サムネイルバーをたたむ" [expanded] [ref=f1e88] [cursor=pointer]
        - button "右のサイドバーをたたむ" [expanded] [ref=f1e92] [cursor=pointer]
      - generic [ref=f1e96]:
        - button "もとに戻す" [disabled] [ref=f1e97]
        - button "やり直す" [disabled] [ref=f1e101]
        - button "その他" [ref=f1e107] [cursor=pointer]
    - generic [ref=f1e113]:
      - complementary "縦横のページ一覧" [ref=f1e114]:
        - generic [ref=f1e115]:
          - strong [ref=f1e116]: ページ一覧
          - button "行番号一覧" [ref=f1e117] [cursor=pointer]
        - generic [ref=f1e122]:
          - button "1段目の横のページをひらく" [ref=f1e123] [cursor=pointer]:
            - generic [ref=f1e124]:
              - generic [ref=f1e125]: "1.1"
              - generic "ここをドラッグで段ごと移動" [ref=f1e126]
            - generic [ref=f1e137]:
              - generic:
                - generic: 順番にまとめよう
                - generic: はじめ
                - generic: 途中
                - generic: まとめ
          - textbox "1.1のフッター" [ref=f1e138]: 構造テスト
          - button "1段目のメニュー" [ref=f1e139] [cursor=pointer]
          - button "1段目の下に行を挿入" [ref=f1e145] [cursor=pointer]
        - generic [ref=f1e149]: 段ごと移動 ↕ · 重ねて入れ替え · 間に挿入
        - separator "サムネイルバーの幅" [ref=f1e150]
      - status [ref=f1e151]
      - generic [ref=f1e152]:
        - generic [ref=f1e153]:
          - generic "基本・全体・2ページ" [ref=f1e154]:
            - generic [ref=f1e155]: 基本・全体
            - generic [ref=f1e156]: 2ページ
          - textbox "ページの名前" [ref=f1e157]: 構造テスト
          - generic [ref=f1e158]: 1.1 / 16:9
        - generic "編集中のスライド" [ref=f1e159]:
          - generic [ref=f1e162]:
            - generic "テキストボックス" [ref=f1e163] [cursor=pointer]: 順番にまとめよう
            - generic "テキストボックス" [ref=f1e185]: はじめ
            - generic "テキストボックス" [ref=f1e195]: 途中
            - generic "テキストボックス" [ref=f1e205]: まとめ
        - generic [ref=f1e215]: 空白からドラッグで範囲選択 · Shift/Ctrl＋クリックで追加
      - complementary [ref=f1e217]:
        - generic [ref=f1e219]:
          - generic [ref=f1e220]: ページ設定
          - heading "ページのデザイン" [level=2] [ref=f1e221]
        - group [ref=f1e223]:
          - generic [ref=f1e224]:
            - generic [ref=f1e225]:
              - text: 背景の色
              - textbox "背景の色" [ref=f1e226] [cursor=pointer]: "#ffffff"
            - generic [ref=f1e227]:
              - button "背景を#ffffffに変更" [ref=f1e228] [cursor=pointer]
              - button "背景を#e5f0dcに変更" [ref=f1e229] [cursor=pointer]
              - button "背景を#e7efeaに変更" [ref=f1e230] [cursor=pointer]
              - button "背景を#f8eddcに変更" [ref=f1e231] [cursor=pointer]
              - button "背景を#f4e5e4に変更" [ref=f1e232] [cursor=pointer]
              - button "背景を#e4eaf6に変更" [ref=f1e233] [cursor=pointer]
              - button "背景を#173d38に変更" [ref=f1e234] [cursor=pointer]
              - button "背景を#d6bc94に変更" [ref=f1e235] [cursor=pointer]
            - paragraph [ref=f1e236]: キャンバスの中の文字や図形をタップすると、色や大きさを変えられます。
  - generic "シート一覧" [ref=f1e237]:
    - tablist "作品のシート" [ref=f1e238]:
      - tab "基本" [selected] [ref=f1e240] [cursor=pointer]
      - tab "別のシート" [ref=f1e242] [cursor=pointer]
    - button "空のシートを追加" [ref=f1e243] [cursor=pointer]
    - button "シートの操作" [ref=f1e245] [cursor=pointer]
  - status [ref=f1e250]
```

# Test source

```ts
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
  319 |     .click();
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
> 398 |     .click();
      |      ^ Error: locator.click: Test timeout of 30000ms exceeded.
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