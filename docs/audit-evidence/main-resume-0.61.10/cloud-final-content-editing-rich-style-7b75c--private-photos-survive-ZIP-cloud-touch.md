# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: content-editing.spec.ts >> rich styles and cell formats sync, own undo preserves peers; cropped private photos survive ZIP
- Location: tests/cloud/content-editing.spec.ts:6:1

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "\"bold\":true"
Received string:    "{\"1fd8451b-15bd-4e09-91b8-b05b2f11d67f:e9a592b6-b6c5-45d6-bfd4-94e82117341f\":{\"fill\":\"#aaddff\",\"bold\":false}}"

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - banner [ref=f1e4]:
    - link "VHSlide 全体マップ" [ref=f1e5] [cursor=pointer]:
      - /url: "#"
      - text: VH
      - generic: Slide
    - generic [ref=f1e13]:
      - textbox "作品のタイトル" [ref=f1e14]: 文章と表の共同制作
      - generic [ref=f1e15]:
        - status "クラウドに保存済み · 本文と付箋の保存状態です。端末へ書き出すJSONには付箋・共有設定・過去の版は含みません。" [ref=f1e16]:
          - generic [ref=f1e19]: クラウドに保存済み
        - generic [ref=f1e20]: ホスト
        - generic [ref=f1e21]: 1人が参加中
    - generic [ref=f1e22]:
      - generic [ref=f1e23]:
        - button "ファイル" [ref=f1e25] [cursor=pointer]
        - button "ファイルに保存" [ref=f1e31] [cursor=pointer]:
          - generic [ref=f1e35]: 保存
      - button "クラウド" [ref=f1e36] [cursor=pointer]
      - button "全員の画面を同期" [ref=f1e41] [cursor=pointer]: 全員を集合
      - button "ゲストの設定" [ref=f1e43] [cursor=pointer]
      - generic [ref=f1e46]:
        - button "発表する" [ref=f1e47] [cursor=pointer]
        - button "発表方法を選ぶ" [ref=f1e53] [cursor=pointer]
  - main [ref=f1e56]:
    - generic [ref=f1e57]:
      - button "全体マップへ" [ref=f1e58] [cursor=pointer]
      - button "文字" [ref=f1e61] [cursor=pointer]
      - button "画像" [ref=f1e64] [cursor=pointer]
      - button "手描き" [ref=f1e69] [cursor=pointer]
      - button "付箋を追加" [ref=f1e73] [cursor=pointer]: 付箋
      - button "表を追加" [ref=f1e78] [cursor=pointer]: 表
      - button "図形を追加" [ref=f1e81] [cursor=pointer]: 図形
      - button "線を追加" [ref=f1e86] [cursor=pointer]: 線
      - button "もっと見る（図解・グラフ）" [ref=f1e90] [cursor=pointer]: もっと見る
      - button "まとめて選択" [ref=f1e93] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e94]: ▧
        - text: まとめて選択
      - button "スピーカーノート" [ref=f1e95] [cursor=pointer]: ノート
      - group "編集画面の表示" [ref=f1e99]:
        - button "表示の設定" [ref=f1e100] [cursor=pointer]: 表示
      - generic [ref=f1e104]:
        - button "もとに戻す" [ref=f1e105] [cursor=pointer]
        - button "やり直す" [disabled] [ref=f1e109]
        - button "その他" [ref=f1e115] [cursor=pointer]
    - generic [ref=f1e121]:
      - complementary "縦横のページ一覧" [ref=f1e122]:
        - generic [ref=f1e123]:
          - generic [ref=f1e124]:
            - strong [ref=f1e125]: ページ一覧
            - button "サムネイルバーをたたむ" [expanded] [ref=f1e126] [cursor=pointer]
          - button "行番号一覧" [ref=f1e130] [cursor=pointer]
        - generic [ref=f1e135]:
          - button "1段目の横のページをひらく" [ref=f1e136] [cursor=pointer]:
            - generic [ref=f1e137]:
              - generic [ref=f1e138]: "1.1"
              - generic "ここをドラッグで段ごと移動" [ref=f1e139]
            - generic [ref=f1e150]:
              - generic:
                - generic: Hello World!
                - generic:
                  - generic:
                    - table "スライド内の表":
                      - rowgroup:
                        - row:
                          - columnheader
                          - columnheader
                        - row "生徒の入力":
                          - cell
                          - cell "生徒の入力"
          - textbox "1.1のフッター" [ref=f1e151]: content-student-cloud-touch
          - button "1段目のメニュー" [ref=f1e152] [cursor=pointer]
          - button "1段目の下に行を挿入" [ref=f1e158] [cursor=pointer]
        - generic [ref=f1e162]: 段ごと移動 ↕ · 重ねて入れ替え · 間に挿入
        - separator "サムネイルバーの幅" [ref=f1e163]
      - status [ref=f1e164]
      - generic [ref=f1e165]:
        - generic [ref=f1e166]:
          - generic "シート1・全体・1ページ" [ref=f1e167]:
            - generic [ref=f1e168]: シート1・全体
            - generic [ref=f1e169]: 1ページ
          - textbox "ページの名前" [ref=f1e170]: 文章と表
          - group "このスライドの共有者" [ref=f1e171]:
            - generic [ref=f1e177]: 共有：content-student-cloud-touch
          - generic [ref=f1e178]: 1.1 / 16:9
        - generic "編集中のスライド" [ref=f1e179]:
          - generic [ref=f1e180]:
            - generic [ref=f1e182]:
              - generic "テキストボックス" [ref=f1e183]: Hello World!
              - generic [ref=f1e192]:
                - table "スライド内の表" [ref=f1e194]:
                  - rowgroup [ref=f1e198]:
                    - row [ref=f1e199]:
                      - columnheader [ref=f1e200]:
                        - textbox "表 1行 1列" [ref=f1e202]
                      - columnheader [ref=f1e203]:
                        - textbox "表 1行 2列" [ref=f1e205]
                    - row [ref=f1e206]:
                      - cell [ref=f1e207]:
                        - textbox "表 2行 1列" [ref=f1e209]
                      - cell [ref=f1e210]:
                        - textbox "表 2行 2列" [ref=f1e212]: 生徒の入力
                - button "要素の上の枠でサイズを変更" [ref=f1e213]
                - button "要素の右上の枠でサイズを変更" [ref=f1e214]
                - button "要素の右の枠でサイズを変更" [ref=f1e215]
                - button "要素のサイズを変更" [ref=f1e216]
                - button "要素の下の枠でサイズを変更" [ref=f1e217]
                - button "要素の左下の枠でサイズを変更" [ref=f1e218]
                - button "要素の左の枠でサイズを変更" [ref=f1e219]
                - button "要素の左上の枠でサイズを変更" [ref=f1e220]
            - generic "このスライドの付箋"
        - generic [ref=f1e221]: 文字はタップで入力 · 選択枠の辺・四隅でサイズ変更 · Alt＋枠で移動
      - complementary [ref=f1e223]:
        - generic [ref=f1e224]:
          - generic [ref=f1e225]:
            - generic [ref=f1e226]: 選択中
            - heading "表" [level=2] [ref=f1e227]
          - generic [ref=f1e228]: 2行 × 2列
          - button "右のサイドバーをたたむ" [expanded] [ref=f1e229] [cursor=pointer]
        - generic [ref=f1e233]:
          - button "複製" [ref=f1e234] [cursor=pointer]
          - button "選んだものを削除" [ref=f1e238] [cursor=pointer]: 削除
        - tablist "編集設定" [ref=f1e242]:
          - tab "見た目" [selected] [ref=f1e243] [cursor=pointer]
          - tab "配置" [ref=f1e248] [cursor=pointer]
          - tab "リンク" [ref=f1e254] [cursor=pointer]
        - group [ref=f1e259]:
          - tabpanel "見た目" [ref=f1e260]:
            - region "表の編集範囲" [ref=f1e261]:
              - tablist "表の編集対象" [ref=f1e262]:
                - tab "セル" [selected] [ref=f1e263] [cursor=pointer]
                - tab "表全体" [ref=f1e264] [cursor=pointer]
              - tabpanel "セル" [ref=f1e265]:
                - region "選択したセルの設定" [ref=f1e266]:
                  - heading "1セルを選択中" [level=3] [ref=f1e267]
                  - button "セルの範囲を選ぶ" [ref=f1e268] [cursor=pointer]
                  - generic [ref=f1e269]:
                    - button "セルを太字" [ref=f1e270] [cursor=pointer]: B 太字
                    - button "セルを斜体" [ref=f1e271] [cursor=pointer]: I 斜体
                  - generic [ref=f1e272]:
                    - generic [ref=f1e273]:
                      - text: 背景色
                      - textbox "セルの背景色" [active] [ref=f1e274] [cursor=pointer]: "#aaddff"
                    - generic [ref=f1e275]:
                      - text: 文字色
                      - textbox "セルの文字色" [ref=f1e276] [cursor=pointer]: "#173d38"
                    - generic [ref=f1e277]:
                      - text: 大きさ
                      - spinbutton "セルの文字の大きさ" [ref=f1e278]: "24"
                    - generic [ref=f1e279]:
                      - text: 左右
                      - combobox "セルの左右揃え" [ref=f1e280]:
                        - option "左" [selected]
                        - option "中央"
                        - option "右"
                    - generic [ref=f1e281]:
                      - text: 上下
                      - combobox "セルの上下揃え" [ref=f1e282]:
                        - option "上" [selected]
                        - option "中央"
                        - option "下"
                  - button "セルの書式をリセット" [ref=f1e283] [cursor=pointer]
                  - group [ref=f1e284]:
                    - generic "選択位置の行・列を操作" [ref=f1e285] [cursor=pointer]
              - group [ref=f1e286]:
                - generic "表の操作ヒント" [ref=f1e287] [cursor=pointer]
  - generic "シート一覧" [ref=f1e290]:
    - tablist "作品のシート" [ref=f1e291]:
      - tab "シート1" [selected] [ref=f1e293] [cursor=pointer]
    - button "空のシートを追加" [ref=f1e294] [cursor=pointer]
    - button "シートの操作" [ref=f1e296] [cursor=pointer]
  - status [ref=f1e301]
