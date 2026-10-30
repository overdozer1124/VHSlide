# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tables.spec.ts >> creates and directly edits a table, preserves layout, undo, resize, JSON and presentation
- Location: tests/e2e/tables.spec.ts:4:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.present-mode .slide-table')
Expected substring: "比較する観点"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" locator('.present-mode .slide-table') with timeout 5000ms
  - waiting for locator('.present-mode .slide-table')

```

```yaml
- banner:
  - link "VHSlide 全体マップ":
    - /url: "#"
    - img
    - text: VH Slide
  - textbox "作品のタイトル": 表を読み込み
  - status "この端末に保存済み · このブラウザの一時保存です。授業の終わりにファイルへ書き出してください。": この端末に保存済み
  - button "作品"
  - button "ファイルに保存":
    - img
    - text: ファイルに保存
  - button "保存方法を選ぶ":
    - img
  - button "発表する":
    - img
    - text: 発表する
  - button "発表方法を選ぶ":
    - img
- navigation:
  - button "全体マップ":
    - img
    - text: 全体マップ
  - button "ページを編集":
    - img
    - text: ページを編集
  - button "もとに戻す":
    - img
  - button "やり直す" [disabled]:
    - img
  - button "その他"
- main:
  - region "ページの全体マップ":
    - heading "全体マップ" [level=1]:
      - img
      - text: 全体マップ
    - text: シート1・全体 5ページ
    - button "マップをフィルタ":
      - img
      - text: フィルタ
    - button "スライドを複数選択": 選択
    - button "マップのその他": その他
    - textbox "ページ番号で探す":
      - /placeholder: "3.2"
    - button "番号のページを探す":
      - img
    - group "マップの表示サイズ":
      - button "マップを縮小":
        - img
      - button "表示サイズを100%に戻す": 100%
      - button "マップを拡大" [disabled]:
        - img
    - button "マップの表示設定":
      - img
      - text: 表示
    - region "スライドのマップ":
      - text: 次の話題へ
      - img
      - text: "01"
      - textbox "列1の見出し":
        - /placeholder: 列の名前
        - text: はじまり
      - button "話題1を移動":
        - img
      - text: "02"
      - textbox "列2の見出し":
        - /placeholder: 列の名前
        - text: 話題 2
      - button "話題2を移動":
        - img
      - text: "03"
      - textbox "列3の見出し":
        - /placeholder: 列の名前
        - text: 話題 3
      - button "話題3を移動":
        - img
      - button "高さ1のページをまとめて移動": "01"
      - textbox "行1の見出し":
        - /placeholder: 見出し
      - button "わたしたちのまちを編集":
        - text: OUR TOWN わたしたちのまちの、 いいところ。 いつもの景色に、新しい発見。
        - table "スライド内の表":
          - rowgroup:
            - row "比較する観点":
              - columnheader "比較する観点"
              - columnheader
              - columnheader
              - columnheader
            - row "日本語 2行目":
              - cell "日本語 2行目"
              - cell
              - cell
              - cell
            - row "<img src=x onerror=alert(1)>長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文":
              - cell
              - cell
              - cell
              - cell "<img src=x onerror=alert(1)>長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文長い文"
        - text: 発表の先頭
      - text: "1.1"
      - textbox "1.1のフッター": わたしたちのまち
      - button "わたしたちのまちのページメニュー":
        - img
      - button "わたしたちのまちを移動":
        - img
      - button "わたしたちのまちを削除":
        - img
      - button "わたしたちのまちの右に次の話題を追加":
        - img
      - button "わたしたちのまちの下に詳しいページを追加":
        - img
      - button "自然がいっぱいを編集": 01 / NATURE 自然がいっぱい。 緑の道を、歩いてみよう。
      - text: "1.2"
      - textbox "1.2のフッター": 自然がいっぱい
      - button "自然がいっぱいのページメニュー":
        - img
      - button "自然がいっぱいを移動":
        - img
      - button "自然がいっぱいを削除":
        - img
      - button "自然がいっぱいの右に次の話題を追加":
        - img
      - button "自然がいっぱいの下に詳しいページを追加":
        - img
      - button "人とつながるを編集": 02 / PEOPLE 人と、つながる。 「こんにちは」から、はじまる。
      - text: "1.3"
      - textbox "1.3のフッター": 人とつながる
      - button "人とつながるのページメニュー":
        - img
      - button "人とつながるを移動":
        - img
      - button "人とつながるを削除":
        - img
      - button "人とつながるの右に次の話題を追加":
        - img
      - button "人とつながるの下に詳しいページを追加":
        - img
      - button "高さ2のページをまとめて移動": "02"
      - textbox "行2の見出し":
        - /placeholder: 見出し
      - button "まちを歩いてみたらを編集": ちいさな発見 01 まちを歩いてみたら いつもの通学路にも、 まだ知らないことがある。
      - text: "2.1"
      - textbox "2.1のフッター": まちを歩いてみたら
      - button "まちを歩いてみたらのページメニュー":
        - img
      - button "まちを歩いてみたらを移動":
        - img
      - button "まちを歩いてみたらを削除":
        - img
      - button "まちを歩いてみたらの右に次の話題を追加":
        - img
      - button "まちを歩いてみたらの下に詳しいページを追加":
        - img
      - button "お気に入りの公園を編集": ちいさな発見 02 お気に入りの公園 季節が変わると、 どんな発見があるかな？
      - text: "2.2"
      - textbox "2.2のフッター": お気に入りの公園
      - button "お気に入りの公園のページメニュー":
        - img
      - button "お気に入りの公園を移動":
        - img
      - button "お気に入りの公園を削除":
        - img
      - button "お気に入りの公園の右に次の話題を追加":
        - img
      - button "お気に入りの公園の下に詳しいページを追加":
        - img
      - button "2.3にページを追加":
        - img
        - text: ページを追加
    - text: ↔ よこは「次の話題」 / ↕ たては「くわしい説明」 長押し・つまみで移動 · ピンチで拡大・縮小
