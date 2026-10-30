# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor-interactions.spec.ts >> a single page can be dropped into a new last row
- Location: tests/e2e/editor-interactions.spec.ts:264:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: locator('.canvas-title > span')
Expected: "3.2 / 16:9"
Error: strict mode violation: locator('.canvas-title > span') resolved to 3 elements:
    1) <span title="シート1・全体・5ページ" aria-label="シート1・全体・5ページ" class="page-scope-summary">…</span> aka getByRole('main').getByLabel('シート1・全体・5ページ')
    2) <span role="status" class="object-selection-status"></span> aka locator('.object-selection-status')
    3) <span class="canvas-page-position">3.2 / 16:9</span> aka getByText('/ 16:9')

Call log:
  - Expect "toHaveText" locator('.canvas-title > span') with timeout 5000ms
  - waiting for locator('.canvas-title > span')

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
          - generic [ref=e177]:
            - button "3段目の横のページをひらく" [ref=e178] [cursor=pointer]:
              - generic [ref=e179]:
                - generic [ref=e180]: "3.2"
                - generic "ここをドラッグで段ごと移動" [ref=e181]
              - generic [ref=e192]:
                - generic:
                  - generic: 01 / NATURE
                  - generic: 自然がいっぱい。
                  - generic: 緑の道を、歩いてみよう。
            - textbox "3.2のフッター" [ref=e193]: 自然がいっぱい
            - button "3段目のメニュー" [ref=e194] [cursor=pointer]
            - button "3段目の下に行を挿入" [ref=e200] [cursor=pointer]
        - generic [ref=e204]: 段ごと移動 ↕ · 重ねて入れ替え · 間に挿入
        - separator "サムネイルバーの幅" [ref=e205]
      - status [ref=e206]: Draggable item page-d8c85f8f-4c0b-424b-9baa-9852f8105387 was dropped over droppable area new-row-target
      - generic [ref=e207]:
        - generic [ref=e208]:
          - generic "シート1・全体・5ページ" [ref=e209]:
            - generic [ref=e210]: シート1・全体
            - generic [ref=e211]: 5ページ
          - textbox "ページの名前" [ref=e212]: 自然がいっぱい
          - generic [ref=e213]: 3.2 / 16:9
        - generic "編集中のスライド" [ref=e214]:
          - generic [ref=e217]:
            - generic "テキストボックス" [ref=e218]: 01 / NATURE
            - generic "テキストボックス" [ref=e226]: 自然がいっぱい。
            - generic "テキストボックス" [ref=e234]: 緑の道を、歩いてみよう。
        - generic [ref=e242]: ページ移動：どこでも1本指でスワイプ · タッチパッドは2本指
      - complementary [ref=e244]:
        - generic [ref=e246]:
          - generic [ref=e247]: ページ設定
          - heading "ページのデザイン" [level=2] [ref=e248]
        - group [ref=e250]:
          - generic [ref=e251]:
            - generic [ref=e252]:
              - text: 背景の色
              - textbox "背景の色" [ref=e253] [cursor=pointer]: "#e7efea"
            - generic [ref=e254]:
              - button "背景を#ffffffに変更" [ref=e255] [cursor=pointer]
              - button "背景を#e5f0dcに変更" [ref=e256] [cursor=pointer]
              - button "背景を#e7efeaに変更" [ref=e257] [cursor=pointer]
              - button "背景を#f8eddcに変更" [ref=e258] [cursor=pointer]
              - button "背景を#f4e5e4に変更" [ref=e259] [cursor=pointer]
              - button "背景を#e4eaf6に変更" [ref=e260] [cursor=pointer]
              - button "背景を#173d38に変更" [ref=e261] [cursor=pointer]
              - button "背景を#d6bc94に変更" [ref=e262] [cursor=pointer]
            - paragraph [ref=e263]: キャンバスの中の文字や図形をタップすると、色や大きさを変えられます。
  - generic "シート一覧" [ref=e264]:
    - tablist "作品のシート" [ref=e265]:
      - tab "シート1" [selected] [ref=e267] [cursor=pointer]
    - button "空のシートを追加" [ref=e268] [cursor=pointer]
    - button "シートの操作" [ref=e270] [cursor=pointer]
  - status [ref=e275]
