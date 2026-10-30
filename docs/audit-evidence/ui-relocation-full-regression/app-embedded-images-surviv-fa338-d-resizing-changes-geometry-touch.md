# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: app.spec.ts >> embedded images survive upload, clipboard paste, drop and reload; resizing changes geometry
- Location: tests/e2e/app.spec.ts:143:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 20
Received:   20
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - link "VHSlide 全体マップ" [ref=e5] [cursor=pointer]:
      - /url: "#"
      - text: VH
      - generic [ref=e12]: Slide
    - generic [ref=e14]:
      - textbox "作品のタイトル" [ref=e15]: わたしたちのまちの、いいところ
      - status "この端末に保存済み · このブラウザの一時保存です。授業の終わりにファイルへ書き出してください。" [ref=e16]:
        - generic [ref=e19]: この端末に保存済み
    - generic [ref=e20]:
      - button "作品" [ref=e22] [cursor=pointer]
      - generic [ref=e28]:
        - button "ファイルに保存" [ref=e29] [cursor=pointer]
        - button "保存方法を選ぶ" [ref=e35] [cursor=pointer]
      - generic [ref=e38]:
        - button "発表する" [ref=e39] [cursor=pointer]
        - button "発表方法を選ぶ" [ref=e45] [cursor=pointer]
  - main [ref=e48]:
    - generic [ref=e49]:
      - button "全体マップへ" [ref=e50] [cursor=pointer]
      - button "文字" [ref=e53] [cursor=pointer]
      - button "画像" [ref=e56] [cursor=pointer]
      - button "手描き" [ref=e61] [cursor=pointer]
      - button "表を追加" [ref=e63] [cursor=pointer]: 表
      - button "図形を追加" [ref=e66] [cursor=pointer]: 図形
      - button "線を追加" [ref=e71] [cursor=pointer]: 線
      - button "もっと見る（図解・グラフ）" [ref=e75] [cursor=pointer]: もっと見る
      - button "まとめて選択" [ref=e78] [cursor=pointer]:
        - generic [aria-hidden] [ref=e79]: ▧
        - text: まとめて選択
      - button "スピーカーノート" [ref=e80] [cursor=pointer]: ノート
      - group "編集画面の表示" [ref=e84]:
        - button "表示の設定" [ref=e85] [cursor=pointer]: 表示
        - button "サムネイルバーをたたむ" [expanded] [ref=e89] [cursor=pointer]
        - button "右のサイドバーをたたむ" [expanded] [ref=e93] [cursor=pointer]
      - generic [ref=e97]:
        - button "もとに戻す" [ref=e98] [cursor=pointer]
        - button "やり直す" [disabled] [ref=e102]
        - button "その他" [ref=e108] [cursor=pointer]
    - generic [ref=e114]:
      - complementary "縦横のページ一覧" [ref=e115]:
        - generic [ref=e116]:
          - strong [ref=e117]: ページ一覧
          - button "行番号一覧" [ref=e118] [cursor=pointer]
        - generic [ref=e121]:
          - generic [ref=e123]:
            - button "1段目の横のページをひらく" [ref=e124] [cursor=pointer]:
              - generic [ref=e125]:
                - generic [ref=e126]: "1.1"
                - generic "ここをドラッグで段ごと移動" [ref=e127]
              - generic [ref=e138]:
                - generic:
                  - generic: OUR TOWN
                  - generic: わたしたちのまちの、 いいところ。
                  - generic: いつもの景色に、新しい発見。
                  - generic:
                    - generic:
                      - generic:
                        - img "スライドの画像"
            - textbox "1.1のフッター" [ref=e139]: わたしたちのまち
            - button "1段目のメニュー" [ref=e140] [cursor=pointer]
            - button "1段目の下に行を挿入" [ref=e146] [cursor=pointer]
          - generic [ref=e150]:
            - button "2段目の横のページをひらく" [ref=e151] [cursor=pointer]:
              - generic [ref=e152]:
                - generic [ref=e153]: "2.1"
                - generic "ここをドラッグで段ごと移動" [ref=e154]
              - generic [ref=e165]:
                - generic:
                  - generic: ちいさな発見 01
                  - generic: まちを歩いてみたら
                  - generic: いつもの通学路にも、 まだ知らないことがある。
            - textbox "2.1のフッター" [ref=e166]: まちを歩いてみたら
            - button "2段目のメニュー" [ref=e167] [cursor=pointer]
            - button "2段目の下に行を挿入" [ref=e173] [cursor=pointer]
        - generic [ref=e177]: 段ごと移動 ↕ · 重ねて入れ替え · 間に挿入
        - separator "サムネイルバーの幅" [ref=e178]
      - status [ref=e179]
      - generic [ref=e180]:
        - generic [ref=e181]:
          - generic "シート1・全体・5ページ" [ref=e182]:
            - generic [ref=e183]: シート1・全体
            - generic [ref=e184]: 5ページ
          - textbox "ページの名前" [ref=e185]: わたしたちのまち
          - generic [ref=e186]: 1.1 / 16:9
        - generic "編集中のスライド" [ref=e187]:
          - generic [ref=e190]:
            - generic "テキストボックス" [ref=e191]: OUR TOWN
            - generic "テキストボックス" [ref=e199]: わたしたちのまちの、 いいところ。
            - generic "テキストボックス" [ref=e207]: いつもの景色に、新しい発見。
            - generic "テキストボックス" [ref=e215]
            - generic [ref=e223]:
              - generic [ref=e225]:
                - img "スライドの画像"
              - button "要素の上の枠でサイズを変更"
              - button "要素の右上の枠でサイズを変更" [ref=e226]
              - button "要素の右の枠でサイズを変更"
              - button "要素のサイズを変更" [ref=e227]
              - button "要素の下の枠でサイズを変更"
              - button "要素の左下の枠でサイズを変更" [ref=e228]
              - button "要素の左の枠でサイズを変更"
              - button "要素の左上の枠でサイズを変更" [ref=e229]
        - generic [ref=e230]: 文字はタップで入力 · 選択枠の辺・四隅でサイズ変更 · Alt＋枠で移動
      - complementary [ref=e232]:
        - generic [ref=e234]:
          - generic [ref=e235]: 選択中
          - heading "画像" [level=2] [ref=e236]
        - generic [ref=e237]:
          - button "複製" [ref=e238] [cursor=pointer]
          - button "選んだものを削除" [ref=e242] [cursor=pointer]: 削除
        - tablist "編集設定" [ref=e246]:
          - tab "見た目" [selected] [ref=e247] [cursor=pointer]
          - tab "配置" [ref=e252] [cursor=pointer]
          - tab "リンク" [ref=e258] [cursor=pointer]
        - group [ref=e263]:
          - tabpanel "見た目" [ref=e264]:
            - region "画像の設定" [ref=e265]:
              - heading "画像" [level=3] [ref=e266]
              - generic [ref=e267]:
                - button "切り抜き・位置調整" [ref=e268] [cursor=pointer]
                - button "画像を差し替える" [ref=e269] [cursor=pointer]
              - generic [ref=e270]:
                - text: 画像の説明（代替テキスト）
                - textbox "画像の説明" [ref=e271]:
                  - /placeholder: 画像に何が写っているかを書きます
              - paragraph [ref=e272]: 説明は画像を読み上げるときに使います。切り抜きや差し替えでも、位置と大きさを保てます。
  - generic "シート一覧" [ref=e273]:
    - tablist "作品のシート" [ref=e274]:
      - tab "シート1" [selected] [ref=e276] [cursor=pointer]
    - button "空のシートを追加" [ref=e277] [cursor=pointer]
    - button "シートの操作" [ref=e279] [cursor=pointer]
  - status [ref=e284]