- tablist "作品のシート":
  - tab "シート1" [selected]
- button "空のシートを追加":
  - img
- button "シートの操作":
  - img
- status
- status:
  - text: ファイルを開きました。前の作品へは「もとに戻す」で戻れます。
  - button "通知を閉じる":
    - img
- dialog "表示チェック":
  - banner:
    - heading "表示チェック" [level=2]
    - button "取り消す"
  - status: 1ページに、表示の見切れ・省略があります。元の内容は変更していません。
  - list:
    - listitem:
      - text: わたしたちのまち · 3行4列：全文が表示されません。
      - button "内容を確認・修正"
  - paragraph: 文字を小さくする・要素を大きくする・名称を整理する方法があります。自動では変更しません。
  - button "このまま進む"
  - button "再確認"
```

# Test source

```ts
  9   |     .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
  10  |     .click();
  11  |   await page.getByRole("button", { name: "表を追加", exact: true }).click();
  12  |   await page
  13  |     .getByRole("spinbutton", { name: "表の行数", exact: true })
  14  |     .fill("2");
  15  |   await page
  16  |     .getByRole("spinbutton", { name: "表の列数", exact: true })
  17  |     .fill("3");
  18  |   await page
  19  |     .getByRole("button", { name: "この大きさで表を追加", exact: true })
  20  |     .click();
  21  |   const cell = page.getByRole("textbox", { name: "表 1行 1列", exact: true });
  22  |   if (info.project.name === "touch") await cell.tap();
  23  |   else await cell.click();
  24  |   await cell.fill("比較する観点");
  25  |   await cell.press("Tab");
  26  |   await expect(
  27  |     page.getByRole("textbox", { name: "表 1行 2列", exact: true }),
  28  |   ).toBeFocused();
  29  |   await page
  30  |     .getByRole("textbox", { name: "表 2行 1列", exact: true })
  31  |     .fill("日本語\n2行目");
  32  |   await page.getByRole("tab", { name: "表全体", exact: true }).click();
  33  |   await page.getByRole("button", { name: "行を追加", exact: true }).click();
  34  |   await expect(
  35  |     page.getByRole("textbox", { name: "表 3行 1列", exact: true }),
  36  |   ).toBeVisible();
  37  |   await page.getByRole("button", { name: "列を追加", exact: true }).click();
  38  |   await expect(
  39  |     page.getByRole("textbox", { name: "表 3行 4列", exact: true }),
  40  |   ).toBeVisible();
  41  |   await page
  42  |     .getByLabel("表の文字の位置", { exact: true })
  43  |     .selectOption("center");
  44  |   await page
  45  |     .getByRole("spinbutton", { name: "表の文字の大きさ", exact: true })
  46  |     .fill("28");
  47  |   await page.getByRole("tab", { name: "表全体", exact: true }).click();
  48  |   await page.getByText("行・列を削除", { exact: true }).click();
  49  |   await page
  50  |     .getByRole("button", { name: "最後の行を削除", exact: true })
  51  |     .click();
  52  |   await expect(
  53  |     page.getByRole("textbox", { name: "表 3行 1列", exact: true }),
  54  |   ).toHaveCount(0);
  55  |   await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  56  |   await expect(
  57  |     page.getByRole("textbox", { name: "表 3行 1列", exact: true }),
  58  |   ).toHaveCount(1);
  59  |   await expect(cell).toHaveValue("比較する観点");
  60  |   await page
  61  |     .getByRole("textbox", { name: "表 3行 4列", exact: true })
  62  |     .fill("<img src=x onerror=alert(1)>" + "長い文".repeat(200));
  63  |   page.once("dialog", (dialog) => dialog.dismiss());
  64  |   await page.getByRole("tab", { name: "表全体", exact: true }).click();
  65  |   await page.getByText("行・列を削除", { exact: true }).click();
  66  |   await page
  67  |     .getByRole("button", { name: "最後の行を削除", exact: true })
  68  |     .click();
  69  |   await expect(
  70  |     page.getByRole("textbox", { name: "表 3行 4列", exact: true }),
  71  |   ).toHaveValue(/長い文/);
  72  |   const table = page.locator(".editor-workspace .slide-table"),
  73  |     element = page.locator(".editor-workspace .selected-element");
  74  |   const bounds = await table.boundingBox(),
  75  |     outer = await element.boundingBox();
  76  |   expect(bounds!.height).toBeLessThanOrEqual(outer!.height + 2);
  77  |   const box = await page
  78  |     .getByRole("button", { name: "要素のサイズを変更", exact: true })
  79  |     .boundingBox();
  80  |   await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  81  |   await page.mouse.down();
  82  |   await page.mouse.move(
  83  |     box!.x + box!.width / 2 + 30,
  84  |     box!.y + box!.height / 2 + 20,
  85  |   );
  86  |   await page.mouse.up();
  87  |   const saved = await data(page);
  88  |   expect(
  89  |     saved.slides[0].elements.find((e: any) => e.type === "table").w,
  90  |   ).toBeGreaterThan(760);
  91  |   await page.screenshot({ path: info.outputPath("table-editor.png") });
  92  |   await page.reload();
  93  |   await page
  94  |     .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
  95  |     .click();
  96  |   await expect(cell).toHaveValue("比較する観点");
  97  |   const imported = await data(page);
  98  |   imported.title = "表を読み込み";
  99  |   await page
  100 |     .locator("input[type=file]")
  101 |     .first()
  102 |     .setInputFiles({
  103 |       name: "table.json",
  104 |       mimeType: "application/json",
  105 |       buffer: Buffer.from(JSON.stringify(imported)),
  106 |     });
  107 |   await expect(page.locator(".deck-title")).toHaveValue("表を読み込み");
  108 |   await page.getByRole("button", { name: "発表する", exact: true }).click();