```

# Test source

```ts
  180 |   await page.mouse.up();
  181 |   expect(await data(page)).toEqual(before);
  182 |   await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  183 |   await dragStart(
  184 |     page,
  185 |     page.getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true }),
  186 |   );
  187 |   await dragTo(page, page.locator('[data-drop-row="1"] .rail-trigger'));
  188 |   await page.mouse.up();
  189 |   const moved = await data(page);
  190 |   expect(
  191 |     moved.slides.find((s: any) => s.title === "自然がいっぱい"),
  192 |   ).toMatchObject({ x: 0, y: 1 });
  193 |   expect(
  194 |     moved.slides.find((s: any) => s.title === "まちを歩いてみたら"),
  195 |   ).toMatchObject({ x: 1, y: 0 });
  196 |   expect(moved.slides).toHaveLength(5);
  197 | });
  198 | 
  199 | test("touch long-press moves a whole row without changing the sidebar width", async ({
  200 |   page,
  201 | }, info) => {
  202 |   test.skip(info.project.name !== "touch", "実タッチ用のチェック");
  203 |   await editor(page);
  204 |   const before = await data(page),
  205 |     width = (await page.locator(".two-d-rail").boundingBox())!.width;
  206 |   const source = (await page.locator(".rail-trigger").nth(0).boundingBox())!,
  207 |     target = (await page.locator(".rail-trigger").nth(1).boundingBox())!;
  208 |   const cdp = await page.context().newCDPSession(page);
  209 |   const start = {
  210 |     x: Math.round(source.x + source.width / 2),
  211 |     y: Math.round(source.y + source.height / 2),
  212 |   };
  213 |   const end = {
  214 |     x: Math.round(target.x + target.width / 2),
  215 |     y: Math.round(target.y + target.height / 2),
  216 |   };
  217 |   await cdp.send("Input.dispatchTouchEvent", {
  218 |     type: "touchStart",
  219 |     touchPoints: [{ ...start, id: 1 }],
  220 |   });
  221 |   await expect(page.locator(".rail-drag-preview")).toBeVisible();
  222 |   for (let i = 1; i <= 10; i++)
  223 |     await cdp.send("Input.dispatchTouchEvent", {
  224 |       type: "touchMove",
  225 |       touchPoints: [
  226 |         {
  227 |           x: start.x + ((end.x - start.x) * i) / 10,
  228 |           y: start.y + ((end.y - start.y) * i) / 10,
  229 |           id: 1,
  230 |         },
  231 |       ],
  232 |     });
  233 |   await cdp.send("Input.dispatchTouchEvent", {
  234 |     type: "touchEnd",
  235 |     touchPoints: [],
  236 |   });
  237 |   expect(
  238 |     (await data(page)).slides.find((s: any) => s.id === before.slides[0].id).y,
  239 |   ).toBe(1);
  240 |   expect((await page.locator(".two-d-rail").boundingBox())!.width).toBe(width);
  241 | });
  242 | 
  243 | test("arrow navigation continues after the clicked thumbnail flyout closes", async ({
  244 |   page,
  245 | }, info) => {
  246 |   test.skip(info.project.name !== "desktop", "マウスで一覧を離れる操作");
  247 |   await editor(page);
  248 |   await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  249 |   await page
  250 |     .getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true })
  251 |     .click();
  252 |   await page.mouse.move(1100, 800);
  253 |   await expect(page.locator(".row-flyout")).toBeHidden();
  254 |   await page.keyboard.press("ArrowRight");
  255 |   await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
  256 |     "人とつながる",
  257 |   );
  258 |   await page.keyboard.press("ArrowDown");
  259 |   await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
  260 |     "まちを歩いてみたら",
  261 |   );
  262 | });
  263 | 
  264 | test("a single page can be dropped into a new last row", async ({ page }) => {
  265 |   await editor(page);
  266 |   await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  267 |   await dragStart(
  268 |     page,
  269 |     page.getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true }),
  270 |   );
  271 |   await dragTo(page, page.locator(".rail-new-row-drop"));
  272 |   await page.mouse.up();
  273 |   expect(
  274 |     (await data(page)).slides.find((s: any) => s.title === "自然がいっぱい"),
  275 |   ).toMatchObject({ x: 1, y: 2 });
  276 |   await expect(page.locator(".rail-trigger")).toHaveCount(3);
  277 |   await expect(
  278 |     page.locator(".rail-trigger.rail-active .rail-coordinate"),
  279 |   ).toHaveText("3.2");