```

# Test source

```ts
  58  |   const created = await page.request.post("/api/decks", {
  59  |     headers,
  60  |     data: { version: 1, title: "文章と表の共同制作", slides: [s] },
  61  |   });
  62  |   expect(created.status()).toBe(201);
  63  |   const { id } = await created.json();
  64  |   const ctx = await browser.newContext(info.project.use),
  65  |     other = await ctx.newPage();
  66  |   const words = (p: Page) =>
  67  |     p.locator('.editor-page-current .element[data-element-id="words"]');
  68  |   const cell = (p: Page, r: number, c: number) =>
  69  |     p.getByRole("textbox", { name: `表 ${r}行 ${c}列`, exact: true });
  70  |   async function serverBook() {
  71  |     const r = await page.request.get(`/api/decks/${id}/backup`);
  72  |     expect(r.status()).toBe(200);
  73  |     return (await r.json()).deck;
  74  |   }
  75  |   try {
  76  |     await login(other, `content-student-${info.project.name}`);
  77  |     expect(
  78  |       (
  79  |         await page.request.post(`/api/decks/${id}/recipients`, {
  80  |           headers,
  81  |           data: {
  82  |             recipients: [
  83  |               {
  84  |                 email: `content-student-${info.project.name}@example.test`,
  85  |                 access: {
  86  |                   mode: "all",
  87  |                   comment: true,
  88  |                   rows: [],
  89  |                   columns: [],
  90  |                   slides: [],
  91  |                 },
  92  |               },
  93  |             ],
  94  |           },
  95  |         })
  96  |       ).status(),
  97  |     ).toBe(200);
  98  |     for (const p of [page, other]) {
  99  |       await p.goto(`/?room=${id}`);
  100 |       await p
  101 |         .getByRole("button", { name: "文章と表を編集", exact: true })
  102 |         .click();
  103 |       await expect(p.locator(".workspace-flight")).toHaveCount(0);
  104 |     }
  105 |     // Two editors may activate the same legacy box at once without adding a blank line.
  106 |     await Promise.all([words(page).dblclick(), words(other).dblclick()]);
  107 |     await expect
  108 |       .poll(async () => (await serverBook()).slides[0].elements[0].text)
  109 |       .toBe("Hello World");
  110 |     const input = words(page).getByRole("textbox");
  111 |     await input.evaluate((n) => {
  112 |       const t = n.querySelector("p")!.firstChild!;
  113 |       const r = document.createRange();
  114 |       r.setStart(t, 0);
  115 |       r.setEnd(t, 5);
  116 |       const sel = getSelection()!;
  117 |       sel.removeAllRanges();
  118 |       sel.addRange(r);
  119 |       document.dispatchEvent(new Event("selectionchange"));
  120 |     });
  121 |     await page
  122 |       .getByRole("button", { name: "選択文字を下線", exact: true })
  123 |       .click();
  124 |     const guestInput = words(other).getByRole("textbox");
  125 |     await guestInput.press("ControlOrMeta+End");
  126 |     await guestInput.pressSequentially("!");
  127 |     await guestInput.press("Escape");
  128 |     await expect
  129 |       .poll(async () =>
  130 |         JSON.stringify((await serverBook()).slides[0].elements[0].richText),
  131 |       )
  132 |       .toContain('"underline":true');
  133 |     await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  134 |     await expect
  135 |       .poll(async () => (await serverBook()).slides[0].elements[0].text)
  136 |       .toBe("Hello World!");
  137 |     await expect
  138 |       .poll(async () =>
  139 |         JSON.stringify((await serverBook()).slides[0].elements[0].richText),
  140 |       )
  141 |       .not.toContain('"underline":true');
  142 |     await Promise.all([cell(page, 1, 1).click(), cell(other, 1, 1).click()]);
  143 |     await Promise.all([
  144 |       page.getByLabel("セルの背景色", { exact: true }).fill("#aaddff"),
  145 |       other.getByRole("button", { name: "セルを太字", exact: true }).click(),
  146 |     ]);
  147 |     await cell(other, 2, 2).fill("生徒の入力");
  148 |     await expect(cell(page, 2, 2)).toHaveValue("生徒の入力");
  149 |     await expect
  150 |       .poll(async () =>
  151 |         JSON.stringify((await serverBook()).slides[0].elements[1].table.styles),
  152 |       )
  153 |       .toContain("#aaddff");
  154 |     await expect
  155 |       .poll(async () =>
  156 |         JSON.stringify((await serverBook()).slides[0].elements[1].table.styles),
  157 |       )
> 158 |       .toContain('"bold":true');
      |        ^ Error: expect(received).toContain(expected) // indexOf
  159 |     const png =
  160 |       "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=";
  161 |     await page
  162 |       .locator("input[type=file]")
  163 |       .nth(1)
  164 |       .setInputFiles({
  165 |         name: "private.png",
  166 |         mimeType: "image/png",
  167 |         buffer: Buffer.from(png, "base64"),
  168 |       });
  169 |     await expect(page.locator(".editor-page-current .slide-image")).toHaveCount(
  170 |       1,
  171 |     );
  172 |     await page
  173 |       .getByRole("textbox", { name: "画像の説明", exact: true })
  174 |       .fill("共同制作の写真");
  175 |     await page
  176 |       .getByRole("button", { name: "切り抜き・位置調整", exact: true })
  177 |       .click();
  178 |     await page
  179 |       .getByRole("slider", { name: "画像の拡大率", exact: true })
  180 |       .fill("2");
  181 |     await page
  182 |       .getByRole("button", { name: "切り抜きを適用", exact: true })
  183 |       .click();
  184 |     await expect(
  185 |       other.locator(".editor-page-current img.slide-image"),
  186 |     ).toHaveAttribute("alt", "共同制作の写真");
  187 |     await page.getByRole("button", { name: "クラウド", exact: true }).click();
  188 |     await page.getByRole("tab", { name: /作品一覧/ }).click();
  189 |     const download = page.waitForEvent("download");
  190 |     if (
  191 |       !(await page
  192 |         .getByRole("button", { name: "完全バックアップを保存", exact: true })
  193 |         .isVisible())
  194 |     ) {
  195 |       await page
  196 |         .getByRole("button", { name: "作品一覧のその他", exact: true })
  197 |         .click();
  198 |       await page
  199 |         .getByRole("menuitem", { name: "バックアップと復元", exact: true })
  200 |         .click();
  201 |     }
  202 |     await page
  203 |       .getByRole("button", { name: "完全バックアップを保存", exact: true })
  204 |       .click();
  205 |     const file = await download,
  206 |       path = await file.path();
  207 |     const loaded = await readBackupArchive(
  208 |       new Uint8Array(await readFile(path!)),
  209 |     );
  210 |     expect(loaded.images.size).toBe(1);
  211 |     const es = loaded.snapshot.deck.slides[0].elements;
  212 |     expect(es[0].text).toBe("Hello World!");
  213 |     expect(es[0].richText).toBeDefined();
  214 |     expect(es[2].crop!.w).toBe(0.5);
  215 |     expect(es[2].altText).toBe("共同制作の写真");
  216 |     await page
  217 |       .getByLabel("復元するバックアップ", { exact: true })
  218 |       .setInputFiles(path!);
  219 |     await page
  220 |       .getByRole("button", { name: "新しい作品に復元する", exact: true })
  221 |       .click();
  222 |     await expect
  223 |       .poll(() => {
  224 |         const restored = new URL(page.url()).searchParams.get("room");
  225 |         return restored && restored !== id ? restored : "";
  226 |       })
  227 |       .toMatch(/^[a-f0-9-]{36}$/);
  228 |     const target = new URL(page.url()).searchParams.get("room")!;
  229 |     const restored = await (
  230 |       await page.request.get(`/api/decks/${target}/backup`)
  231 |     ).json();
  232 |     expect(restored.deck.slides[0].elements[0].richText).toEqual(
  233 |       es[0].richText,
  234 |     );
  235 |     expect(restored.deck.slides[0].elements[1].table.styles).toEqual(
  236 |       es[1].table!.styles,
  237 |     );
  238 |     expect(restored.deck.slides[0].elements[2].crop).toEqual(es[2].crop);
  239 |     expect(restored.deck.slides[0].elements[2].src).not.toBe(es[2].src);
  240 |     expect(restored.sharing).toHaveLength(0);
  241 |     expect((await other.request.get(`/api/decks/${target}`)).status()).toBe(
  242 |       404,
  243 |     );
  244 |   } finally {
  245 |     await ctx.close();
  246 |   }
  247 | });
  248 |
```