```

# Test source

```ts
  70  |   // Resize via pointer capture in the real browser.
  71  |   const selected = page.locator(".selected-element");
  72  |   const box = await selected.boundingBox();
  73  |   await page.mouse.move(box!.x + 10, box!.y + 10);
  74  |   await page.mouse.down();
  75  |   await page.mouse.move(box!.x + 50, box!.y + 30, { steps: 4 });
  76  |   await page.mouse.up();
  77  |   await page.getByRole("button", { name: "図形を追加", exact: true }).click();
  78  |   await page.getByRole("button", { name: "丸を追加", exact: true }).click();
  79  |   await expect(page.locator(".selected-element svg ellipse")).toHaveCount(1);
  80  |   await page.screenshot({
  81  |     path: testInfo.outputPath("editor.png"),
  82  |     fullPage: true,
  83  |   });
  84  |   await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  85  |   await page.reload();
  86  |   await expect(page.locator(".slide-card")).toHaveCount(7);
  87  |   const download = page.waitForEvent("download");
  88  |   await page.getByRole("button", { name: "ファイルに保存", exact: true }).click();
  89  |   const file = await download;
  90  |   const exported = JSON.parse(await fs.readFile((await file.path())!, "utf8"));
  91  |   expect(exported.slides).toHaveLength(7);
  92  |   expect(
  93  |     exported.slides[0].elements.some(
  94  |       (e: any) => e.text === "わたしたちの発見\n公園のひみつ",
  95  |     ),
  96  |   ).toBe(true);
  97  |   exported.title = "JSONから復元した作品";
  98  |   await page
  99  |     .locator("input[type=file]")
  100 |     .first()
  101 |     .setInputFiles({
  102 |       name: "story.json",
  103 |       mimeType: "application/json",
  104 |       buffer: Buffer.from(JSON.stringify(exported)),
  105 |     });
  106 |   await expect(
  107 |     page.getByRole("textbox", { name: "作品のタイトル" }),
  108 |   ).toHaveValue(exported.title);
  109 |   await page.getByRole("button", { name: "発表する", exact: true }).click();
  110 |   await expect(page.locator(".minimap-caption")).toHaveText("1.1 現在地");
  111 |   await page.getByRole("button", { name: "下のページ", exact: true }).click();
  112 |   await expect(page.locator(".minimap-caption")).toHaveText("2.1 現在地");
  113 |   await page.keyboard.press("ArrowUp");
  114 |   await page.keyboard.press("ArrowRight");
  115 |   await expect(page.locator(".minimap-caption")).toHaveText("1.2 現在地");
  116 |   await page.screenshot({ path: testInfo.outputPath("presentation.png") });
  117 |   await page.getByRole("button", { name: "発表をおわる", exact: true }).click();
  118 |   expect(errors).toEqual([]);
  119 | });
  120 | test("rejects invalid import without losing the current work", async ({
  121 |   page,
  122 | }) => {
  123 |   await page.goto("/");
  124 |   const title = await page
  125 |     .getByRole("textbox", { name: "作品のタイトル" })
  126 |     .inputValue();
  127 |   await page
  128 |     .locator("input[type=file]")
  129 |     .first()
  130 |     .setInputFiles({
  131 |       name: "invalid.json",
  132 |       mimeType: "application/json",
  133 |       buffer: Buffer.from('{"version":4,"slides":[]}'),
  134 |     });
  135 |   await expect(page.locator(".toast")).toContainText(
  136 |     "対応するVHSlideファイルではありません",
  137 |   );
  138 |   await expect(
  139 |     page.getByRole("textbox", { name: "作品のタイトル" }),
  140 |   ).toHaveValue(title);
  141 | });
  142 | 
  143 | test("embedded images survive upload, clipboard paste, drop and reload; resizing changes geometry", async ({
  144 |   page,
  145 | }) => {
  146 |   await page.goto("/");
  147 |   await page
  148 |     .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
  149 |     .click();
  150 |   const png =
  151 |     "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=";
  152 |   await page
  153 |     .locator("input[type=file]")
  154 |     .nth(1)
  155 |     .setInputFiles({
  156 |       name: "dot.png",
  157 |       mimeType: "image/png",
  158 |       buffer: Buffer.from(png, "base64"),
  159 |     });
  160 |   await expect(page.locator(".editor-workspace .slide-image")).toHaveCount(1);
  161 |   const handle = page.getByRole("button", { name: "要素のサイズを変更" });
  162 |   const box = await handle.boundingBox();
  163 |   await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  164 |   await page.mouse.down();
  165 |   await page.mouse.move(box!.x + 70, box!.y + 60, { steps: 6 });
  166 |   await page.mouse.up();
  167 |   let data = await page.evaluate(() =>
  168 |     JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  169 |   );
> 170 |   expect(data.slides[0].elements.at(-1).w).toBeGreaterThan(20);
      |                                            ^ Error: expect(received).toBeGreaterThan(expected)
  171 |   await page.locator(".editor-workspace").evaluate((node, base64) => {
  172 |     const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  173 |     const transfer = new DataTransfer();
  174 |     transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
  175 |     node.dispatchEvent(
  176 |       new ClipboardEvent("paste", {
  177 |         clipboardData: transfer,
  178 |         bubbles: true,
  179 |         cancelable: true,
  180 |       }),
  181 |     );
  182 |   }, png);
  183 |   await expect(page.locator(".editor-workspace .slide-image")).toHaveCount(2);
  184 |   await page.locator(".editor-workspace").evaluate((node, base64) => {
  185 |     const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  186 |     const transfer = new DataTransfer();
  187 |     transfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
  188 |     node.dispatchEvent(
  189 |       new DragEvent("drop", {
  190 |         dataTransfer: transfer,
  191 |         bubbles: true,
  192 |         cancelable: true,
  193 |       }),
  194 |     );
  195 |   }, png);
  196 |   await expect(page.locator(".editor-workspace .slide-image")).toHaveCount(3);
  197 |   await page.reload();
  198 |   await page
  199 |     .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
  200 |     .click();
  201 |   await expect(page.locator(".editor-workspace .slide-image")).toHaveCount(3);
  202 |   expect(
  203 |     await page
  204 |       .locator(".editor-workspace .slide-image")
  205 |       .evaluateAll((imgs) =>
  206 |         imgs.every((img) => (img as HTMLImageElement).naturalWidth > 0),
  207 |       ),
  208 |   ).toBe(true);
  209 | });
  210 | 
  211 | test("row and column moves preserve all pages; delete and new project are undoable", async ({
  212 |   page,
  213 | }) => {
  214 |   await page.goto("/");
  215 |   await page.getByRole("button", { name: "話題1を移動", exact: true }).click();
  216 |   await page
  217 |     .getByRole("button", { name: "自然がいっぱいを移動先にする", exact: true })
  218 |     .click();
  219 |   let data = await page.evaluate(() =>
  220 |     JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  221 |   );
  222 |   expect(
  223 |     data.slides.find((s: any) => s.title === "まちを歩いてみたら"),
  224 |   ).toMatchObject({ x: 1, y: 1 });
  225 |   await page
  226 |     .getByRole("button", { name: "高さ1のページをまとめて移動", exact: true })
  227 |     .click();
  228 |   await page
  229 |     .getByRole("button", {
  230 |       name: "お気に入りの公園を移動先にする",
  231 |       exact: true,
  232 |     })
  233 |     .click();
  234 |   data = await page.evaluate(() =>
  235 |     JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  236 |   );
  237 |   expect(
  238 |     data.slides.find((s: any) => s.title === "人とつながる"),
  239 |   ).toMatchObject({ x: 2, y: 1 });
  240 |   await page
  241 |     .getByRole("button", { name: "わたしたちのまちを削除", exact: true })
  242 |     .click();
  243 |   await expect(page.locator(".slide-card")).toHaveCount(4);
  244 |   await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  245 |   await expect(page.locator(".slide-card")).toHaveCount(5);
  246 |   await page.getByRole("button", { name: "作品", exact: true }).click();
  247 |   await page.getByRole("menuitem", { name: "新しく", exact: true }).click();
  248 |   await expect(page.locator(".slide-card")).toHaveCount(1);
  249 |   await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  250 |   await expect(page.locator(".slide-card")).toHaveCount(5);
  251 | });
  252 | 
  253 | test("native drag swaps grid cells", async ({ page }, testInfo) => {
  254 |   test.skip(testInfo.project.name === "touch", "タッチ端末は移動ボタンを使う");
  255 |   await page.goto("/");
  256 |   await page
  257 |     .locator(".slide-card")
  258 |     .nth(1)
  259 |     .dragTo(page.locator(".grid-cell").nth(2));
  260 |   const data = await page.evaluate(() =>
  261 |     JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  262 |   );
  263 |   expect(data.slides.find((s: any) => s.title === "自然がいっぱい").x).toBe(2);
  264 |   expect(data.slides.find((s: any) => s.title === "人とつながる").x).toBe(1);
  265 | });
  266 | 
  267 | test("touch taps and directional swipe navigate the story", async ({
  268 |   page,
  269 | }, testInfo) => {
  270 |   test.skip(testInfo.project.name !== "touch", "タッチ専用チェック");
```