> 280 |   await expect(page.locator(".canvas-title > span")).toHaveText("3.2 / 16:9");
      |                                                      ^ Error: expect(locator).toHaveText(expected) failed
  281 | });
  282 | 
  283 | test("Japanese composition remains in the canvas textbox across live updates", async ({
  284 |   page,
  285 | }) => {
  286 |   await editor(page);
  287 |   await page.getByRole("button", { name: "文字", exact: true }).click();
  288 |   const input = page.getByRole("textbox", {
  289 |     name: "スライド内の文字",
  290 |     exact: true,
  291 |   });
  292 |   const cdp = await page.context().newCDPSession(page);
  293 |   await cdp.send("Input.imeSetComposition", {
  294 |     text: "にほん",
  295 |     selectionStart: 3,
  296 |     selectionEnd: 3,
  297 |   });
  298 |   await expect(input).toBeFocused();
  299 |   await cdp.send("Input.insertText", { text: "日本" });
  300 |   await expect(input).toHaveText("日本");
  301 |   expect((await data(page)).slides[0].elements.at(-1).text).toBe("日本");
  302 |   await page.keyboard.press("ArrowLeft");
  303 |   await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
  304 |     "わたしたちのまち",
  305 |   );
  306 | });
  307 | 
  308 | test("touch drags an individual page across an unfolding row", async ({
  309 |   page,
  310 | }, info) => {
  311 |   test.skip(info.project.name !== "touch", "実タッチで展開中の移動を確認");
  312 |   await editor(page);
  313 |   await page.getByRole("button", { name: "1段目の横のページをひらく" }).tap();
  314 |   const source = (await page
  315 |     .getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true })
  316 |     .boundingBox())!;
  317 |   const cdp = await page.context().newCDPSession(page);
  318 |   let current = {
  319 |     x: Math.round(source.x + source.width / 2),
  320 |     y: Math.round(source.y + source.height / 2),
  321 |   };
  322 |   await cdp.send("Input.dispatchTouchEvent", {
  323 |     type: "touchStart",
  324 |     touchPoints: [{ ...current, id: 1 }],
  325 |   });
  326 |   await expect(page.locator(".rail-drag-preview")).toBeVisible();
  327 |   async function moveTo(node: Locator) {
  328 |     const b = (await node.boundingBox())!;
  329 |     const next = {
  330 |       x: Math.round(b.x + b.width / 2),
  331 |       y: Math.round(b.y + b.height / 2),
  332 |     };
  333 |     for (let i = 1; i <= 10; i++)
  334 |       await cdp.send("Input.dispatchTouchEvent", {
  335 |         type: "touchMove",
  336 |         touchPoints: [
  337 |           {
  338 |             x: current.x + ((next.x - current.x) * i) / 10,
  339 |             y: current.y + ((next.y - current.y) * i) / 10,
  340 |             id: 1,
  341 |           },
  342 |         ],
  343 |       });
  344 |     current = next;
  345 |   }
  346 |   await moveTo(page.locator('[data-drop-row="1"] .rail-trigger'));
  347 |   await expect(
  348 |     page.getByRole("region", { name: "2段目の横のページ一覧" }),
  349 |   ).toBeVisible();
  350 |   await moveTo(page.locator('[data-drop-cell="2,1"] .row-page'));
  351 |   await cdp.send("Input.dispatchTouchEvent", {
  352 |     type: "touchEnd",
  353 |     touchPoints: [],
  354 |   });
  355 |   expect(
  356 |     (await data(page)).slides.find((s: any) => s.title === "自然がいっぱい"),
  357 |   ).toMatchObject({ x: 2, y: 1 });
  358 | });
  359 | 
```