> 109 |   await expect(page.locator(".present-mode .slide-table")).toContainText(
      |                                                            ^ Error: expect(locator).toContainText(expected) failed
  110 |     "比較する観点",
  111 |   );
  112 |   await expect(page.locator(".present-mode textarea")).toHaveCount(0);
  113 |   await expect(page.locator(".present-mode .slide-table img")).toHaveCount(0);
  114 |   const shown = await page.locator(".present-mode .slide-table").boundingBox();
  115 |   const frame = await page
  116 |     .locator(".present-mode .slide-table")
  117 |     .locator("..")
  118 |     .boundingBox();
  119 |   expect(shown!.height).toBeLessThanOrEqual(frame!.height + 2);
  120 |   await page.mouse.move(100, 10);
  121 |   await page.getByRole("button", { name: "発表をおわる", exact: true }).click();
  122 |   await page
  123 |     .getByRole("button", { name: "保存方法を選ぶ", exact: true })
  124 |     .click();
  125 |   await page.getByRole("menuitem", { name: /^PDFで保存/ }).click();
  126 |   await page
  127 |     .getByRole("button", { name: "対象をすべて選ぶ", exact: true })
  128 |     .click();
  129 |   await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  130 |   await expect(
  131 |     page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  132 |   ).toBeEnabled();
  133 |   await expect(page.locator(".print-export .slide-table")).toContainText(
  134 |     "比較する観点",
  135 |   );
  136 |   await page.emulateMedia({ media: "print" });
  137 |   const pdf = await page.pdf({
  138 |     path: info.outputPath("table-print.pdf"),
  139 |     printBackground: true,
  140 |   });
  141 |   expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  142 | });
  143 | 
  144 | for (const viewport of [
  145 |   { width: 1366, height: 768 },
  146 |   { width: 1024, height: 768 },
  147 |   { width: 390, height: 844 },
  148 | ]) {
  149 |   test(`table insertion is physically clickable without scrolling the toolbar at ${viewport.width}x${viewport.height}`, async ({
  150 |     page,
  151 |   }, info) => {
  152 |     await page.setViewportSize(viewport);
  153 |     await page.goto("/");
  154 |     await page
  155 |       .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
  156 |       .click();
  157 |     const trigger = page.getByRole("button", { name: "表を追加", exact: true });
  158 |     if (info.project.name === "touch") await trigger.tap();
  159 |     else await trigger.click();
  160 |     const panel = page.getByRole("dialog", {
  161 |       name: "追加する表の大きさ",
  162 |       exact: true,
  163 |     });
  164 |     // Hit testing catches clipping that Playwright's automatic scrollIntoView can conceal.
  165 |     const add = page.getByRole("button", {
  166 |       name: "この大きさで表を追加",
  167 |       exact: true,
  168 |     });
  169 |     await expect
  170 |       .poll(() =>
  171 |         add.evaluate((node) => {
  172 |           const r = node.getBoundingClientRect(),
  173 |             hit = document.elementFromPoint(
  174 |               r.x + r.width / 2,
  175 |               r.y + r.height / 2,
  176 |             );
  177 |           return !!hit && (node === hit || node.contains(hit));
  178 |         }),
  179 |       )
  180 |       .toBe(true);
  181 |     await page.screenshot({
  182 |       path: info.outputPath(`table-insert-${viewport.width}.png`),
  183 |     });
  184 |     const box = (await add.boundingBox())!;
  185 |     if (info.project.name === "touch")
  186 |       await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  187 |     else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  188 |     await expect(
  189 |       page.getByRole("textbox", { name: "表 1行 1列", exact: true }),
  190 |     ).toBeVisible();
  191 |     await expect(panel).toHaveCount(0);
  192 |     await trigger.click();
  193 |     await page.keyboard.press("Escape");
  194 |     await expect(trigger).toBeFocused();
  195 |     await expect(panel).toHaveCount(0);
  196 |     await trigger.click();
  197 |     await page.setViewportSize({ width: 600, height: 500 });
  198 |     await expect
  199 |       .poll(() =>
  200 |         panel.evaluate((node) => {
  201 |           const r = node.getBoundingClientRect();
  202 |           return (
  203 |             r.x >= 0 &&
  204 |             r.y >= 0 &&
  205 |             r.right <= window.innerWidth &&
  206 |             r.bottom <= window.innerHeight
  207 |           );
  208 |         }),
  209 |       )
```