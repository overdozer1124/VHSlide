# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: content-fit.spec.ts >> chart labels use numbered names with legend off, stay inside the chart, and keep full original data
- Location: tests/e2e/content-fit.spec.ts:112:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

@@ -3,11 +3,11 @@
    "series": Array [
      Object {
        "color": "#587d59",
        "id": "v0",
        "label": "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や",
-       "value": -0,
+       "value": 0,
      },
      Object {
        "color": "#587d59",
        "id": "v1",
        "label": "地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や季節によって変わる長い名称の比較地域や",
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
        - button "もとに戻す" [disabled] [ref=e98]
        - button "やり直す" [disabled] [ref=e102]
        - button "その他" [ref=e108] [cursor=pointer]
    - generic [ref=e114]:
      - complementary "縦横のページ一覧" [ref=e115]:
        - generic [ref=e116]:
          - strong [ref=e117]: ページ一覧
          - button "行番号一覧" [ref=e118] [cursor=pointer]
        - generic [ref=e123]:
          - button "1段目の横のページをひらく" [ref=e124] [cursor=pointer]:
            - generic [ref=e125]:
              - generic [ref=e126]: "1.2"
              - generic "ここをドラッグで段ごと移動" [ref=e127]
            - generic [ref=e138]:
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
          - textbox "1.2のフッター" [ref=e139]: グラフのページ
          - button "1段目のメニュー" [ref=e140] [cursor=pointer]
          - button "1段目の下に行を挿入" [ref=e146] [cursor=pointer]
        - generic [ref=e150]: 段ごと移動 ↕ · 重ねて入れ替え · 間に挿入
        - separator "サムネイルバーの幅" [ref=e151]
      - status [ref=e152]
      - generic [ref=e153]:
        - generic [ref=e154]:
          - generic "比較・全体・3ページ" [ref=e155]:
            - generic [ref=e156]: 比較・全体
            - generic [ref=e157]: 3ページ
          - textbox "ページの名前" [ref=e158]: グラフのページ
          - generic [ref=e159]: 1.2 / 16:9
        - generic "編集中のスライド" [ref=e160]
        - generic [ref=e161]: ページ移動：どこでも1本指でスワイプ · タッチパッドは2本指
      - complementary [ref=e163]:
        - generic [ref=e165]:
          - generic [ref=e166]: ページ設定
          - heading "ページのデザイン" [level=2] [ref=e167]
        - group [ref=e169]:
          - generic [ref=e170]:
            - generic [ref=e171]:
              - text: 背景の色
              - textbox "背景の色" [ref=e172] [cursor=pointer]: "#ffffff"
            - generic [ref=e173]:
              - button "背景を#ffffffに変更" [ref=e174] [cursor=pointer]
              - button "背景を#e5f0dcに変更" [ref=e175] [cursor=pointer]
              - button "背景を#e7efeaに変更" [ref=e176] [cursor=pointer]
              - button "背景を#f8eddcに変更" [ref=e177] [cursor=pointer]
              - button "背景を#f4e5e4に変更" [ref=e178] [cursor=pointer]
              - button "背景を#e4eaf6に変更" [ref=e179] [cursor=pointer]
              - button "背景を#173d38に変更" [ref=e180] [cursor=pointer]
              - button "背景を#d6bc94に変更" [ref=e181] [cursor=pointer]
            - paragraph [ref=e182]: キャンバスの中の文字や図形をタップすると、色や大きさを変えられます。
  - generic "シート一覧" [ref=e183]:
    - tablist "作品のシート" [ref=e184]:
      - tab "比較" [selected] [ref=e186] [cursor=pointer]
    - button "空のシートを追加" [ref=e187] [cursor=pointer]
    - button "シートの操作" [ref=e189] [cursor=pointer]
  - status [ref=e194]
  - generic [aria-hidden]:
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
  37  |     series: Array.from({ length: 12 }, (_, i) => ({
  38  |       id: `v${i}`,
  39  |       label: "地域や季節によって変わる長い名称の比較".repeat(4).slice(0, 60),
  40  |       value: i % 2 ? i : -i,
  41  |       color: "#587d59",
  42  |     })),
  43  |   },
  44  | };
  45  | const source: Deck = {
  46  |   version: 1,
  47  |   title: "表示確認",
  48  |   sheets: [{ id: "main", name: "比較" }],
  49  |   activeSheetId: "main",
  50  |   slides: [
  51  |     {
  52  |       ...blank(0, 0),
  53  |       id: "table-page",
  54  |       title: "表のページ",
  55  |       elements: [table],
  56  |     },
  57  |     {
  58  |       ...blank(1, 0),
  59  |       id: "chart-page",
  60  |       title: "グラフのページ",
  61  |       elements: [chart],
  62  |     },
  63  |     { ...blank(2, 0), id: "clean-page", title: "空白ページ" },
  64  |   ],
  65  | };
  66  | const data = (p: Page) =>
  67  |   p.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
  68  | const button = (p: Page, name: string) =>
  69  |   p.getByRole("button", { name, exact: true });
  70  | async function pdf(p: Page) {
  71  |   await button(p, "保存方法を選ぶ").click();
  72  |   await p.getByRole("menuitem", { name: /PDFで保存/ }).click();
  73  | }
  74  | test.beforeEach(async ({ page }) => {
  75  |   await page.route("**/api/config", (r) =>
  76  |     r.fulfill({ json: { clientId: "", notice: "" } }),
  77  |   );
  78  |   await page.route("**/api/session", (r) =>
  79  |     r.fulfill({ json: { user: null } }),
  80  |   );
  81  |   await page.addInitScript((book) => {
  82  |     if (!localStorage.getItem("vhslide-deck-v1"))
  83  |       localStorage.setItem("vhslide-deck-v1", JSON.stringify(book));
  84  |     document.documentElement.requestFullscreen = () =>
  85  |       Promise.reject(new Error("local denial"));
  86  |   }, source);
  87  |   await page.goto("/");
  88  | });
  89  | test("table measurement ignores caret scroll, preserves all text, and removes a warning when the cell fits", async ({
  90  |   page,
  91  | }, info) => {
  92  |   await button(page, "表のページを編集").click();
  93  |   await expect(page.locator(".workspace-flight")).toHaveCount(0);
  94  |   const cell = page.locator(
  95  |       '.editor-workspace td[data-cell="r0:c0"],.editor-workspace th[data-cell="r0:c0"]',
  96  |     ),
  97  |     input = cell.locator("textarea");
  98  |   await expect(cell.locator(".cell-overflow-flag")).toBeVisible();
  99  |   await input.click();
  100 |   await expect(
  101 |     page.getByRole("region", { name: "表示の見切れ", exact: true }),
  102 |   ).toContainText("1行1列");
  103 |   await input.evaluate((n) => (n.scrollTop = n.scrollHeight));
  104 |   await expect(cell.locator(".cell-overflow-flag")).toBeVisible();
  105 |   expect((await data(page)).slides[0].elements[0].table.cells["r0:c0"]).toBe(
  106 |     table.table!.cells["r0:c0"],
  107 |   );
  108 |   await input.fill("短文");
  109 |   await expect(cell.locator(".cell-overflow-flag")).toHaveCount(0);
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
> 137 |   expect((await data(page)).slides[1].elements[0].chart).toEqual(chart.chart);
      |                                                          ^ Error: expect(received).toEqual(expected) // deep equality
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
  210 |   expect((await data(page)).slides).toEqual(source.slides);
  211 | });
  212 | 
```