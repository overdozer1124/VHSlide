# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: content-fit.spec.ts >> acknowledged warnings stay out of print and do not bypass failed image decoding
- Location: tests/e2e/content-fit.spec.ts:199:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 8

@@ -39,11 +39,17 @@
  説明25
  説明26
  説明27
  説明28
  説明29",
+             "r0:c1": "",
+             "r0:c2": "",
+             "r1:c0": "",
              "r1:c1": "ABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJ",
+             "r1:c2": "",
+             "r2:c0": "",
+             "r2:c1": "",
              "r2:c2": "短文",
            },
            "columns": Array [
              "c0",
              "c1",
@@ -54,10 +60,11 @@
              "r0",
              "r1",
              "r2",
            ],
          },
+         "textAlign": "left",
          "type": "table",
          "w": 700,
          "x": 100,
          "y": 100,
        },
@@ -76,11 +83,11 @@
            "series": Array [
              Object {
                "color": "#587d59",
                "id": "v0",
                "label": "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や",
-               "value": -0,
+               "value": 0,
              },
              Object {
                "color": "#587d59",
                "id": "v1",
                "label": "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や",
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - link "VHSlide 全体マップ" [ref=e5] [cursor=pointer]:
        - /url: "#"
        - text: VH
        - generic [ref=e12]: Slide
      - generic [ref=e14]:
        - textbox "作品のタイトル" [ref=e15]: 表示確認
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
    - navigation [ref=e48]:
      - generic [ref=e49]:
        - button "全体マップ" [ref=e50] [cursor=pointer]
        - button "ページを編集" [ref=e56] [cursor=pointer]
      - generic [ref=e59]:
        - button "もとに戻す" [disabled] [ref=e60]
        - button "やり直す" [disabled] [ref=e64]
        - button "その他" [ref=e70] [cursor=pointer]
    - main [ref=e76]:
      - region "ページの全体マップ" [ref=e77]:
        - generic [ref=e78]:
          - generic [ref=e79]:
            - heading "全体マップ" [level=1] [ref=e80]
            - generic "比較・全体・3ページ" [ref=e87]:
              - generic [ref=e88]: 比較・全体
              - generic [ref=e89]: 3ページ
          - button "マップをフィルタ" [ref=e90] [cursor=pointer]: フィルタ
          - button "スライドを複数選択" [ref=e93] [cursor=pointer]: 選択
          - button "マップのその他" [ref=e97] [cursor=pointer]:
            - generic [ref=e102]: その他
          - generic [ref=e103]:
            - textbox "ページ番号で探す" [ref=e104]:
              - /placeholder: "3.2"
            - button "番号のページを探す" [ref=e105] [cursor=pointer]
          - group "マップの表示サイズ" [ref=e109]:
            - button "マップを縮小" [ref=e110] [cursor=pointer]
            - button "表示サイズを100%に戻す" [ref=e114] [cursor=pointer]: 100%
            - button "マップを拡大" [disabled] [ref=e115]
          - button "マップの表示設定" [ref=e119] [cursor=pointer]: 表示
        - region "スライドのマップ" [ref=e121]:
          - generic [ref=e122]:
            - generic [ref=e124]: 次の話題へ
            - generic [aria-hidden] [ref=e129]: 行 / 列
            - generic [ref=e130]:
              - generic [ref=e131]: "01"
              - textbox "列1の見出し" [ref=e132]:
                - /placeholder: 列の名前
                - text: はじまり
              - button "話題1を移動" [ref=e133] [cursor=pointer]
            - generic [ref=e141]:
              - generic [ref=e142]: "02"
              - textbox "列2の見出し" [ref=e143]:
                - /placeholder: 列の名前
                - text: 話題 2
              - button "話題2を移動" [ref=e144] [cursor=pointer]
            - generic [ref=e152]:
              - generic [ref=e153]: "03"
              - textbox "列3の見出し" [ref=e154]:
                - /placeholder: 列の名前
                - text: 話題 3
              - button "話題3を移動" [ref=e155] [cursor=pointer]
            - generic [ref=e163]:
              - generic [ref=e164]:
                - button "高さ1のページをまとめて移動" [ref=e165] [cursor=pointer]: "01"
                - textbox "行1の見出し" [ref=e166]:
                  - /placeholder: 見出し
              - generic [ref=e167]:
                - generic [ref=e168]:
                  - button "表のページを編集" [ref=e169] [cursor=pointer]:
                    - generic [ref=e170]:
                      - generic:
                        - generic:
                          - generic:
                            - table "スライド内の表":
                              - rowgroup:
                                - row "説明0 説明1 説明2 説明3 説明4 説明5 説明6 説明7 説明8 説明9 説明10 説明11 説明12 説明13 説明14 説明15 説明16 説明17 説明18 説明19 説明20 説明21 説明22 説明23 説明24 説明25 説明26 説明27 説明28 説明29":
                                  - columnheader "説明0 説明1 説明2 説明3 説明4 説明5 説明6 説明7 説明8 説明9 説明10 説明11 説明12 説明13 説明14 説明15 説明16 説明17 説明18 説明19 説明20 説明21 説明22 説明23 説明24 説明25 説明26 説明27 説明28 説明29"
                                  - columnheader
                                  - columnheader
                                - row "ABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJ":
                                  - cell
                                  - cell "ABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJ"
                                  - cell
                                - row "短文":
                                  - cell
                                  - cell
                                  - cell "短文"
                    - generic [ref=e171]: 発表の先頭
                  - generic [ref=e172]:
                    - generic [ref=e173]: "1.1"
                    - textbox "1.1のフッター" [ref=e174]: 表のページ
                    - button "表のページのページメニュー" [ref=e175] [cursor=pointer]
                    - button "表のページを移動" [ref=e180] [cursor=pointer]
                    - button "表のページを削除" [ref=e188] [cursor=pointer]
                - button "表のページの右に次の話題を追加" [ref=e192] [cursor=pointer]
                - button "表のページの下に詳しいページを追加" [ref=e194] [cursor=pointer]
              - generic [ref=e196]:
                - generic [ref=e197]:
                  - button "グラフのページを編集" [ref=e198] [cursor=pointer]:
                    - generic [ref=e199]:
                      - generic:
                        - generic:
                          - generic:
                            - img "比較するグラフ":
                              - generic: "-10"
                              - generic: "0.5"
                              - generic: "11"
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：0": ①
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：1": ②
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：-2": ③
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：3": ④
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：-4": ⑤
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：5": ⑥
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：-6": ⑦
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：7": ⑧
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：-8": ⑨
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：9": ⑩
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：-10": ⑪
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：11": ⑫
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：0":
                                - generic: ① 0
                                - generic: 地域や季節によって変わる長い名称の比較
                                - generic: 地域や季節によって変わる長い名称の比…
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：1":
                                - generic: ② 1
                                - generic: 地域や季節によって変わる長い名称の比較
                                - generic: 地域や季節によって変わる長い名称の比…
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：-2":
                                - generic: ③ -2
                                - generic: 地域や季節によって変わる長い名称の比較
                                - generic: 地域や季節によって変わる長い名称の比…
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：3":
                                - generic: ④ 3
                                - generic: 地域や季節によって変わる長い名称の比較
                                - generic: 地域や季節によって変わる長い名称の比…
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：-4":
                                - generic: ⑤ -4
                                - generic: 地域や季節によって変わる長い名称の比較
                                - generic: 地域や季節によって変わる長い名称の比…
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：5":
                                - generic: ⑥ 5
                                - generic: 地域や季節によって変わる長い名称の比較
                                - generic: 地域や季節によって変わる長い名称の比…
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：-6":
                                - generic: ⑦ -6
                                - generic: 地域や季節によって変わる長い名称の比較
                                - generic: 地域や季節によって変わる長い名称の比…
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：7":
                                - generic: ⑧ 7
                                - generic: 地域や季節によって変わる長い名称の比較
                                - generic: 地域や季節によって変わる長い名称の比…
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：-8":
                                - generic: ⑨ -8
                                - generic: 地域や季節によって変わる長い名称の比較
                                - generic: 地域や季節によって変わる長い名称の比…
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：9":
                                - generic: ⑩ 9
                                - generic: 地域や季節によって変わる長い名称の比較
                                - generic: 地域や季節によって変わる長い名称の比…
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：-10":
                                - generic: ⑪ -10
                                - generic: 地域や季節によって変わる長い名称の比較
                                - generic: 地域や季節によって変わる長い名称の比…
                              - generic "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や：11":
                                - generic: ⑫ 11
                                - generic: 地域や季節によって変わる長い名称の比較
                                - generic: 地域や季節によって変わる長い名称の比…
                  - generic [ref=e200]:
                    - generic [ref=e201]: "1.2"
                    - textbox "1.2のフッター" [ref=e202]: グラフのページ
                    - button "グラフのページのページメニュー" [ref=e203] [cursor=pointer]
                    - button "グラフのページを移動" [ref=e208] [cursor=pointer]
                    - button "グラフのページを削除" [ref=e216] [cursor=pointer]
                - button "グラフのページの右に次の話題を追加" [ref=e220] [cursor=pointer]
                - button "グラフのページの下に詳しいページを追加" [ref=e222] [cursor=pointer]
              - generic [ref=e224]:
                - generic [ref=e225]:
                  - button "空白ページを編集" [ref=e226] [cursor=pointer]
                  - generic [ref=e228]:
                    - generic [ref=e229]: "1.3"
                    - textbox "1.3のフッター" [ref=e230]: 空白ページ
                    - button "空白ページのページメニュー" [ref=e231] [cursor=pointer]
                    - button "空白ページを移動" [ref=e236] [cursor=pointer]
                    - button "空白ページを削除" [ref=e244] [cursor=pointer]
                - button "空白ページの右に次の話題を追加" [ref=e248] [cursor=pointer]
                - button "空白ページの下に詳しいページを追加" [ref=e250] [cursor=pointer]
            - generic [ref=e252]:
              - generic [ref=e253]:
                - button "高さ2のページをまとめて移動" [ref=e254] [cursor=pointer]: "02"
                - textbox "行2の見出し" [ref=e255]:
                  - /placeholder: 見出し
              - button "2.1にページを追加" [ref=e257] [cursor=pointer]:
                - generic [ref=e259]: ページを追加
              - button "2.2にページを追加" [ref=e261] [cursor=pointer]:
                - generic [ref=e263]: ページを追加
              - button "2.3にページを追加" [ref=e265] [cursor=pointer]:
                - generic [ref=e267]: ページを追加
        - generic [ref=e268]:
          - generic [ref=e269]:
            - generic [ref=e270]: ↔
            - text: よこは「次の話題」
            - generic [ref=e271]: /
            - generic [ref=e272]: ↕
            - text: たては「くわしい説明」
          - generic [ref=e273]: 長押し・つまみで移動 · ピンチで拡大・縮小
    - generic "シート一覧" [ref=e274]:
      - tablist "作品のシート" [ref=e275]:
        - tab "比較" [selected] [ref=e277] [cursor=pointer]
      - button "空のシートを追加" [ref=e278] [cursor=pointer]
      - button "シートの操作" [ref=e280] [cursor=pointer]
    - status [ref=e285]
  - dialog "PDFで保存" [ref=e286]:
    - banner [ref=e287]:
      - generic [ref=e288]:
        - heading "PDFで保存" [level=2] [ref=e289]
        - paragraph [ref=e290]: 配る・提出するスライドを選んで、PDFにまとめます。
      - button "閉じる" [ref=e291] [cursor=pointer]
    - button "PDFの準備" [active] [ref=e293] [cursor=pointer]
    - generic [ref=e294]:
      - paragraph [ref=e295]: 3ページ · 16:9 · 1枚ずつ保存します。印刷画面で「PDFに保存」を選び、背景のグラフィックを有効にしてください。
      - button "印刷・PDFに保存" [ref=e296] [cursor=pointer]
      - button "スライドを選び直す" [ref=e297] [cursor=pointer]
    - status [ref=e298]: PDFの準備ができました。
  - generic [aria-hidden]:
    - generic:
      - generic:
        - generic:
          - generic:
            - generic:
              - table:
                - rowgroup:
                  - row:
                    - columnheader:
                      - generic: 説明0 説明1 説明2 説明3 説明4 説明5 説明6 説明7 説明8 説明9 説明10 説明11 説明12 説明13 説明14 説明15 説明16 説明17 説明18 説明19 説明20 説明21 説明22 説明23 説明24 説明25 説明26 説明27 説明28 説明29
                    - columnheader
                    - columnheader
                  - row:
                    - cell
                    - cell:
                      - generic: ABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJ
                    - cell
                  - row:
                    - cell
                    - cell
                    - cell:
                      - generic: 短文
    - generic:
      - generic:
        - generic:
          - generic:
            - generic:
              - img:
                - generic: 比較するグラフ
                - generic: "-10"
                - generic: "0.5"
                - generic: "11"
                - generic: ①
                - generic: ②
                - generic: ③
                - generic: ④
                - generic: ⑤
                - generic: ⑥
                - generic: ⑦
                - generic: ⑧
                - generic: ⑨
                - generic: ⑩
                - generic: ⑪
                - generic: ⑫
                - generic:
                  - generic: ① 0
                  - generic: 地域や季節によって変わる長い名称の比較
                  - generic: 地域や季節によって変わる長い名称の比…
                - generic:
                  - generic: ② 1
                  - generic: 地域や季節によって変わる長い名称の比較
                  - generic: 地域や季節によって変わる長い名称の比…
                - generic:
                  - generic: ③ -2
                  - generic: 地域や季節によって変わる長い名称の比較
                  - generic: 地域や季節によって変わる長い名称の比…
                - generic:
                  - generic: ④ 3
                  - generic: 地域や季節によって変わる長い名称の比較
                  - generic: 地域や季節によって変わる長い名称の比…
                - generic:
                  - generic: ⑤ -4
                  - generic: 地域や季節によって変わる長い名称の比較
                  - generic: 地域や季節によって変わる長い名称の比…
                - generic:
                  - generic: ⑥ 5
                  - generic: 地域や季節によって変わる長い名称の比較
                  - generic: 地域や季節によって変わる長い名称の比…
                - generic:
                  - generic: ⑦ -6
                  - generic: 地域や季節によって変わる長い名称の比較
                  - generic: 地域や季節によって変わる長い名称の比…
                - generic:
                  - generic: ⑧ 7
                  - generic: 地域や季節によって変わる長い名称の比較
                  - generic: 地域や季節によって変わる長い名称の比…
                - generic:
                  - generic: ⑨ -8
                  - generic: 地域や季節によって変わる長い名称の比較
                  - generic: 地域や季節によって変わる長い名称の比…
                - generic:
                  - generic: ⑩ 9
                  - generic: 地域や季節によって変わる長い名称の比較
                  - generic: 地域や季節によって変わる長い名称の比…
                - generic:
                  - generic: ⑪ -10
                  - generic: 地域や季節によって変わる長い名称の比較
                  - generic: 地域や季節によって変わる長い名称の比…
                - generic:
                  - generic: ⑫ 11
                  - generic: 地域や季節によって変わる長い名称の比較
                  - generic: 地域や季節によって変わる長い名称の比…
```

# Test source

```ts
  110 |   await page.screenshot({ path: info.outputPath("table-fit.png") });
  111 | });
  112 | test("chart labels use numbered names with legend off, stay inside the chart, and keep full original data", async ({
  113 |   page,
  114 | }) => {
  115 |   await button(page, "グラフのページを編集").click();
  116 |   const svg = page.locator(".editor-page-current .chart-graphic");
  117 |   await expect(svg).toHaveAttribute("data-chart-numbered", "true");
  118 |   await expect(svg.locator(".chart-name-entry")).toHaveCount(12);
  119 |   await expect(svg.locator(".chart-name-line")).toContainText(
  120 |     Array(24).fill(/地域|名称|季節|比較|変わる|によって|長い|の|…/),
  121 |   );
  122 |   const outside = await svg.evaluate((n) => {
  123 |     const b = (n as unknown as SVGSVGElement).viewBox.baseVal;
  124 |     return [...n.querySelectorAll("text")]
  125 |       .filter((t) => {
  126 |         const r = (t as SVGGraphicsElement).getBBox();
  127 |         return (
  128 |           r.x < -0.5 ||
  129 |           r.y < -0.5 ||
  130 |           r.x + r.width > b.width + 0.5 ||
  131 |           r.y + r.height > b.height + 0.5
  132 |         );
  133 |       })
  134 |       .map((t) => t.textContent);
  135 |   });
  136 |   expect(outside).toEqual([]);
  137 |   expect((await data(page)).slides[1].elements[0].chart).toEqual(chart.chart);
  138 | });
  139 | test("presentation checks only filtered targets, supports cancel, and excludes editor warning marks", async ({
  140 |   page,
  141 | }) => {
  142 |   await button(page, "マップをフィルタ").click();
  143 |   await page.getByRole("button", { name: /フィルタ選択: 1.2 グラフ/ }).click();
  144 |   await button(page, "フィルタを適用").click();
  145 |   await button(page, "この1ページを発表").click();
  146 |   const review = page.getByRole("dialog", {
  147 |     name: "表示チェック",
  148 |     exact: true,
  149 |   });
  150 |   await expect(review).toContainText("項目名の一部が省略");
  151 |   await expect(review).not.toContainText("1行1列");
  152 |   await review.getByRole("button", { name: "取り消す", exact: true }).click();
  153 |   await expect(page.locator(".present-mode")).toHaveCount(0);
  154 |   await button(page, "この1ページを発表").click();
  155 |   await button(page, "このまま進む").click();
  156 |   await expect(page.locator(".present-slide .chart-graphic")).toBeVisible();
  157 |   await expect(page.locator(".present-mode .cell-overflow-flag")).toHaveCount(
  158 |     0,
  159 |   );
  160 |   await page.keyboard.press("Escape");
  161 |   await expect(page.locator(".slide-card")).toHaveCount(1);
  162 | });
  163 | test("PDF fix and resume keeps the exact chosen IDs and rechecks edited cells before output", async ({
  164 |   page,
  165 | }) => {
  166 |   await pdf(page);
  167 |   const picker = page.getByLabel("対象スライド");
  168 |   await picker.getByRole("checkbox").nth(1).uncheck();
  169 |   await picker.getByRole("checkbox").nth(2).uncheck();
  170 |   await button(page, "PDFの準備").click();
  171 |   const review = page.getByRole("dialog", {
  172 |     name: "表示チェック",
  173 |     exact: true,
  174 |   });
  175 |   await expect(review).toContainText("1行1列");
  176 |   await review
  177 |     .getByRole("button", { name: "内容を確認・修正", exact: true })
  178 |     .first()
  179 |     .click();
  180 |   await expect(page.locator(".editor-main")).toBeVisible();
  181 |   for (const cell of await page
  182 |     .locator(".editor-workspace .slide-table textarea")
  183 |     .all())
  184 |     await cell.fill("短文");
  185 |   await expect(
  186 |     page.locator(".editor-workspace .cell-overflow-flag"),
  187 |   ).toHaveCount(0);
  188 |   await button(page, "PDFの準備を再開").click();
  189 |   await expect(
  190 |     page.getByLabel("対象スライド").getByRole("checkbox", { checked: true }),
  191 |   ).toHaveCount(1);
  192 |   await button(page, "PDFの準備").click();
  193 |   await expect(button(page, "印刷・PDFに保存")).toBeEnabled();
  194 |   await expect(page.locator(".print-page")).toHaveCount(1);
  195 |   await expect(page.locator(".print-export .cell-overflow-flag")).toHaveCount(
  196 |     0,
  197 |   );
  198 | });
  199 | test("acknowledged warnings stay out of print and do not bypass failed image decoding", async ({
  200 |   page,
  201 | }) => {
  202 |   await pdf(page);
  203 |   await button(page, "PDFの準備").click();
  204 |   await button(page, "このまま進む").click();
  205 |   await expect(button(page, "印刷・PDFに保存")).toBeEnabled();
  206 |   await expect(page.locator(".print-page")).toHaveCount(3);
  207 |   await expect(page.locator(".print-export .cell-overflow-flag")).toHaveCount(
  208 |     0,
  209 |   );
> 210 |   expect((await data(page)).slides).toEqual(source.slides);
      |                                     ^ Error: expect(received).toEqual(expected) // deep equality
  211 | });
  212 | 
```